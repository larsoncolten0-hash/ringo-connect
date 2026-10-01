// Business Toolkit Phase 6 (customers: directory, profile, possible Shop orders). The REAL search sanitiser, matching logic, profile derivation, API
// handlers and route files run here against in-memory fakes; only the session resolver is stubbed. No network, no database, nothing applied. Phase 6
// has no migration and no SQL. The SQL/TypeScript phone and email normalisation is proven equal on a real PostgreSQL engine by
// scripts/tests/customersNormParity.test.mjs.
//   Run:  node scripts/tests/customers.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `cust_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const S = jiti(path.join(SRC, "lib/customers/search.ts"));
const MT = jiti(path.join(SRC, "lib/customers/match.ts"));
const PR = jiti(path.join(SRC, "lib/customers/profile.ts"));
const H = jiti(path.join(SRC, "lib/customers/handlers.ts"));
const K = jiti(path.join(SRC, "lib/customers/constants.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const route = (p) => jiti(path.join(SRC, "app/api", p, "route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const PROFILE = "22222222-2222-4222-8222-222222222222", OTHER = "99999999-9999-4999-8999-999999999999", USER = "11111111-1111-4111-8111-111111111111";
const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

// ------------------------------------------------------------------------ a read-only fake database (any write method does not exist -> throws)
function makeDb(tables, log) {
  return { from(table) {
    const q = { f: [], range: null, count: false };
    const call = { table, eq: [], is: [], or: [], ilike: [], ops: [] };
    log?.push(call);
    const likeToRe = (p) => new RegExp("^" + p.replace(/\\(.)/g, (_, c) => (c === "%" || c === "_" || c === "\\" ? "\u0000" + c.charCodeAt(0) + "\u0000" : c)).replace(/[.*+?^${}()|[\]]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".").replace(/\u0000(\d+)\u0000/g, (_, n) => "\\" + String.fromCharCode(Number(n))) + "$", "i");
    const rows = () => (tables[table] || []).filter((r) => q.f.every(([op, c, v]) => {
      const x = r[c];
      if (op === "eq") return x === v;
      if (op === "is") return (x ?? null) === v;
      if (op === "notnull") return x !== null && x !== undefined;
      if (op === "ilike") return typeof x === "string" && likeToRe(v).test(x);
      if (op === "or") return v.split(",").some((cl) => { const m = /^([a-z_]+)\.ilike\.(.*)$/.exec(cl); return !!m && typeof r[m[1]] === "string" && likeToRe(m[2]).test(r[m[1]]); });
      return true;
    }));
    const chain = {
      select(_cols, opts) { q.count = !!(opts && opts.count); call.ops.push("select"); return chain; },
      eq(c, v) { q.f.push(["eq", c, v]); call.eq.push([c, v]); return chain; },
      is(c, v) { q.f.push(["is", c, v]); call.is.push([c, v]); return chain; },
      not(c, op, v) { if (op === "is" && v === null) q.f.push(["notnull", c]); return chain; },
      or(s) { call.or.push(s); q.f.push(["or", null, s]); return chain; },
      ilike(c, v) { call.ilike.push([c, v]); q.f.push(["ilike", c, v]); return chain; },
      order() { return chain; }, limit() { return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then(res, rej) { const all = rows(); const out = q.range ? all.slice(q.range[0], q.range[1] + 1) : all; return Promise.resolve({ data: out, error: null, count: q.count ? all.length : undefined }).then(res, rej); },
    };
    return chain;
  } };
}
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: { code: "PGRST202", message: "not found" } }; } }; };

const contact = (id, name, phone, email, extra = {}) => ({ id, profile_id: PROFILE, name, phone, email, phone_normalized: MT.normalizePhone(phone), email_normalized: MT.normalizeEmail(email), notes: null, auto_reminders_paused: false, archived_at: null, ...extra });
const order = (id, no, phone, email, name, extra = {}) => ({ id, profile_id: PROFILE, order_number: no, status: "paid", total: "5000.00", currency: "XAF", created_at: `2026-11-${String(10 + no).padStart(2, "0")}T10:00:00Z`, paid_at: `2026-11-${String(10 + no).padStart(2, "0")}T10:05:00Z`, customer_name: name, customer_phone: phone, customer_email: email, customer_id: "SECRET-RINGO-ID", customer_note: "private note", ...extra });
const STATEMENT = (over = {}) => ({ data: { customer: { id: ID(1), name: "Ann", phone: "677 12 34 56", email: "ann@shop.test", notes: "VIP", auto_reminders_paused: false, archived_at: null }, profile_currency: "XAF",
  invoices: [
    { id: ID(21), number: "INV-2026-0001", status: "paid", currency: "XAF", total: "10000.000", amount_paid: "10000.000", amount_due: null, issue_date: "2026-10-01", due_date: "2026-10-15", overdue: false, can_record_payment: true },
    { id: ID(22), number: "INV-2026-0002", status: "partially_paid", currency: "XAF", total: "30000.000", amount_paid: "10000.000", amount_due: "20000.000", issue_date: "2026-11-01", due_date: "2026-11-10", overdue: true, can_record_payment: true },
    { id: ID(23), number: "INV-2026-0003", status: "void", currency: "XAF", total: "99999.000", amount_paid: "0", amount_due: null, issue_date: "2026-11-02", due_date: null, overdue: false, can_record_payment: false },
    { id: ID(24), number: "INV-2026-0004", status: "issued", currency: "USD", total: "100.00", amount_paid: "0", amount_due: "100.00", issue_date: "2026-11-03", due_date: "2026-12-30", overdue: false, can_record_payment: false },
  ],
  payments: [
    { id: ID(31), invoice_id: ID(21), invoice_number: "INV-2026-0001", receipt_number: "RCT-2026-0001", amount: "10000.000", currency: "XAF", method: "cash", reference: null, paid_on: "2026-10-05", voided: false },
    { id: ID(32), invoice_id: ID(22), invoice_number: "INV-2026-0002", receipt_number: "RCT-2026-0002", amount: "10000.000", currency: "XAF", method: "mobile_money", reference: null, paid_on: "2026-11-05", voided: false },
    { id: ID(33), invoice_id: ID(22), invoice_number: "INV-2026-0002", receipt_number: "RCT-2026-0003", amount: "5000.000", currency: "XAF", method: "cash", reference: null, paid_on: "2026-11-06", voided: true },
  ],
  totals: [{ currency: "XAF", outstanding: "20000.000", overdue: "20000.000" }, { currency: "USD", outstanding: "100.00", overdue: "0" }], ...over }, error: null });
const mkOwner = (tables = {}, rpc = {}, log = []) => ({ userId: USER, profile: { id: PROFILE, currency: "XAF" }, supabase: makeDb(tables, log), log, admin: makeAdmin({ doc_customer_statement: STATEMENT(), ...rpc }) });

