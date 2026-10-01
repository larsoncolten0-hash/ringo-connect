// Parity test for Business Toolkit Phase 6 (customers): the TypeScript normalisation in src/lib/customers/match.ts must give EXACTLY the same answer as the
// SQL functions that stored bk_customers.phone_normalized / email_normalized (bk_norm_phone / bk_norm_email in 2026-12-03_debtors_reminders.sql). The
// possible-order matching compares a contact's STORED (SQL) key with a key computed in Node from an order's raw text; if the two rules ever differed,
// a real match would silently be missed (or a false one made).
//
// Runs on a scratch, IN-MEMORY PostgreSQL (PGlite). It extracts the two REAL function definitions from the Phase 3 migration file, creates them in the
// scratch engine, and compares them with the TypeScript functions over one corpus. No Supabase, no real database, no migration, nothing is written anywhere.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json or the lockfile)
//   Run:    node scripts/tests/customersNormParity.test.mjs
//
// NOT covered: Unicode LOWER() of non-ASCII capitals depends on the database locale (Supabase uses a UTF-8 locale, PGlite's C locale does not), so the
// corpus keeps non-ASCII text lower-case; JavaScript lower-cases Unicode as a UTF-8 locale does.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const M = jiti(path.join(REPO, "src/lib/customers/match.ts"));

const sql = fs.readFileSync(path.join(REPO, "supabase/migrations/2026-12-03_debtors_reminders.sql"), "utf8").replace(/\r\n/g, "\n");
const fn = (name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in the Phase 3 migration`);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2) + 3;
  return sql.slice(start, end);
};

const db = new PGlite();
await db.exec(fn("bk_norm_phone") + "\n" + fn("bk_norm_email"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const sqlPhone = async (v) => (await db.query("select bk_norm_phone($1) as r", [v])).rows[0].r;
const sqlEmail = async (v) => (await db.query("select bk_norm_email($1) as r", [v])).rows[0].r;

const phones = [
  null, "", " ", "abc", "12", "123456", "1234567", "677 12 34 56", "+237 677-123-456", "00237677123456", "237677123456", "677123456", "6 77 12 34 56", "(237) 677.123.456",
  "222123456", "122123456", "322123456", "0677123456", "+1 (202) 555-0123", "00", "0012", "0000000", "00 00000000", "+33 6 12 34 56 78", "123456789012345", "1234567890123456",
  "12345678901234567890", " 677123456 ", "\t677123456\n", "٦٧٧١٢٣٤٥٦", "６７７１２３４５６", "677-123-456 ext 12", "0237 677 123 456", "237 6 77 12 34 56", "+237677123456",
  "00677123456", "000677123456", "67712345", "6771234567", "2 22 12 34 56", "tel:+237677123456", "677 123 456 / 699 000 111", "00-00-00-00-00-00-00",
];
for (const p of phones) {
  const a = await sqlPhone(p), b = M.normalizePhone(p);
  check(`phone ${JSON.stringify(p)}`, a === b, `sql=${JSON.stringify(a)} ts=${JSON.stringify(b)}`);
}
// every 0-16 digit run through the same rule, to cover each length boundary
for (let n = 0; n <= 16; n++) for (const lead of ["", "6", "2", "1", "00", "006", "002"]) {
  const v = lead + "7".repeat(Math.max(0, n - lead.length));
  const a = await sqlPhone(v), b = M.normalizePhone(v);
  check(`digit run ${v}`, a === b, `sql=${a} ts=${b}`);
}

const emails = [
  null, "", " ", "A@B.co", "  A@B.co ", "\tA@B.co", "A@B.co\n", "a b@c.d", "a\tb@c.d", "a\u000bb@c.d", "a\fb@c.d", "a\rb@c.d", "a\nb@c.d", "\u000ba@b.co", "a@b.co\f", "@x.com", "x@", "x", "UPPER@CASE.COM", "a@b@c", "é@x.fr", "user+tag@Example.com", "first.last@sub.domain.org",
  "x@y", "a@b.c", " a@b.co", "a@b.co ", "a@@b.co", "Name <a@b.co>", "a@b.co ", " a@b.co", "  ", "@", "a@", "ab", "a".repeat(190) + "@x.com", "a".repeat(195) + "@x.com", "a".repeat(199) + "@x.com", "a".repeat(200) + "@x.com", "ÀB@x.fr".toLowerCase(),
];
for (const e of emails) {
  const a = await sqlEmail(e), b = M.normalizeEmail(e);
  check(`email ${JSON.stringify(e && e.length > 40 ? e.slice(0, 20) + `…(${e.length})` : e)}`, a === b, `sql=${JSON.stringify(a)} ts=${JSON.stringify(b)}`);
}

console.log(`${pass} checks passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
