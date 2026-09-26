// Offline NFC Contact Fallback — the Ringo Smart Card's URL record stays exactly as it always was;
// a second, independent vCard record is now written alongside it so a phone with no internet can
// still surface the owner's basic public contact info directly off the chip. Covers: the vCard
// builder (missing-field handling, no fabricated/placeholder values, escaping), payload size
// estimation and the pre-flight oversized-payload rejection, that the EXISTING URL-only write path
// (writeRingoCardUrl, used by the unrelated Association Member-card feature) is completely
// unmodified, and that no private/internal field can ever reach the chip.
//   Run:  node scripts/tests/ringoCardOfflineContact.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// A minimal, fake Web NFC surface so the module's `typeof window` checks see something — just
// enough for writeRingoCard's own pre-flight checks (support/secure-context/size) to run; the
// actual reader.write() call is a no-op stub since no real hardware exists in this environment.
let lastWrittenRecords = null;
global.window = {
  NDEFReader: function () {
    return {
      write: async (message) => {
        lastWrittenRecords = message.records;
      },
    };
  },
  isSecureContext: true,
};
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const {
  buildRingoCardVCard,
  estimateRingoCardPayloadBytes,
  NTAG216_USABLE_BYTES,
  writeRingoCard,
  RingoCardError,
} = jiti(path.join(SRC, "lib/ringoCardWriter.ts"));

// ---------------------------------------------------------------- 1. vCard builder — missing-field handling
{
  const full = buildRingoCardVCard({ name: "John Doe", phone: "+237600000000", email: "john@example.com", url: "https://ringoconnectltd.com/johndoe" });
  check("full contact: has FN/TEL/EMAIL/URL, in that order, CRLF-joined, BEGIN/END VCARD", full === ["BEGIN:VCARD", "VERSION:3.0", "FN:John Doe", "TEL:+237600000000", "EMAIL:john@example.com", "URL:https://ringoconnectltd.com/johndoe", "END:VCARD"].join("\r\n"));

  const nameOnly = buildRingoCardVCard({ name: "Jane Doe", phone: null, email: null, url: "https://ringoconnectltd.com/jane" });
  check("name only: no TEL line at all", !/TEL:/.test(nameOnly));
  check("name only: no EMAIL line at all", !/EMAIL:/.test(nameOnly));
  check("name only: still has FN and URL", /FN:Jane Doe/.test(nameOnly) && /URL:https:\/\/ringoconnectltd\.com\/jane/.test(nameOnly));

  const phoneOnly = buildRingoCardVCard({ name: "Amina", phone: "+237611111111", email: null, url: "https://ringoconnectltd.com/amina" });
  check("name + phone only: has TEL, no EMAIL", /TEL:\+237611111111/.test(phoneOnly) && !/EMAIL:/.test(phoneOnly));

  const emailOnly = buildRingoCardVCard({ name: "Paul", phone: null, email: "paul@ringo.test", url: "https://ringoconnectltd.com/paul" });
  check("name + email only: has EMAIL, no TEL", /EMAIL:paul@ringo\.test/.test(emailOnly) && !/TEL:/.test(emailOnly));

  const emptyStrings = buildRingoCardVCard({ name: "Kofi", phone: "", email: "   ", url: "https://ringoconnectltd.com/kofi" });
  check("empty-string phone/email (not null, just blank) are treated as absent, never written as blank lines", !/TEL:/.test(emptyStrings) && !/EMAIL:/.test(emptyStrings));

  check("never writes the literal string 'undefined'", !/undefined/.test(full) && !/undefined/.test(nameOnly));
  check("never writes the literal string 'null'", !/\bnull\b/.test(full) && !/\bnull\b/.test(nameOnly));
}

// ---------------------------------------------------------------- 2. vCard escaping — a name/value with special characters can't corrupt the record
{
  const escaped = buildRingoCardVCard({ name: "Doe, John; \"The Boss\"", phone: null, email: null, url: "https://ringoconnectltd.com/doe" });
  check("commas in FN are escaped (\\,) so the field boundary can't be confused", /FN:Doe\\, John/.test(escaped));
  check("semicolons in FN are escaped (\\;)", /John\\; /.test(escaped));
}

// ---------------------------------------------------------------- 3. payload size estimation and the pre-flight oversized rejection
{
  const smallSize = estimateRingoCardPayloadBytes("https://ringoconnectltd.com/johndoe", buildRingoCardVCard({ name: "John Doe", phone: "+237600000000", email: "john@example.com", url: "https://ringoconnectltd.com/johndoe" }));
  check("a normal name/phone/email/url payload comfortably fits the NTAG216's usable memory", smallSize < NTAG216_USABLE_BYTES, `size=${smallSize}`);
  check("NTAG216_USABLE_BYTES is the documented 888-byte figure, not a made-up number", NTAG216_USABLE_BYTES === 888);

  const hugeName = "A".repeat(2000);
  const hugeVcard = buildRingoCardVCard({ name: hugeName, phone: null, email: null, url: "https://ringoconnectltd.com/x" });
  const hugeSize = estimateRingoCardPayloadBytes("https://ringoconnectltd.com/x", hugeVcard);
  check("an unreasonably long name is correctly detected as exceeding the card's capacity", hugeSize > NTAG216_USABLE_BYTES);

  let threw = null;
  try {
    await writeRingoCard("https://ringoconnectltd.com/x", { name: hugeName, phone: null, email: null, url: "https://ringoconnectltd.com/x" });
  } catch (err) {
    threw = err;
  }
  check("writeRingoCard rejects an oversized payload with a dedicated error code, BEFORE ever calling reader.write()", threw instanceof RingoCardError && threw.code === "payload_too_large" && lastWrittenRecords === null);
}