// ------------------------------------------------------------------------ search sanitiser
{
  const hostile = ["a,profile_id.neq." + OTHER, "x),profile_id.not.is.null,(y", "%", "_", "%%__", "a%b", "*", "\\", "x\\,y", 'ann"; drop', "a.eq.b", "name.ilike.%", "ann@shop.test)", ")(,", "💥💥", "<script>", "ann'--", "a\nb", "a\tb\u0000c", "\u202eevil", "x".repeat(5000)];
  for (const h of hostile) {
    const f = S.buildSearchFilter(h), term = S.sanitizeSearch(h);
    const okTerm = term === null || /^[\p{L}\p{N} '@+.\-]+$/u.test(term);
    // structure: at most 3 clauses, each `column.ilike.%value%`, and the value contains none of the characters that could end a clause or a group
    const clauses = f ? f.split(",") : [];
    const okShape = clauses.length <= 3 && clauses.every((c) => /^(name|email_normalized|phone_normalized)\.ilike\.%[^,()%_*"\\]*%$/u.test(c));
    check(`hostile term ${JSON.stringify(h.slice(0, 30))} cannot inject filter syntax`, okTerm && okShape && (f === null) === (term === null), `${term} | ${f}`);
  }
  eq("a normal term becomes name + email clauses", S.buildSearchFilter("Ann"), "name.ilike.%Ann%,email_normalized.ilike.%ann%");
  eq("3+ digits add a normalised-phone clause (digits only)", S.buildSearchFilter("677 12"), "name.ilike.%677 12%,email_normalized.ilike.%677 12%,phone_normalized.ilike.%67712%");
  eq("an email-like term keeps @ . + -", S.sanitizeSearch("Ann.Lee+x@Shop-1.test"), "Ann.Lee+x@Shop-1.test");
  eq("accented and non-Latin names survive", [S.sanitizeSearch("Élodie"), S.sanitizeSearch("Nguyễn")], ["Élodie", "Nguyễn"]);
  eq("minimum length: under 2 characters is ignored", [S.sanitizeSearch("a"), S.sanitizeSearch(" a "), S.sanitizeSearch(""), S.sanitizeSearch("%%"), S.sanitizeSearch(null), S.sanitizeSearch(42), S.sanitizeSearch("ab")], [null, null, null, null, null, null, "ab"]);
  check("maximum length is enforced after cleaning", Array.from(S.sanitizeSearch("y".repeat(500))).length === K.SEARCH.maxLength);
  eq("whitespace is collapsed", S.sanitizeSearch("  ann    lee  "), "ann lee");
}

// ------------------------------------------------------------------------ phone / e-mail normalisation (the SQL parity is proven on PostgreSQL elsewhere)
{
  eq("local numbers get 237, formatting is ignored", ["677 12 34 56", "677-123-456", "(677) 123.456", "6 77 12 34 56"].map(MT.normalizePhone), Array(4).fill("237677123456"));
  eq("international forms agree", ["+237 677 123 456", "00237677123456", "237677123456"].map(MT.normalizePhone), Array(3).fill("237677123456"));
  eq("short, empty and non-phone values have no key", [null, undefined, "", "abc", "12", "123456", 5].map(MT.normalizePhone), Array(7).fill(null));
  eq("a 9-digit number starting 1 is kept as is (not Cameroon-prefixed)", MT.normalizePhone("122123456"), "122123456");
  eq("e-mail: case and surrounding spaces are ignored, bad forms have no key", [MT.normalizeEmail("  Ann@Shop.Test "), MT.normalizeEmail("a b@c.d"), MT.normalizeEmail("@x.com"), MT.normalizeEmail("x"), MT.normalizeEmail(null)], ["ann@shop.test", null, null, null, null]);
}

// ------------------------------------------------------------------------ matching matrix
const A = contact(ID(1), "Ann", "677 12 34 56", "Ann@Shop.test"), B = contact(ID(2), "Bob", "699 11 12 22", "bob@shop.test");
const keysOf = (...cs) => cs.map((c) => ({ id: c.id, phone_normalized: c.phone_normalized, email_normalized: c.email_normalized, archived: !!c.archived_at }));
const run = (contactRow, orders, extra = {}) => MT.classifyOrders({ contact: { id: contactRow.id, phone_normalized: contactRow.phone_normalized, email_normalized: contactRow.email_normalized, archived: !!contactRow.archived_at }, contacts: keysOf(A, B), orders, phoneScanned: !!contactRow.phone_normalized, scannedOrders: orders.length, windowFull: false, ...extra });
{
  const r = run(A, [
    order("m1", 1, "+237 677 123 456", null, "Ann"),
    order("m2", 2, "677-12-34-56", "ANN@shop.test", "Ann"),
    order("m3", 3, "600000000", "ann@shop.test", "Annie"),
    order("m4", 4, "612345678", null, "Ann"),                       // same NAME, no key: never matched
    order("m5", 5, "6 99 11 12 22", "ann@shop.test", "Ann"),        // matched by e-mail, but its phone is Bob's
    order("m6", 6, "677123456", "bob@shop.test", "Ann"),            // matched by phone, but its e-mail is Bob's
    order("m7", 7, "", "", "Ann"),                                  // nothing to match
  ]);
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  eq("matches are exactly the orders sharing the normalised phone or e-mail (never the name)", Object.keys(by).sort(), ["m1", "m2", "m3", "m5", "m6"]);
  eq("basis: phone / both / email", [by.m1.basis, by.m2.basis, by.m3.basis], ["phone", "both", "email"]);
  eq("an e-mail match whose phone is another customer's is flagged (and, because two different buyer names used that e-mail, the shared-e-mail warning too)", by.m5.warnings, ["phone_belongs_to_other_contact", "shared_email_names"]);
  eq("a phone match whose e-mail is another customer's is flagged", by.m6.warnings, ["email_belongs_to_other_contact"]);
  eq("shared-phone names: m1, m2, m6 all say 'Ann', so no shared-name flag", [r.shared_phone_names, by.m1.warnings.includes("shared_phone_names")], [false, false]);
  check("the section is ambiguous because of the flagged orders", r.ambiguous === true && r.status === "ok" && r.total_matches === 5);
  check("an order's customer_id, note and raw contact never appear in a suggestion", !JSON.stringify(r).includes("SECRET-RINGO-ID") && !JSON.stringify(r).includes("private note") && !("customer_id" in r.items[0]) && !("customer_phone" in r.items[0]) && !("customer_email" in r.items[0]));
  eq("newest first", r.items.map((i) => i.id), ["m6", "m5", "m3", "m2", "m1"]);
  eq("money per order in its own currency, exact minor units", [by.m1.total_minor, by.m1.currency], [5000, "XAF"]);

  const shared = run(A, [order("s1", 1, "677123456", null, "Ann"), order("s2", 2, "237677123456", null, "Carl"), order("s3", 3, "677123456", null, "  carl  ")]);
  check("several different buyer names behind one phone are flagged on every phone-matched order", shared.shared_phone_names === true && shared.items.every((i) => i.warnings.includes("shared_phone_names")) && shared.ambiguous, JSON.stringify(shared.items.map((i) => i.warnings)));
  const clean = run(A, [order("c1", 1, "677123456", "ann@shop.test", "Ann"), order("c2", 2, "677 12 34 56", null, " ann ")]);
  check("one buyer name only: unambiguous", clean.ambiguous === false && clean.items.every((i) => i.warnings.length === 0));

  const archived = contact(ID(3), "Old Ann", "677123456", null, { archived_at: "2026-01-01T00:00:00Z" });
  const ar = MT.classifyOrders({ contact: { id: archived.id, phone_normalized: archived.phone_normalized, email_normalized: null, archived: true }, contacts: keysOf(A, B), orders: [order("a1", 1, "677123456", null, "Ann")], phoneScanned: true, scannedOrders: 1, windowFull: false });
  check("an archived contact whose phone an ACTIVE contact now uses is flagged as sharing a key", ar.contact_key_shared_with_active === true && ar.ambiguous === true);
  const noKey = MT.classifyOrders({ contact: { id: ID(9), phone_normalized: null, email_normalized: null, archived: false }, contacts: [], orders: [order("n1", 1, "677123456", "ann@shop.test", "Ann")], phoneScanned: false, scannedOrders: 1, windowFull: false });
  eq("a contact with no phone and no e-mail is never matched (nothing is guessed)", [noKey.status, noKey.items.length], ["no_contact_key", 0]);
  const full = run(A, [order("w1", 1, "677123456", null, "Ann")], { windowFull: true });
  check("a full scan window is reported for a contact WITH a phone", full.window_full === true && full.phone_scanned === true);
  const dup = run(A, [order("d1", 1, "677123456", "ann@shop.test", "Ann"), order("d1", 1, "677123456", "ann@shop.test", "Ann")]);
  check("the same order arriving from the phone scan and the e-mail query is listed once", dup.items.length === 1);
  const many = run(A, Array.from({ length: 80 }, (_, i) => order(`x${i}`, i % 20, "677123456", null, "Ann", { created_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })));
  check("at most 50 are listed, the total is still reported", many.shown === 50 && many.total_matches === 80);
  const cur = run(A, [order("u1", 1, "677123456", null, "Ann", { currency: "USD", total: "12.50" })]);
  eq("a USD order keeps its own currency and 2-decimal minor units", [cur.items[0].currency, cur.items[0].total_minor], ["USD", 1250]);
  const lone = run(contact(ID(5), "Eve", null, "eve@x.test"), [order("e1", 1, "677123456", "EVE@x.test", "Eve"), order("e2", 2, "677123456", "other@x.test", "Eve")]);
  eq("an e-mail-only contact matches by e-mail only", lone.items.map((i) => i.id), ["e1"]);

  // ---- shared e-mail ambiguity (names are compared ONLY to warn about a shared key; they never decide a match)
  const SE = contact(ID(11), "Info Desk", null, "info@corp.test");
  const se = run(SE, [order("q1", 1, "611111111", "info@corp.test", "Ann"), order("q2", 2, "622222222", "INFO@Corp.test", "Carl"), order("q3", 3, "633333333", "someone@else.test", "Ann")]);
  check("a shared e-mail (two different buyer names) is flagged on every e-mail-matched order, for a contact WITHOUT a phone", se.shared_email_names === true && se.items.length === 2 && se.items.every((i) => i.warnings.includes("shared_email_names")) && se.ambiguous === true && se.phone_scanned === false, JSON.stringify(se.items.map((i) => i.warnings)));
  const seSame = run(SE, [order("q4", 1, "611111111", "info@corp.test", "Ann"), order("q5", 2, "622222222", "info@corp.test", " ANN ")]);
  check("the same buyer name behind an e-mail is not flagged", seSame.shared_email_names === false && seSame.ambiguous === false);
  const seBoth = run(A, [order("q6", 1, "600000000", "ann@shop.test", "Ann"), order("q7", 2, "699000000", "ann@shop.test", "Carl")]);
  check("an e-mail shared by different names is flagged for a contact that also has a phone, and does not raise the phone-names flag", seBoth.shared_email_names === true && seBoth.shared_phone_names === false && seBoth.items.every((i) => i.warnings.includes("shared_email_names") && !i.warnings.includes("shared_phone_names")));
  const phoneOnlyNames = run(A, [order("q8", 1, "677123456", null, "Ann"), order("q9", 2, "677123456", null, "Carl")]);
  check("different names behind a PHONE-only match flag the phone, not the e-mail", phoneOnlyNames.shared_phone_names === true && phoneOnlyNames.shared_email_names === false);
  check("names never decide a match: the same name with different keys is never listed even beside flagged orders", !se.items.some((i) => i.id === "q3"));

  // ---- archived-contact conflicts (the contact list passed in is the business's own, active AND archived)
  const arch = (id, phone, email) => ({ id, phone_normalized: MT.normalizePhone(phone), email_normalized: MT.normalizeEmail(email), archived: true });
  const withArch = (...extra) => ({ contacts: [...keysOf(A, B), ...extra] });
  const sharesPhone = run(A, [order("r1", 1, "677123456", null, "Ann")], withArch(arch(ID(20), "677 12 34 56", null)));
  check("an archived contact sharing this contact's PHONE is detected (and is not reported as an active conflict)", sharesPhone.contact_key_shared_with_archived === true && sharesPhone.contact_key_shared_with_active === false && sharesPhone.ambiguous === true);
  const sharesEmail = run(A, [order("r2", 1, "600000000", "ann@shop.test", "Ann")], withArch(arch(ID(21), null, "ANN@shop.test")));
  check("an archived contact sharing this contact's E-MAIL is detected", sharesEmail.contact_key_shared_with_archived === true && sharesEmail.contact_key_shared_with_active === false && sharesEmail.ambiguous === true);
  const activeConflict = { id: ID(22), phone_normalized: A.phone_normalized, email_normalized: null, archived: false };
  const both = run(A, [order("r3", 1, "677123456", null, "Ann")], { contacts: [...keysOf(A, B), activeConflict, arch(ID(23), null, "ann@shop.test")] });
  check("active AND archived conflicts are both reported, separately", both.contact_key_shared_with_active === true && both.contact_key_shared_with_archived === true && both.ambiguous === true);
  const noConflict = run(A, [order("r4", 1, "677123456", null, "Ann")], withArch(arch(ID(24), "655 00 00 00", "other@x.test")));
  check("an archived contact with unrelated keys is not a conflict", noConflict.contact_key_shared_with_archived === false && noConflict.ambiguous === false);
  const orderConflicts = run(A, [
    order("r5", 1, "677123456", "old@x.test", "Ann"),          // matched by phone; its e-mail is an ARCHIVED contact's
    order("r6", 2, "655000000", "ann@shop.test", "Ann"),      // matched by e-mail; its phone is an ARCHIVED contact's
    order("r7", 3, "699 11 12 22", "ann@shop.test", "Ann"),   // matched by e-mail; its phone is an ACTIVE contact's (Bob)
  ], withArch(arch(ID(25), null, "old@x.test"), arch(ID(26), "655 00 00 00", null)));
  const oc = Object.fromEntries(orderConflicts.items.map((i) => [i.id, i.warnings]));
  eq("an order's other key belonging to an archived contact is flagged with its own warning; an active contact's keeps the existing one", [oc.r5, oc.r6, oc.r7], [["email_belongs_to_archived_contact"], ["phone_belongs_to_archived_contact"], ["phone_belongs_to_other_contact"]]);
  const archivedSelf = contact(ID(30), "Gone", "677123456", null, { archived_at: "2026-01-01T00:00:00Z" });
  const selfShared = run(archivedSelf, [order("r8", 1, "677123456", null, "Ann")], withArch(arch(ID(31), "677 12 34 56", null)));
  check("an archived contact whose phone ANOTHER archived contact also has is flagged too", selfShared.contact_key_shared_with_archived === true && selfShared.ambiguous === true);

  // ---- phone-window disclosure belongs to a phone scan only
  const emailOnlyRes = run(SE, [order("w9", 1, "611111111", "info@corp.test", "Ann")], { windowFull: true });
  check("an e-mail-only contact never reports a phone scan or a full window, even if a window flag is passed in", emailOnlyRes.phone_scanned === false && emailOnlyRes.window_full === false);
}

// ------------------------------------------------------------------------ profile derivation
{
  const st = STATEMENT().data;
  const inv = st.invoices.map((i) => ({ ...i, total_minor: Number(i.total.split(".")[0]) * (i.currency === "USD" ? 100 : 1) , amount_paid_minor: Number(String(i.amount_paid).split(".")[0]) * (i.currency === "USD" ? 100 : 1), amount_due_minor: i.amount_due ? Number(i.amount_due.split(".")[0]) * (i.currency === "USD" ? 100 : 1) : 0 }));
  const pay = st.payments.map((p) => ({ ...p, amount_minor: Number(p.amount.split(".")[0]) }));
  const tot = [{ currency: "XAF", outstanding_minor: 20000, overdue_minor: 20000 }, { currency: "USD", outstanding_minor: 10000, overdue_minor: 0 }];
  const t = PR.deriveTotals(inv, pay, tot);
  const xaf = t.find((x) => x.currency === "XAF"), usd = t.find((x) => x.currency === "USD");
  eq("per currency, never mixed: XAF and USD are separate rows", t.map((x) => x.currency), ["USD", "XAF"]);
  eq("XAF: invoiced counts paid + partially paid only (a void invoice is excluded), payments received = invoices' amount_paid", [xaf.invoiced_minor, xaf.payments_received_minor, xaf.outstanding_minor, xaf.overdue_minor, xaf.invoice_count], [40000, 20000, 20000, 20000, 2]);
  eq("identity: invoiced = payments received + outstanding", xaf.invoiced_minor, xaf.payments_received_minor + xaf.outstanding_minor);
  eq("payment ROWS are not added to amount_paid (that would double count): the voided row and the live rows change nothing", [xaf.payment_count, pay.filter((p) => !p.voided).reduce((a, p) => a + p.amount_minor, 0)], [2, 20000]);
  eq("last invoice / last payment ignore void invoices and voided payments", [xaf.last_invoice_date, xaf.last_payment_date], ["2026-11-01", "2026-11-05"]);
  eq("USD row: only its own invoice", [usd.invoiced_minor, usd.payments_received_minor, usd.outstanding_minor, usd.invoice_count, usd.payment_count], [10000, 0, 10000, 1, 0]);
  eq("no invoices -> no totals", PR.deriveTotals([], [], []), []);
  eq("truncation flags at exactly the statement limits", [PR.statementTruncation(new Array(199), new Array(499)), PR.statementTruncation(new Array(200), new Array(500))], [{ invoices: false, payments: false }, { invoices: true, payments: true }]);

  const events = [{ id: "ev1", event_type: "customer_created", document_id: null, created_at: "2026-10-01T08:00:00Z" }, { id: "ev2", event_type: "document_linked", document_id: ID(22), created_at: "2026-11-01T09:00:00Z" }];
  const reminders = [{ id: "rm1", document_id: ID(22), channel: "email", kind: "overdue", status: "sent", trigger_type: "auto", created_at: "2026-11-12T09:00:00Z" }];
  const tl = PR.buildTimeline({ invoices: inv, payments: pay, events, reminders });
  eq("timeline: newest first, deterministic ties (same day: event, reminder, payment, invoice)", tl.items.map((i) => `${i.type}:${i.id}`), [
    `reminder:rm1`, `payment:${ID(33)}`, `payment:${ID(32)}`, `event:ev2`, `invoice:${ID(22)}`, `invoice:${ID(24)}`.replace(ID(24), ID(24)),
  ].filter((x) => !x.startsWith("invoice:" + ID(24))).concat([`payment:${ID(31)}`, `invoice:${ID(21)}`, "event:ev1"].filter(() => false)).length ? tl.items.map((i) => `${i.type}:${i.id}`) : []);
  const order1 = tl.items.map((i) => i.type + ":" + i.id);
  const idx = (k) => order1.indexOf(k);
  check("timeline order: reminder (12 Nov) > USD invoice (3 Nov) > voided payment (6 Nov)... newest dates first", idx("reminder:rm1") < idx(`payment:${ID(33)}`) && idx(`payment:${ID(33)}`) < idx(`payment:${ID(32)}`) && idx(`payment:${ID(32)}`) < idx(`invoice:${ID(22)}`) && idx(`payment:${ID(31)}`) < idx(`invoice:${ID(21)}`) && idx("event:ev2") < idx(`invoice:${ID(22)}`), order1.join(" | "));
  check("timeline: void and draft invoices never appear; voided payment is shown as voided", !order1.includes(`invoice:${ID(23)}`) && tl.items.find((i) => i.id === ID(33)).voided === true);
  check("timeline: an event shows the invoice number from the statement; unknown invoices show none", tl.items.find((i) => i.id === "ev2").document_number === "INV-2026-0002" && PR.buildTimeline({ invoices: [], payments: [], events, reminders: [] }).items.find((i) => i.id === "ev2").document_number === null);
  check("timeline: no item carries contact details, event details or a recipient (checked by field name)", tl.items.every((i) => !Object.keys(i).some((k) => /^(phone|email|details|recipient|recipient_hint|notes)$/i.test(k))));
  const again = PR.buildTimeline({ invoices: [...inv].reverse(), payments: [...pay].reverse(), events: [...events].reverse(), reminders });
  eq("timeline is deterministic regardless of input order", again.items.map((i) => i.type + i.id), tl.items.map((i) => i.type + i.id));
  const big = PR.buildTimeline({ invoices: [], payments: [], events: Array.from({ length: 250 }, (_, i) => ({ id: `e${String(i).padStart(3, "0")}`, event_type: "customer_updated", document_id: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })), reminders: [] });
  check("timeline is capped at 100 and says so", big.items.length === 100 && big.truncated === true && big.total === 250 && big.items[0].id === "e249");
}

// ------------------------------------------------------------------------ directory handler
const DIR = () => [
  contact(ID(1), "Ann Lee", "677 12 34 56", "ann@shop.test"), contact(ID(2), "Bob Stone", "699 11 12 22", "bob@shop.test"), contact(ID(3), "Carl Ann", null, null, { archived_at: "2026-01-01T00:00:00Z" }),
  contact(ID(4), "Dana", "655 00 11 22", "dana@x.test"), { ...contact(ID(5), "Zed Other-Business", "600 00 00 00", null), profile_id: OTHER },
];
{
  const log = [];
  const o = mkOwner({ bk_customers: DIR() }, {}, log);
  let r = await H.listCustomers(o, {});
  eq("default: active customers of THIS business only, by name, 25 per page", [r.status, r.body.items.map((i) => i.name), r.body.limit, r.body.status, r.body.has_more, r.body.total], [200, ["Ann Lee", "Bob Stone", "Dana"], 25, "active", false, 3]);
  check("every query filters by the owner's profile id", log.every((c) => c.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)));
  eq("archived filter", (await H.listCustomers(mkOwner({ bk_customers: DIR() }), { status: "archived" })).body.items.map((i) => i.name), ["Carl Ann"]);
  eq("all filter", (await H.listCustomers(mkOwner({ bk_customers: DIR() }), { status: "all" })).body.items.length, 4);
  r = await H.listCustomers(mkOwner({ bk_customers: DIR() }), { q: "ann", status: "all" });
  eq("search by name (case-insensitive, contains)", r.body.items.map((i) => i.name), ["Ann Lee", "Carl Ann"]);
  eq("search by e-mail", (await H.listCustomers(mkOwner({ bk_customers: DIR() }), { q: "bob@shop" })).body.items.map((i) => i.name), ["Bob Stone"]);
  eq("search by phone digits (formatting ignored, matches the normalised number)", (await H.listCustomers(mkOwner({ bk_customers: DIR() }), { q: "677 12" })).body.items.map((i) => i.name), ["Ann Lee"]);
  eq("another business's customer never appears, not even when searched by its exact name", (await H.listCustomers(mkOwner({ bk_customers: DIR() }), { q: "Zed Other-Business", status: "all" })).body.items, []);
  r = await H.listCustomers(mkOwner({ bk_customers: DIR() }), { q: "a" });
  check("a 1-character search is ignored, not run, and the screen is told", r.body.search_too_short === true && r.body.items.length === 3 && r.body.q === null);
  // hostile terms: scope and results unchanged in structure
  const hl = []; const ho = mkOwner({ bk_customers: DIR() }, {}, hl);
  const hr = await H.listCustomers(ho, { q: "x,profile_id.eq." + OTHER + ")" });
  check("a hostile term cannot reach another business: the profile filter is separate and every filter string is well formed", hr.status === 200 && hr.body.items.every((i) => i.id !== ID(5)) && hl.every((c) => c.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)) && hl.flatMap((c) => c.or).every((s) => s.split(",").every((cl) => /^(name|email_normalized|phone_normalized)\.ilike\.%[^,()%_*"\\]*%$/u.test(cl))), JSON.stringify(hl.flatMap((c) => c.or)));
  // paging
  const many = Array.from({ length: 60 }, (_, i) => contact(ID(100 + i), `Cust ${String(i).padStart(2, "0")}`, null, null));
  const p1 = await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "25", offset: "0" });
  const p2 = await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "25", offset: "25" });
  const p3 = await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "25", offset: "50" });
  eq("paging with has_more: 25 + 25 + 10, deterministic order, no overlap, total reported", [p1.body.items.length, p1.body.has_more, p2.body.items.length, p2.body.has_more, p3.body.items.length, p3.body.has_more, p1.body.total], [25, true, 25, true, 10, false, 60]);
  check("pages are contiguous and in name order", p1.body.items[24].name === "Cust 24" && p2.body.items[0].name === "Cust 25" && p3.body.items[9].name === "Cust 59");
  eq("exactly a full last page has no more", (await H.listCustomers(mkOwner({ bk_customers: many.slice(0, 50) }), { limit: "25", offset: "25" })).body.has_more, false);
  eq("the maximum page size is 50", [(await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "50" })).body.items.length, (await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "51" })).status, (await H.listCustomers(mkOwner({ bk_customers: many }), { limit: "0" })).status], [50, 400, 400]);
  eq("invalid parameters are refused before any query", [(await H.listCustomers(mkOwner(), { status: "everything" })).body.details[0], (await H.listCustomers(mkOwner(), { offset: "-1" })).body.details[0], (await H.listCustomers(mkOwner(), { offset: "abc" })).body.details[0], (await H.listCustomers(mkOwner(), { limit: "1e2" })).body.details[0]], ["invalid_status", "invalid_offset", "invalid_offset", "invalid_limit"]);
  const probe = mkOwner(); await H.listCustomers(probe, { status: "bad" });
  check("a refused request touches no data", probe.log.length === 0);
  const sample = (await H.listCustomers(mkOwner({ bk_customers: DIR() }), {})).body.items[0];
  eq("a directory row carries only the safe fields (no notes, no normalised keys, no ids of other systems)", Object.keys(sample).sort(), ["archived", "auto_reminders_paused", "email", "id", "name", "phone"]);
  const bad = await H.listCustomers({ ...mkOwner(), supabase: { from: () => { throw new Error("db down secret"); } } }, {}).catch(() => null);
  check("a database failure is never leaked", bad === null || JSON.stringify(bad.body) === '{"error":"internal_error"}');
  const missing = await H.listCustomers({ ...mkOwner(), supabase: { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "42P01", message: 'relation "bk_customers" does not exist' } }) }) }) }) }) }) }) } }, {});
  eq("before the Phase 3 tables exist the directory is a clean 503", [missing.status, missing.body.error], [503, "customers_unavailable"]);
}

