// Card appointments, the customer's CONFIRMATION RECEIPT (card choice): the exact message the customer gets when the team confirms a meeting, with the chosen card and price, in English
// and French, and its honest fallbacks. Also the dashboard wiring of the chosen card. Nothing here connects to Supabase, Meta or any network.
//   Run:  node scripts/tests/cardAppointmentsReceipt.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
console.info = () => {};
let passed = 0;
const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };

const Lib = jiti(path.join(SRC, "lib/salesBot/appointments.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const EN = translations.en.inbox.salesBot, FR = translations.fr.inbox.salesBot;

/** Confirm an appointment through the real changeAppointmentStatus with a scripted database (the set_status answer carries the receipt fields) and a recording sender. */
async function confirm(setAnswer, lang) {
  const sent = [];
  const CONV = "c2222222-2222-4222-8222-222222222222", ACTOR = "d3333333-3333-4333-8333-333333333333", APPT = "a1111111-1111-4111-8111-111111111111";
  const admin = { rpc: async (fn) => ({ data: fn === "card_appt_locate" ? { result: "ok", conversation_id: CONV, profile_id: "p" } : fn === "card_appt_set_status" ? { result: "ok", status: "confirmed", from: "pending", conversation_id: CONV, profile_id: "p", lang, ...setAnswer } : { result: "ok" }, error: null }) };
  const deps = { admin, guard: async () => ({ ok: true, kind: "owner", userId: ACTOR, profileId: "p", admin }), send: async (_d, input) => { sent.push(input); return { status: 200, body: { ok: true, state: "sent", message_id: "m" } }; } };
  await Lib.changeAppointmentStatus(deps, { appointmentId: APPT, to: "confirmed", details: null });
  return sent;
}

await test("the confirmation receipt lists name, date and time, item, price and location (English)", () => {
  const t = EN.apptDecision("confirmed", null, { name: "Jean Mbah", when: "Saturday 10am", where: "Akwa", item: `${EN.receiptItem} — ${EN.tierLabel.premium}`, price: EN.price("10 000") });
  for (const s of ["Booking confirmed", "Jean Mbah", "Saturday 10am", "Akwa", EN.tierLabel.premium, "10 000", "A Ringo Connect agent will reach out to you", "Transportation"]) assert.ok(t.includes(s), s);
  assert.ok(!/\bpending\b|undefined|\bnull\b/i.test(t), "no pending wording, no leaked undefined/null");
});
await test("the confirmation receipt is complete in French", () => {
  const t = FR.apptDecision("confirmed", null, { name: "Jean Mbah", when: "samedi 10h", where: "Akwa", item: `${FR.receiptItem} — ${FR.tierLabel.premium}`, price: FR.price("10 000") });
  for (const s of ["Réservation confirmée", "Jean Mbah", "samedi 10h", "Akwa", "Reçu", "vous contactera", "transport"]) assert.ok(t.includes(s), s);
  assert.ok(!/en attente|undefined|null/i.test(t));
});
await test("without a card (an older request) the receipt simply leaves the item and price lines out", () => {
  const t = EN.apptDecision("confirmed", null, { name: "Jean Mbah", when: "Saturday 10am", where: "Akwa", item: null, price: null });
  assert.ok(t.includes("Jean Mbah") && !t.includes("Item:") && !t.includes("Price:"));
  const bare = EN.apptDecision("confirmed", null);
  assert.ok(bare.includes("Booking confirmed") && !bare.includes("Receipt\nName") && !/undefined|null/.test(bare));
});
await test("the team's note is shown in the receipt, and declined / cancelled messages carry no receipt", () => {
  assert.ok(EN.apptDecision("confirmed", "BRING ID", undefined).includes("BRING ID"));
  assert.ok(!EN.apptDecision("declined", null, { name: "N", when: "w", where: "p", item: null, price: null }).includes("Receipt"));
  assert.ok(!EN.apptDecision("cancelled", null, { name: "N", when: "w", where: "p", item: null, price: null }).includes("Receipt"));
});
await test("through the real status change: the card and FCFA price from the database reach the customer's message", async () => {
  const sent = await confirm({ customer_name: "Jean Mbah", preferred_time: "Saturday 10am", meeting_place: "Akwa", card_tier: "premium", card_price_xaf: 10000 }, "en");
  assert.strictEqual(sent.length, 1);
  const text = sent[0].text;
  assert.ok(text.includes("Premium") && /10[ ,  ]?000/.test(text) && text.includes("Jean Mbah") && text.includes("Akwa"), text);
  const none = await confirm({ customer_name: "Jean Mbah", preferred_time: "Saturday 10am", meeting_place: "Akwa", card_tier: null, card_price_xaf: null }, "fr");
  assert.ok(none[0].text.includes("Reçu") && !none[0].text.includes("Article"), none[0].text);
});
await test("the dashboard shows the chosen card and works before the migration (reads again without the card columns)", () => {
  const page = raw("src/app/dashboard/inbox/appointments/page.tsx"), view = raw("src/components/inbox/AppointmentsView.tsx");
  assert.ok(/card_tier, card_price_xaf/.test(page) && /if \(error\) \(\{ data, error \} = await load\(columns\)\)/.test(page), "falls back without the card columns");
  assert.ok(/row\.card_tier &&/.test(view) && view.includes('data-testid="appointment-card-choice"') && view.includes("FCFA"), "the card row is shown only when present");
  assert.ok(translations.en.inbox.appointments?.card === "Card" || /"card": "Card"/.test(raw("src/lib/i18n/translations.en.ts")));
  assert.ok(/"card": "Carte"/.test(raw("src/lib/i18n/translations.fr.ts")));
});

console.log(`cardAppointmentsReceipt: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(" FAIL:", f.slice(0, 600));
process.exit(failures.length ? 1 : 0);