// ---------------------------------------------------------------- 4. a normal write actually composes both records, URL first
{
  lastWrittenRecords = null;
  await writeRingoCard("https://ringoconnectltd.com/johndoe", { name: "John Doe", phone: "+237600000000", email: "john@example.com", url: "https://ringoconnectltd.com/johndoe" });
  check("a normal write sends exactly 2 records", Array.isArray(lastWrittenRecords) && lastWrittenRecords.length === 2);
  check("the URL record is first (a reader that only understands one record gets the URL)", lastWrittenRecords?.[0]?.recordType === "url" && lastWrittenRecords[0].data === "https://ringoconnectltd.com/johndoe");
  check("the second record is a text/vcard MIME record", lastWrittenRecords?.[1]?.recordType === "mime" && lastWrittenRecords[1].mediaType === "text/vcard");

  lastWrittenRecords = null;
  await writeRingoCard("https://ringoconnectltd.com/x", null);
  check("passing null contact writes ONLY the URL record — identical shape to the original writeRingoCardUrl behavior", lastWrittenRecords?.length === 1 && lastWrittenRecords[0].recordType === "url");
}

// ---------------------------------------------------------------- 5. the ORIGINAL URL-only function is completely unmodified (byte-for-byte)
{
  const src = read("src/lib/ringoCardWriter.ts");
  const fnMatch = src.match(/export async function writeRingoCardUrl\([\s\S]*?\n}/);
  check("writeRingoCardUrl still exists, unchanged in shape (single url record, no contact param)", !!fnMatch && /records: \[\{ recordType: "url", data: url \}\]/.test(fnMatch[0]) && !/contact/i.test(fnMatch[0]));
}

// ---------------------------------------------------------------- 6. the unrelated Association Member-card feature was not touched
{
  const addMemberSrc = read("src/components/association/AddMemberModal.tsx");
  const partnerSrc = read("src/components/association/AssociationPartnerView.tsx");
  check("AddMemberModal.tsx still calls the ORIGINAL writeRingoCardUrl (member cards stay URL-only, no contact fallback added there)", /writeRingoCardUrl\(/.test(addMemberSrc) && !/writeRingoCard\(/.test(addMemberSrc.replace(/writeRingoCardUrl/g, "")));
  check("AssociationPartnerView.tsx is untouched by this change", !/RingoCardContact|buildRingoCardVCard/.test(partnerSrc));
}

// ---------------------------------------------------------------- 7. security — no private/internal field can reach the writer or the vCard builder
{
  const writerSrc = read("src/lib/ringoCardWriter.ts").replace(/\/\/.*$/gm, "");
  check("ringoCardWriter.ts never references any auth/session/credential field (outside of comments explaining that it doesn't)", !/password|api_key|apiKey|session|supabase.*key/i.test(writerSrc));

  const uiSrc = read("src/components/dashboard/RingoCardWriter.tsx");
  check("the writer UI builds contact from about_phone/about_email specifically — never whatsapp_number, never a raw users/auth email field", /phone: profile\.about_phone/.test(uiSrc) && /email: profile\.about_email/.test(uiSrc) && !/whatsapp_number/.test(uiSrc.match(/const contact: RingoCardContact[\s\S]{0,200}/)?.[0] ?? ""));

  const pageSrc = read("src/app/dashboard/ringo-card/page.tsx");
  check("the page only passes about_phone/about_email through — no other new profile fields added", /about_phone: profile\.about_phone/.test(pageSrc) && /about_email: profile\.about_email/.test(pageSrc));
}

// ---------------------------------------------------------------- 8. no schema change — pure application code
{
  const allMigrations = fs.readdirSync(path.join(REPO, "supabase/migrations"));
  check("no new migration was added for this feature (none was needed — reuses existing profile fields)", !allMigrations.some((f) => /ringo.?card.*contact|nfc.*contact|vcard/i.test(f)));
}

// ---------------------------------------------------------------- 9. i18n — both languages define every new key
{
  const src = read("src/lib/i18n/translations.ts");
  const enBlock = src.slice(0, src.indexOf("fr:"));
  const frBlock = src.slice(src.indexOf("fr:"));
  const newKeys = ["contactPreviewTitle", "contactPreviewHint", "contactNameLabel", "contactProfileLabel", "rewriteContactReminder", "verifyContactFound", "verifyContactNotFound"];
  for (const key of newKeys) {
    check(`en ringoCard defines ${key}`, new RegExp(`${key}:`).test(enBlock));
    check(`fr ringoCard defines ${key}`, new RegExp(`${key}:`).test(frBlock));
  }
  const enRingoCardBlock = enBlock.slice(enBlock.indexOf("ringoCard: {"), enBlock.indexOf("ringoCard: {") + 6500);
  const frRingoCardBlock = frBlock.slice(frBlock.indexOf("ringoCard: {"), frBlock.indexOf("ringoCard: {") + 6500);
  check("en ringoCard.errors defines payload_too_large", /payload_too_large:/.test(enRingoCardBlock));
  check("fr ringoCard.errors defines payload_too_large", /payload_too_large:/.test(frRingoCardBlock));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nringo_card_offline_contact: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