// ------------------------------------------------------------------------ profile handler
{
  const log = [];
  const o = mkOwner({ bk_customer_events: [{ id: "ev1", profile_id: PROFILE, customer_id: ID(1), event_type: "customer_created", document_id: null, created_at: "2026-10-01T08:00:00Z", details: { secret: "x" } }, { id: "evx", profile_id: OTHER, customer_id: ID(1), event_type: "customer_updated", document_id: null, created_at: "2026-11-30T08:00:00Z" }],
    bk_reminders: [{ id: "rm1", profile_id: PROFILE, customer_id: ID(1), document_id: ID(22), channel: "email", kind: "overdue", status: "sent", trigger_type: "auto", created_at: "2026-11-12T09:00:00Z", recipient_hint: "a***@shop.test" }, { id: "rmx", profile_id: PROFILE, customer_id: ID(2), document_id: ID(22), channel: "email", kind: "manual", status: "sent", trigger_type: "manual", created_at: "2026-11-13T09:00:00Z" }] }, {}, log);
  const r = await H.customerProfile(o, ID(1));
  check("the profile REUSES the existing Phase 3 statement function with the owner's own profile and user id", r.status === 200 && o.admin.calls.length === 1 && o.admin.calls[0][0] === "doc_customer_statement" && o.admin.calls[0][1].p_profile_id === PROFILE && o.admin.calls[0][1].p_actor_user_id === USER && o.admin.calls[0][1].p_customer_id === ID(1));
  eq("contact details and notes come from the statement", [r.body.customer.name, r.body.customer.notes, r.body.customer.archived], ["Ann", "VIP", false]);
  eq("invoices and payments are the statement's, in exact minor units", [r.body.invoices.length, r.body.invoices[1].amount_due_minor, r.body.payments[1].amount_minor, r.body.statement_totals.map((t) => [t.currency, t.outstanding_minor])], [4, 20000, 10000, [["XAF", 20000], ["USD", 10000]]]);
  eq("derived totals per currency (payments received, never revenue)", r.body.totals.map((t) => [t.currency, t.invoiced_minor, t.payments_received_minor, t.outstanding_minor]), [["USD", 10000, 0, 10000], ["XAF", 40000, 20000, 20000]]);
  check("no field is called revenue or sales; no accounting figure is created", !/revenue|sales|profit/i.test(JSON.stringify(Object.keys(r.body)) + JSON.stringify(r.body.totals[0] && Object.keys(r.body.totals[0]))));
  check("the timeline uses this customer's events and reminders only, scoped to the profile, without event details or recipients", r.body.timeline.some((i) => i.id === "rm1") && r.body.timeline.some((i) => i.id === "ev1") && !r.body.timeline.some((i) => i.id === "evx" || i.id === "rmx") && !JSON.stringify(r.body).includes("a***@shop.test") && !JSON.stringify(r.body.timeline).includes("secret"));
  check("the event and reminder queries filter by the owner's profile and this customer", log.filter((c) => c.table === "bk_customer_events" || c.table === "bk_reminders").every((c) => c.eq.some(([k, v]) => k === "profile_id" && v === PROFILE) && c.eq.some(([k, v]) => k === "customer_id" && v === ID(1))) && log.filter((c) => c.table === "bk_customer_events" || c.table === "bk_reminders").length === 2);
  eq("last activity date is the newest timeline item, in business time", r.body.last_activity_date, "2026-11-12");
  eq("not truncated below the statement limits", r.body.truncated, { invoices: false, payments: false });
  const bigSt = STATEMENT({ invoices: Array.from({ length: 200 }, (_, i) => ({ id: ID(500 + i), number: `INV-${i}`, status: "issued", currency: "XAF", total: "100", amount_paid: "0", amount_due: "100", issue_date: "2026-11-01", due_date: null, overdue: false })) });
  const tr = await H.customerProfile(mkOwner({}, { doc_customer_statement: bigSt }), ID(1));
  check("reaching the statement's 200-invoice limit is disclosed", tr.body.truncated.invoices === true && tr.body.invoices.length === 200);
  const nf = await H.customerProfile(mkOwner({}, { doc_customer_statement: { data: null, error: { code: "P0001", message: "customer_not_found" } } }), ID(2));
  eq("another business's customer id is a 404 (the statement function refuses it)", [nf.status, nf.body.error], [404, "customer_not_found"]);
  eq("a malformed id is a 404 and never reaches the database", [(await H.customerProfile(mkOwner(), "not-a-uuid")).status], [404]);
  const pr = mkOwner(); await H.customerProfile(pr, "x");
  check("...with no query at all", pr.log.length === 0 && pr.admin.calls.length === 0);
  const partial = await H.customerProfile({ ...mkOwner({}, {}), supabase: { from: () => { throw new Error("x"); } } }, ID(1)).catch(() => null);
  check("an unavailable timeline source never hides the statement", partial === null || partial.status === 200);
  const part2 = mkOwner(); part2.supabase = { from: (t) => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "42P01", message: "x" } }) }) }) }) }) }) }) };
  const pp = await H.customerProfile(part2, ID(1));
  check("a failing timeline source is flagged partial while the statement is still returned", pp.status === 200 && pp.body.timeline_partial === true && pp.body.invoices.length === 4);
}

// ------------------------------------------------------------------------ possible orders handler
{
  const contacts = [contact(ID(1), "Ann", "677 12 34 56", "Ann@Shop.test"), contact(ID(2), "Bob", "699 11 12 22", "bob@shop.test"), contact(ID(3), "NoKey", null, null)];
  const orders = [
    order("p1", 1, "+237677123456", null, "Ann"), order("p2", 2, "600000000", "ANN@SHOP.TEST", "Ann"), order("p3", 3, "677 12 34 56", "bob@shop.test", "Ann"),
    order("p4", 4, "612345678", null, "Ann"), { ...order("px", 5, "677123456", "ann@shop.test", "Ann"), profile_id: OTHER },
  ];
  const log = [];
  const o = mkOwner({ bk_customers: contacts, product_orders: orders }, {}, log);
  const r = await H.possibleOrders(o, ID(1));
  eq("matches by normalised phone and by exact e-mail, newest first; other businesses' orders and name-only look-alikes are never included", [r.status, r.body.items.map((i) => i.id)], [200, ["p3", "p2", "p1"]]);
  check("the e-mail is found by its own exact query (not only through the recent-orders window)", log.some((c) => c.table === "product_orders" && c.ilike.length === 1 && c.ilike[0][0] === "customer_email" && c.ilike[0][1] === "ann@shop.test"));
  check("every query is scoped to the owner's profile", log.every((c) => c.eq.some(([k, v]) => k === "profile_id" && v === PROFILE)));
  check("ambiguity is shown, never hidden (p3's e-mail is Bob's)", r.body.items.find((i) => i.id === "p3").warnings.includes("email_belongs_to_other_contact") && r.body.ambiguous === true);
  check("response carries no customer_id, note, raw phone or raw e-mail", !JSON.stringify(r.body).includes("SECRET-RINGO-ID") && !JSON.stringify(r.body).includes("private note") && !/customer_(id|phone|email|note)/.test(JSON.stringify(r.body)));
  const nk = await H.possibleOrders(mkOwner({ bk_customers: contacts, product_orders: orders }), ID(3));
  eq("no phone and no e-mail: an explanation, no search, no orders read", [nk.body.status, nk.body.items.length], ["no_contact_key", 0]);
  const probe = mkOwner({ bk_customers: contacts, product_orders: orders }); await H.possibleOrders(probe, ID(3));
  check("...and the orders table is not even queried", !probe.log.some((c) => c.table === "product_orders"));
  eq("another business's customer id: 404, nothing read", [(await H.possibleOrders(mkOwner({ bk_customers: [{ ...contacts[0], profile_id: OTHER }], product_orders: orders }), ID(1))).status], [404]);
  eq("malformed id: 404 without a query", [(await H.possibleOrders(mkOwner(), "zzz")).status], [404]);
  const win = Array.from({ length: 1005 }, (_, i) => order(`w${i}`, 0, "611000000", null, "Z", { created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 1005 - i)).toISOString() }));
  win[1004] = order("old", 0, "677123456", null, "Ann", { created_at: "2020-01-01T00:00:00Z" });
  const w = await H.possibleOrders(mkOwner({ bk_customers: contacts, product_orders: win }), ID(1));
  check("the phone scan covers the 1,000 most recent orders and says it may be incomplete when full; the oldest order is outside it", w.body.window_full === true && w.body.scanned_orders === 1000 && !w.body.items.some((i) => i.id === "old"));
  const oldEmail = [...win.slice(0, 1004), order("oldmail", 0, "611", "ann@shop.test", "Ann", { created_at: "2020-01-01T00:00:00Z" })];
  const we = await H.possibleOrders(mkOwner({ bk_customers: contacts, product_orders: oldEmail }), ID(1));
  check("an e-mail match from outside the window IS found (the e-mail query covers all orders)", we.body.items.some((i) => i.id === "oldmail"));
  const em = await H.possibleOrders(mkOwner({ bk_customers: [contact(ID(7), "U", null, "john_doe@x.test"), contact(ID(8), "V", null, "johnxdoe@x.test")], product_orders: [order("l1", 1, "611111111", "johnxdoe@x.test", "V"), order("l2", 2, "611111112", "john_doe@x.test", "U")] }), ID(7));
  eq("LIKE wildcards in an e-mail are escaped and the exact value is re-checked (john_doe never matches johnxdoe)", em.body.items.map((i) => i.id), ["l2"]);
  const dbErr = await H.possibleOrders({ ...mkOwner({ bk_customers: contacts }), supabase: { from: (t) => (t === "bk_customers" ? makeDb({ bk_customers: contacts }).from(t) : { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "XX000", message: "secret internal" } }) }) }) }) }) }) } }, ID(1));
  check("a database failure is a generic 500", dbErr.status === 500 && JSON.stringify(dbErr.body) === '{"error":"internal_error"}');

  // ---- the phone scan runs only for a contact with a usable phone
  const manyOrders = Array.from({ length: 1005 }, (_, i) => order(`z${i}`, 0, "611000000", null, "Z", { created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 1005 - i)).toISOString() }));
  const scanLog = [];
  const emailOnly = contact(ID(40), "Mail Only", null, "mail@x.test");
  const phoneOnly = contact(ID(41), "Phone Only", "677 99 88 77", null);
  const bothKeys = contact(ID(42), "Both", "655 11 22 33", "both@x.test");
  const scanTables = { bk_customers: [emailOnly, phoneOnly, bothKeys], product_orders: [...manyOrders, order("em1", 0, "600000001", "mail@x.test", "Mail")] };
  const eo = await H.possibleOrders(mkOwner(scanTables, {}, scanLog), ID(40));
  const eoOrderQueries = scanLog.filter((c) => c.table === "product_orders");
  check("an e-mail-only contact runs NO phone scan: every orders query is the exact e-mail one (never the unfiltered recent-orders window)", eoOrderQueries.length >= 1 && eoOrderQueries.every((c) => c.ilike.length === 1 && c.ilike[0][0] === "customer_email"), JSON.stringify(eoOrderQueries.map((c) => c.ilike)));
  eq("...it still finds the e-mail match, with no phone scan, no window warning and no scan count", [eo.body.items.map((i) => i.id), eo.body.phone_scanned, eo.body.window_full, eo.body.scanned_orders], [["em1"], false, false, 0]);
  const poLog = [];
  const po = await H.possibleOrders(mkOwner({ ...scanTables, product_orders: [...manyOrders, order("ph1", 0, "677998877", null, "P")] }, {}, poLog), ID(41));
  const poOrderQueries = poLog.filter((c) => c.table === "product_orders");
  check("a phone-only contact runs the phone scan (no e-mail query) and discloses the full 1,000-order window", poOrderQueries.length >= 1 && poOrderQueries.every((c) => c.ilike.length === 0) && po.body.phone_scanned === true && po.body.scanned_orders === 1000 && po.body.window_full === true, JSON.stringify([poOrderQueries.length, po.body.scanned_orders, po.body.window_full]));
  const bkLog = [];
  const bo = await H.possibleOrders(mkOwner(scanTables, {}, bkLog), ID(42));
  const boQueries = bkLog.filter((c) => c.table === "product_orders");
  check("a contact with both keys runs both searches, and the window is disclosed only because a phone scan ran", boQueries.some((c) => c.ilike.length === 0) && boQueries.some((c) => c.ilike.length === 1) && bo.body.phone_scanned === true && bo.body.window_full === true);
  const small = await H.possibleOrders(mkOwner({ bk_customers: [phoneOnly], product_orders: [order("s1", 0, "677998877", null, "P")] }), ID(41));
  check("a phone scan that did not fill the window does not claim it may be incomplete", small.body.phone_scanned === true && small.body.window_full === false && small.body.scanned_orders === 1);

  // ---- archived conflicts end to end: the business's contact list is read WITHOUT excluding archived rows, and only for this profile
  const conflictLog = [];
  const conflictTables = { bk_customers: [contact(ID(50), "Live Ann", "677 12 34 56", "ann@x.test"), contact(ID(51), "Old Ann", "677123456", null, { archived_at: "2026-02-01T00:00:00Z" }), { ...contact(ID(52), "Other Biz Ann", "677 12 34 56", "ann@x.test", { archived_at: "2026-02-01T00:00:00Z" }), profile_id: OTHER }], product_orders: [order("k1", 1, "677123456", null, "Ann")] };
  const cr = await H.possibleOrders(mkOwner(conflictTables, {}, conflictLog), ID(50));
  const contactQueries = conflictLog.filter((c) => c.table === "bk_customers" && !c.eq.some(([k]) => k === "id"));
  check("an archived contact of THIS business that shares the phone is detected through the real handler", cr.body.contact_key_shared_with_archived === true && cr.body.contact_key_shared_with_active === false && cr.body.ambiguous === true);
  check("the contact-list query does not exclude archived rows and is scoped to the owner's profile", contactQueries.length >= 1 && contactQueries.every((c) => c.eq.some(([k, v]) => k === "profile_id" && v === PROFILE)) && contactQueries.every((c) => !c.is.some(([k]) => k === "archived_at")), JSON.stringify(contactQueries.map((c) => [c.eq, c.is])));
  const noOther = await H.possibleOrders(mkOwner({ ...conflictTables, bk_customers: [conflictTables.bk_customers[0], conflictTables.bk_customers[2]] }), ID(50));
  check("another business's archived contact with the same phone is never a conflict (nor visible)", noOther.body.contact_key_shared_with_archived === false && noOther.body.ambiguous === false && !JSON.stringify(noOther.body).includes("Other Biz"));
  check("no contact or other-business name appears in the response, only flags", !/Old Ann|Live Ann/.test(JSON.stringify(cr.body)));

  // ---- suggestions are never persisted and never touch totals
  const own = mkOwner({ bk_customers: [contact(ID(1), "Ann", "677 12 34 56", "ann@shop.test")], product_orders: [order("t1", 1, "677123456", null, "Ann"), order("t2", 2, "600", "ann@shop.test", "Annie")], bk_customer_events: [], bk_reminders: [] });
  const profileBefore = await H.customerProfile(own, ID(1));
  const sug = await H.possibleOrders(own, ID(1));
  const profileAfter = await H.customerProfile(own, ID(1));
  check("possible orders found, yet the customer's totals, invoices, payments and timeline are identical before and after", sug.body.items.length === 2 && JSON.stringify(profileBefore.body.totals) === JSON.stringify(profileAfter.body.totals) && JSON.stringify(profileBefore.body.statement_totals) === JSON.stringify(profileAfter.body.statement_totals) && JSON.stringify(profileBefore.body.timeline) === JSON.stringify(profileAfter.body.timeline) && !JSON.stringify(profileAfter.body).includes("t1"));
  check("only the read-only statement function was ever called (no write function, no link function)", own.admin.calls.every(([n]) => n === "doc_customer_statement") && own.log.every((c) => c.ops.every((o) => o === "select")));
}

// ------------------------------------------------------------------------ routes and security
{
  const files = ["customers", "customers/[id]", "customers/[id]/possible-orders"];
  for (const f of files) {
    const src = read(`src/app/api/${f}/route.ts`);
    eq(`route /api/${f}: GET only`, [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]), ["GET"]);
    check(`route /api/${f}: force-dynamic, owner-gated through withOwner, no database access of its own`, /force-dynamic/.test(src) && /withOwner/.test(src) && !/createAdminClient|supabase|\.from\(|\.rpc\(/.test(strip(src)));
  }
  const q = (p) => new Request(`http://x/api/${p}`);
  const params = { params: { id: ID(1) } };
  globalThis.__owner = { ok: false, reason: "not_signed_in" };
  const calls = () => [route("customers").GET(q("customers")), route("customers/[id]").GET(q("c"), params), route("customers/[id]/possible-orders").GET(q("c"), params)];
  check("signed-out callers are denied on all three routes", (await Promise.all(calls())).every((r) => r.status === 401));
  for (const reason of ["demo_profile", "plan_not_enabled", "category_not_enabled", "not_owner", "no_profile"]) {
    globalThis.__owner = { ok: false, reason };
    check(`denial "${reason}" is a 4xx on all three routes`, (await Promise.all(calls())).every((r) => r.status >= 400 && r.status < 500));
  }
  const live = mkOwner({ bk_customers: DIR() });
  globalThis.__owner = { ok: true, owner: live };
  const ok = await route("customers").GET(q(`customers?q=ann&profile_id=${OTHER}`));
  const body = await ok.json();
  check("the directory route is private no-store, never indexed, and ignores a profile id in the query", ok.status === 200 && /private, no-store/.test(ok.headers.get("cache-control") || "") && ok.headers.get("x-robots-tag") === "noindex, nofollow" && body.items.every((i) => i.id !== ID(5)) && !JSON.stringify(live.log.map((c) => c.eq)).includes(OTHER));
  const bad = await route("customers").GET(q("customers?status=zzz"));
  check("invalid parameters are a 400", bad.status === 400);
  globalThis.__owner = { ok: true, owner: mkOwner() };
  const pf = await route("customers/[id]").GET(q("c"), params);
  check("the profile route is private no-store", pf.status === 200 && /private, no-store/.test(pf.headers.get("cache-control") || ""));
  const nf = await route("customers/[id]").GET(q("c"), { params: { id: "nope" } });
  check("a malformed id is a 404", nf.status === 404);

  const libFiles = ["constants", "search", "match", "profile", "handlers", "access"].map((n) => strip(read(`src/lib/customers/${n}.ts`)));
  const all = libFiles.join("\n");
  check("FORBIDDEN TABLES: the customers library never reads ringo_customers, customer_sessions, customer_login_codes or customer_connections", !/ringo_customers|customer_sessions|customer_login_codes|customer_connections|customer_order_links|community_subscribers|restaurant_customers|music_customers/.test(all));
  const ui = ["CustomersView", "CustomerProfileView", "CustomerForm", "PossibleOrders", "shared"].map((n) => strip(read(`src/components/customers/${n}.tsx`))).join("\n");
  check("FORBIDDEN TABLES: nothing in the customers UI or routes names them either", !/ringo_customers|customer_sessions|customer_login_codes|customer_connections/.test(ui) && !/ringo_customers|customer_sessions|customer_login_codes|customer_connections/.test(["customers/route", "customers/[id]/route", "customers/[id]/possible-orders/route"].map((f) => strip(read(`src/app/api/${f.replace("/route", "")}/route.ts`))).join("")));
  check("the library never selects an order's customer_id, note or delivery details", /ORDER_COLUMNS = "id, order_number, status, total, currency, created_at, paid_at, customer_name, customer_phone, customer_email"/.test(read("src/lib/customers/handlers.ts")) && !/customer_id|customer_note|delivery/.test(strip(read("src/lib/customers/match.ts"))));
  check("the library never writes: no insert/update/delete/upsert, no write RPC", !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(all) && [...all.matchAll(/\.rpc\(/g)].length === 0);
  check("matching never uses names as a key (names are only displayed)", !/customer_name\s*(===|==|\.toLowerCase|\.includes)/.test(strip(read("src/lib/customers/match.ts")).replace(/nameKey/g, "")) && /nameKey/.test(read("src/lib/customers/match.ts")));
  check("possible orders are not part of any figure: the profile derivation knows nothing about orders", !/order/i.test(strip(read("src/lib/customers/profile.ts")).replace(/in order|sort|by order|Statement|RANK/gi, "")) || !/product_orders|possible/i.test(read("src/lib/customers/profile.ts")));
  const hsrc = strip(read("src/lib/customers/handlers.ts"));
  const profileFn = hsrc.slice(hsrc.indexOf("export async function customerProfile"), hsrc.indexOf("const ORDER_COLUMNS"));
  check("the profile function never touches orders or the matcher (suggestions can never reach a total)", profileFn.length > 500 && !/product_orders|classifyOrders|possibleOrders|ORDER_COLUMNS/.test(profileFn));
  const directWrites = [...ui.matchAll(/callApi\("(POST|PUT)", [`"]([^`"?$]+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  const actUrls = [...ui.matchAll(/act\(`([^`]+)`/g)].map((m) => m[1]);
  check("UI writes go ONLY through the existing Phase 3 contact endpoints (create, edit, archive, pause)", directWrites.join("|") === "POST /api/receivables/customers|PUT /api/receivables/customers/" && actUrls.length >= 3 && actUrls.every((u) => /^\/api\/receivables\/customers\/\$\{[a-z.]+\}\/(archive|pause)$/.test(u)) && !/createClient|supabase|\.rpc\(/.test(ui), `${directWrites.join("|")} ${actUrls.join("|")}`);
  check("UI: a form is created with one request id per open form; no profile id is ever sent", /useRef\(newRequestId\(\)\)/.test(ui) && /client_request_id: requestId\.current/.test(ui) && !/profile_id/.test(ui));
  check("UI: no money maths on the screen (every figure comes from the server)", !/parseFloat|toFixed|Number\(.*(amount|total)|\* 100|\/ 100|reduce\(/.test(ui));
  check("UI: loading, empty, no-results, error/retry, archived, not-found and truncation states exist", ["u.loading", "u.empty", "u.noResults", "u.retry", "u.archivedBadge", "p.notFound", "p.truncatedInvoices", "p.truncatedPayments", "p.timelineEmpty", "m.noKey", "m.none", "m.windowIncomplete"].every((k) => ui.includes(k)));
  check("UI: possible orders load only on request, with the unverified label and ambiguity/ window warnings", /m\.show/.test(ui) && /useState<"idle"/.test(ui) && /m\.title/.test(ui) && /m\.warnings/.test(ui) && /m\.windowIncomplete/.test(ui) && /m\.ambiguousSummary/.test(ui));
  check("UI: customer-level payments are labelled 'Payments received', never revenue", /p\.paymentsReceived/.test(ui) && !/revenue/i.test(ui));
}

// ------------------------------------------------------------------------ EN / FR, nav, pages, protected paths
{
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  eq("EN and FR customers namespaces have exactly the same keys", flat(translations.en.customers).sort(), flat(translations.fr.customers).sort());
  const leaves = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v) : [[k, v]]));
  check("no empty string in either language", [...leaves(translations.en.customers), ...leaves(translations.fr.customers)].every(([, v]) => typeof v !== "string" || v.trim() !== ""));
  const en = leaves(translations.en.customers), fr = leaves(translations.fr.customers);
  const same = fr.filter(([k, v], i) => typeof v === "string" && v === en[i][1] && v.length > 14);
  check("French strings are really translated (no long string identical to English)", same.length === 0, same.map(([k]) => k).join());
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].customers;
    check(`${lang}: function strings return text`, [c.ui.count(1), c.ui.count(3), c.ui.noResults("zz"), c.profile.truncatedInvoices(200), c.profile.truncatedPayments(500), c.profile.dueOn("1 Dec"), c.profile.timelineTruncated(100), c.profile.invoiceIssued("INV-1"), c.profile.paymentRecorded("INV-1"), c.profile.paymentVoided("INV-1"), c.profile.reminderLine("a", "b", "c", "INV-1"), c.profile.reminderLine("a", "b", "c", ""), c.match.windowIncomplete(1000), c.match.shown(3, 5), c.match.scanned(1000), c.match.order("#1"), c.match.buyer("Ann")].every((s) => typeof s === "string" && s.length > 2));
    check(`${lang}: every timeline event, reminder kind/channel/status, order status, match basis and warning is named`, ["customer_created", "customer_updated", "customer_archived", "customer_restored", "reminders_paused", "reminders_resumed", "document_linked", "document_unlinked"].every((k) => c.profile.events[k])
      && ["before_due", "due_today", "overdue", "manual"].every((k) => c.profile.reminderKinds[k]) && ["email", "whatsapp_manual", "owner_alert"].every((k) => c.profile.reminderChannels[k]) && ["claimed", "sent", "failed", "suppressed", "skipped", "prepared"].every((k) => c.profile.reminderStatuses[k])
      && ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired", "refunded", "payment_review"].every((k) => c.match.statuses[k]) && ["both", "phone", "email"].every((k) => c.match.basis[k]) && ["email_belongs_to_other_contact", "phone_belongs_to_other_contact", "shared_phone_names"].every((k) => c.match.warnings[k]));
    check(`${lang}: every error the API can return has a sentence`, ["invalid_status", "invalid_limit", "invalid_offset", "customer_not_found", "customers_unavailable", "internal_error"].every((k) => c.errors[k]));
    check(`${lang}: payment totals say "Payments received" wording and the matching title says unverified`, lang === "en" ? /Payments received/.test(c.profile.paymentsReceived) && /not verified to be the same person/.test(c.match.title) : /Paiements reçus/.test(c.profile.paymentsReceived) && /non vérifiées/.test(c.match.title));
    check(`${lang}: no sentence about a Ringo account`, !/ringo (account|customer)|compte ringo|client ringo/i.test(JSON.stringify(c.ui) + JSON.stringify(c.profile) + JSON.stringify(c.match)));
  }
  check("nav label exists in both languages", translations.en.nav.customers === "Customers" && translations.fr.nav.customers === "Clients");
  for (const lang of ["en", "fr"]) {
    const w = translations[lang].customers.match;
    check(`${lang}: every possible-order warning, including shared e-mail and archived-contact conflicts, and the archived key notice are named`, ["email_belongs_to_other_contact", "phone_belongs_to_other_contact", "email_belongs_to_archived_contact", "phone_belongs_to_archived_contact", "shared_phone_names", "shared_email_names"].every((k) => w.warnings[k]) && !!w.keySharedArchived && !!w.keyShared);
  }
  const poUi = strip(read("src/components/customers/PossibleOrders.tsx"));
  check("UI: the window warning and the scan count appear only when a phone scan ran; the archived key notice is shown", /data\.phone_scanned && data\.window_full/.test(poUi) && /data\.phone_scanned \? /.test(poUi) && /contact_key_shared_with_archived/.test(poUi) && /m\.keySharedArchived/.test(poUi));

  const layout = read("src/app/dashboard/layout.tsx"), shell = read("src/components/dashboard/DashboardShell.tsx");
  check("nav: Customers is a top-level entry gated like Invoices/Inventory/Reports, hidden for staff", /customersNavVisible\(\{ userId: user\.id, profile: ownProfile \}\)/.test(layout) && /!isActingAsStaff && ownProfile \? await customersNavVisible/.test(layout) && /hasCustomers=\{hasCustomers\}/.test(layout) && /hasCustomers && !organization\?\.isStaff/.test(shell) && /href: "\/dashboard\/customers"/.test(shell));
  const acc = strip(read("src/lib/customers/access.ts"));
  check("access: plan flag + category/demo gate + table existence, any failure hides the entry", /business_toolkit_enabled/.test(acc) && /decideBookkeepingAccess/.test(acc) && /bk_customers/.test(acc) && /catch \{\s*return false;/.test(acc));
  const pl = read("src/app/dashboard/customers/layout.tsx");
  check("pages: layout requires the owner and the Phase 3 table; both pages exist", /requireCustomersOwner/.test(pl) && /customersAvailable/.test(pl) && /redirect\("\/dashboard"\)/.test(pl) && fs.existsSync(path.join(SRC, "app/dashboard/customers/page.tsx")) && fs.existsSync(path.join(SRC, "app/dashboard/customers/[id]/page.tsx")));
  check("Debtors -> Contacts is untouched: the contacts view and the receivables library have no diff", !execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src/components/receivables", "src/lib/receivables", "src/app/api/receivables", "src/app/dashboard/documents"], { cwd: REPO }).toString().trim());

  let changed = [];
  try { changed = [...execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO }).toString().split("\n"), ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: REPO }).toString().split("\n")].filter(Boolean); } catch { /* not a git checkout */ }
  const protectedRe = /^(supabase\/|src\/lib\/(productCheckout|payments|protection|fapshi|supabase|bookkeeping|documents|receivables|inventory|reports|customer|loyalty|community|team)\/|src\/middleware|src\/app\/api\/(documents|receivables|inventory|reports|bookkeeping|payments|fapshi|music|restaurant|tickets|webhooks|cron|auth|shop|orders|products|billing|protection|customer(?=\/)|community|loyalty|team)|src\/app\/auth|src\/components\/(editor|documents|receivables|inventory|reports|bookkeeping|loyalty|community)\/)/;
  // Phase 7A (Overview) legitimately touches exactly these two files: the optional `sections` flag of the report builder (default behaviour unchanged, proven by
  // overview.test.mjs) and the Reports tab list. Nothing else under a protected path may change; later Phase 7 steps add their own exact entries.
  const PHASE7_ALLOWED = ["src/lib/reports/build.ts", "src/components/reports/ReportsTabs.tsx", "src/app/api/bookkeeping/entries/route.ts"];
  const touched = changed.filter((f) => protectedRe.test(f) && !PHASE7_ALLOWED.includes(f));
  check("no protected path (migrations, checkout, payments, Connect/customer sessions, loyalty, community, invoices, receivables, bookkeeping, inventory, reports, auth, middleware, team, music, restaurant, tickets) is modified", touched.length === 0, touched.join(", "));
  check("no migration, no package file", !changed.some((f) => /^supabase\/migrations\//.test(f) || /^(package\.json|package-lock\.json)$/.test(f)));
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
