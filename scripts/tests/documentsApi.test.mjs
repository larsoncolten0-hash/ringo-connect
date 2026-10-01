// Business Toolkit Phase 2 — the seller-side document API (src/lib/documents/{handlers,validation,http,routeKit}.ts and
// src/app/api/documents/**). The REAL handlers and the REAL route files run here against an in-memory fake database; only the session
// resolver is stubbed. No network, no Supabase, nothing applied.
//   Run:  node scripts/tests/documentsApi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
// line comments FIRST: a comment such as "documents/**" must not be mistaken for the start of a block comment
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const stub = path.join(os.tmpdir(), `docs_access_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { resolveBookkeepingOwner: async () => globalThis.__docsOwner };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": stub, "@": SRC }, interopDefault: true, cache: false });
const H = jiti(path.join(SRC, "lib/documents/handlers.ts"));
const V = jiti(path.join(SRC, "lib/documents/validation.ts"));
const E = jiti(path.join(SRC, "lib/documents/http.ts"));
const R = jiti(path.join(SRC, "lib/documents/routeKit.ts"));
const route = (p) => jiti(path.join(SRC, "app/api/documents", p, "route.ts"));

const realConsoleError = console.error;
console.error = () => {}; // the handlers log unexpected server-side failures; the tests provoke them on purpose
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ------------------------------------------------------------------------ fakes
function makeDb(tables, errors = {}) {
  const log = [];
  return { log, from(table) {
    const q = { filters: [], cols: "*", order: null, range: null };
    const run = () => {
      if (errors[table]) return { error: errors[table] };
      let rows = (tables[table] || []).filter((r) => q.filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : v.includes(r[c]))));
      if (q.order) rows = [...rows].sort((a, b) => (a[q.order.c] < b[q.order.c] ? -1 : a[q.order.c] > b[q.order.c] ? 1 : 0) * (q.order.asc ? 1 : -1));
      const total = rows.length;
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (/customer_name:customer_snapshot->>name/.test(q.cols)) rows = rows.map((r) => ({ ...r, customer_name: r.customer_snapshot?.name ?? null }));
      log.push({ table, filters: q.filters, cols: q.cols });
      return { rows, total };
    };
    const chain = {
      select(cols) { q.cols = cols; return chain; },
      eq(c, v) { q.filters.push(["eq", c, v]); return chain; },
      in(c, v) { q.filters.push(["in", c, v]); return chain; },
      order(c, o) { q.order = { c, asc: o?.ascending !== false }; return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle: async () => { const r = run(); return r.error ? { data: null, error: r.error } : { data: r.rows[0] ?? null, error: null }; },
      then(res, rej) { const r = run(); return Promise.resolve(r.error ? { data: null, error: r.error, count: 0 } : { data: r.rows, error: null, count: r.total }).then(res, rej); },
    };
    return chain;
  } };
}
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: { ok: true, name }, error: null }; } }; };
const OWNER = { userId: "11111111-1111-4111-8111-111111111111", profile: { id: "22222222-2222-4222-8222-222222222222", currency: "XAF" } };
const OTHER_PROFILE = "33333333-3333-4333-8333-333333333333";
const mkOwner = (tables = {}, responses = {}, currency = "XAF", errors = {}) => ({ ...OWNER, profile: { ...OWNER.profile, currency }, supabase: makeDb(tables, errors), admin: makeAdmin(responses) });
const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const REQ = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;

const seller = { display_name: "Boutique Élise", legal_name: null, address: "12 rue", phone: null, email: null, tax_id: null, registration_no: null };
const doc = (o = {}) => ({ id: ID(1), profile_id: OWNER.profile.id, doc_type: "invoice", status: "issued", locale: "fr", currency: "XAF", number: "INV-2026-0001", number_year: 2026, number_seq: 1, issue_date: "2026-10-01", due_date: "2026-10-15", seller_snapshot: seller, customer_snapshot: { name: "Client \u{1F60A}" }, type_snapshot: null, subtotal: "5000.000", discount_total: "0.000", tax_label: null, tax_rate_bp: null, tax_total: "0.000", total: "5000.000", amount_paid: "0.000", notes: null, terms: null, template_version: 1, content_hash: "a".repeat(64), parent_document_id: null, replaces_document_id: null, created_at: "2026-10-01T10:00:00Z", issued_at: "2026-10-01T10:00:00Z", voided_at: null, void_reason: null, ...o });
const line = (o = {}) => ({ document_id: ID(1), position: 1, description: "Big job", quantity: "1.000", unit_price: "5000.000", gross_amount: "5000.000", discount_amount: "0.000", tax_amount: "0.000", line_total: "5000.000", product_id: null, ...o });
const goodDraft = (o = {}) => ({ locale: "fr", customer: { name: "Chukwudi \u{1F60A}", address: "Akwa Douala" }, due_date: "2026-12-01", notes: "Merci \u{1F64F}", terms: "30 jours", tax_enabled: false, lines: [{ description: "Café \u{1F60A}", quantity: "2", unit_price: "1500", discount_amount: "500" }], client_request_id: REQ(1), ...o });

// ======================================================================== validation (pre-checks; the database stays the authority)
{
  const bad = (body, cur = "XAF") => V.parseDraftBody(body, cur);
  check("a good draft passes and is forwarded exactly (text untouched, numbers as the client's own text)", (() => { const r = bad(goodDraft()); return r.ok && r.value.customer.name === "Chukwudi \u{1F60A}" && r.value.customer.address === "Akwa Douala" && r.value.lines[0].description === "Café \u{1F60A}" && r.value.lines[0].quantity === "2" && r.value.lines[0].unit_price === "1500" && r.value.lines[0].discount_amount === "500" && r.value.notes === "Merci \u{1F64F}"; })());
  const cases = [
    ["not an object", [], "invalid_body"], ["bad locale", goodDraft({ locale: "de" }), "invalid_locale"], ["missing locale", goodDraft({ locale: undefined }), "invalid_locale"],
    ["lines not an array", goodDraft({ lines: {} }), "invalid_lines"], ["101 lines", goodDraft({ lines: Array.from({ length: 101 }, () => ({ description: "x", quantity: "1", unit_price: "1" })) }), "too_many_lines"],
    ["blank description", goodDraft({ lines: [{ description: "  ", quantity: "1", unit_price: "1" }] }), "invalid_description:0"],
    ["301-char description", goodDraft({ lines: [{ description: "x".repeat(301), quantity: "1", unit_price: "1" }] }), "invalid_description:0"],
    ["zero quantity", goodDraft({ lines: [{ description: "x", quantity: "0", unit_price: "1" }] }), "invalid_quantity:0"],
    ["exponent quantity", goodDraft({ lines: [{ description: "x", quantity: "1e3", unit_price: "1" }] }), "invalid_quantity:0"],
    ["fractional XAF price", goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "10.5" }] }), "invalid_unit_price:0"],
    ["negative price", goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "-1" }] }), "invalid_unit_price:0"],
    ["fractional XAF discount", goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "10", discount_amount: "0.5" }] }), "invalid_discount:0"],
    ["bad product id", goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "1", product_id: "nope" }] }), "invalid_product:0"],
    ["bad due date", goodDraft({ due_date: "2026-02-30" }), "invalid_due_date"], ["1001-char notes", goodDraft({ notes: "n".repeat(1001) }), "invalid_notes"],
    ["1001-char terms", goodDraft({ terms: "t".repeat(1001) }), "invalid_terms"], ["customer not an object", goodDraft({ customer: "x" }), "invalid_customer"],
    ["customer name over 120", goodDraft({ customer: { name: "n".repeat(121) } }), "invalid_customer"], ["customer field not a string", goodDraft({ customer: { name: 5 } }), "invalid_customer"],
    ["tax_enabled not a boolean", goodDraft({ tax_enabled: "yes" }), "invalid_tax_enabled"], ["replaces not a uuid", goodDraft({ replaces_document_id: "x" }), "invalid_replacement"],
    ["client_request_id not a uuid", goodDraft({ client_request_id: "x" }), "invalid_request_id"],
  ];
  for (const [name, body, code] of cases) { const r = bad(body); check(`draft rejected: ${name}`, !r.ok && r.details.includes(code), JSON.stringify(r)); }
  check("lengths are counted in code points, like PostgreSQL (300 emoji are allowed, 301 are not)", bad(goodDraft({ lines: [{ description: "\u{1F60A}".repeat(300), quantity: "1", unit_price: "1" }] })).ok && !bad(goodDraft({ lines: [{ description: "\u{1F60A}".repeat(301), quantity: "1", unit_price: "1" }] })).ok);
  check("USD cents and KWD 3 decimals are accepted for their own currency", bad(goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "10.50" }] }), "USD").ok && bad(goodDraft({ lines: [{ description: "x", quantity: "1.5", unit_price: "1.234" }] }), "KWD").ok);
  check("zero lines is a valid DRAFT (issue refuses it later)", bad(goodDraft({ lines: [] })).ok);
  const pay = (o, cur = "XAF") => V.parsePaymentBody({ amount: "2000", method: "cash", client_request_id: REQ(9), ...o }, cur, "2026-10-01");
  check("a good payment passes; amount is normalised to the exact currency text", pay({}).ok && pay({}).value.amount === "2000" && pay({ amount: "10.5" }, "USD").value.amount === "10.50" && pay({ amount: 2000.0 }).value.amount === "2000");
  for (const [name, o, code] of [["zero", { amount: "0" }, "invalid_amount"], ["negative", { amount: "-5" }, "invalid_amount"], ["garbage", { amount: "abc" }, "invalid_amount"], ["fractional XAF", { amount: "10.5" }, "amount_too_precise"], ["bad method", { method: "bitcoin" }, "invalid_method"], ["101-char reference", { reference: "x".repeat(101) }, "invalid_reference"], ["future date", { paid_on: "2026-10-02" }, "invalid_paid_on"], ["bad date", { paid_on: "nope" }, "invalid_paid_on"], ["no request id", { client_request_id: undefined }, "request_id_required"], ["bad request id", { client_request_id: "x" }, "request_id_required"]])
    check(`payment rejected: ${name}`, (() => { const r = pay(o); return !r.ok && r.details.includes(code); })(), JSON.stringify(pay(o)));
  eq("paid_on defaults to today (business time)", pay({}).value.paid_on, "2026-10-01");
  eq("reason: trimmed-empty and over-long are refused", [V.parseReasonBody({ reason: "  " }).ok, V.parseReasonBody({ reason: "x".repeat(301) }).ok, V.parseReasonBody({ reason: "ok" }).ok, V.parseReasonBody(null).ok], [false, false, true, false]);
  eq("percent -> basis points is exact", ["19", "7.5", "0", "100", "12,25", "100.01", "abc", "5.555"].map(V.percentToBp), [1900, 750, 0, 10000, 1225, null, null, null]);
  const bp = (o) => V.parseBusinessProfileBody({ display_name: "Boutique", ...o });
  check("business profile: valid and exact", bp({ legal_name: "SARL Élise", tax_label: "TVA", tax_rate_bp: 1900, default_due_days: 14 }).ok);
  for (const [name, o, code] of [["blank name", { display_name: " " }, "invalid_display_name"], ["tax label without a rate", { tax_label: "TVA" }, "tax_incomplete"], ["rate without a label", { tax_rate_bp: 1900 }, "tax_incomplete"], ["rate above 100%", { tax_label: "TVA", tax_rate_bp: 10001 }, "invalid_tax_rate"], ["due days 366", { default_due_days: 366 }, "invalid_due_days"], ["bad email", { email: "nope" }, "invalid_email"]])
    check(`business profile rejected: ${name}`, (() => { const r = bp(o); return !r.ok && r.details.includes(code); })(), JSON.stringify(bp(o)));
  check("tax is OFF unless a label AND a rate are supplied", bp({}).ok && bp({}).value.tax_label === null && bp({}).value.tax_rate_bp === null);
}

// ======================================================================== error mapping
{
  const m = (message, code) => E.docError({ message, code });
  for (const [msg, status] of [["not_owner", 403], ["toolkit_not_enabled", 403], ["demo_profile_not_supported", 403], ["document_not_found", 404], ["payment_not_found", 404], ["exceeds_balance", 409], ["invoice_not_payable", 409], ["invoice_has_payments", 409], ["use_void_payment", 409], ["currency_changed", 409], ["document_not_draft", 409], ["document_void", 409], ["no_lines", 400], ["amount_too_precise", 400], ["amount_too_large", 400], ["invalid_paid_on", 400], ["reason_required", 400], ["customer_required", 400], ["tax_not_configured", 409], ["too_many_shares", 409], ["totals_mismatch", 500]])
    check(`database code ${msg} -> HTTP ${status}`, m(`ERROR: ${msg}`).status === status && m(msg).body.error === msg, JSON.stringify(m(msg)));
  check("a code embedded in a longer message is still recognised", m("P0001: exceeds_balance (detail)").body.error === "exceeds_balance");
  check("a code is not matched inside a different, longer identifier", m("invalid_lines").body.error === "invalid_lines" && m("xinvalid_line_y").body.error !== "invalid_line");
  eq("the replacement unique index becomes a clean 409", m('duplicate key value violates unique constraint "bk_documents_one_replacement_idx"'), { status: 409, body: { error: "replacement_exists" } });
  eq("Phase 2 not applied (function missing) -> 503 documents_unavailable", [m("Could not find the function public.doc_issue", "PGRST202").status, m("x", "42883").status, m("relation \"bk_documents\" does not exist").status], [503, 503, 503]);
  const unknown = m("some internal detail: password=hunter2 at /srv/app", "XX000");
  check("an unknown error is a generic 500 and leaks nothing", unknown.status === 500 && unknown.body.error === "internal_error" && !JSON.stringify(unknown).includes("hunter2"));
}

// ======================================================================== business profile handlers
{
  const o = mkOwner({ profiles: [{ id: OWNER.profile.id, name: "Alice Shop", username: "alice" }], bk_business_profiles: [] });
  let r = await H.getBusinessProfile(o);
  check("GET business profile: none yet, with a SUGGESTION from the public name (not saved)", r.status === 200 && r.body.profile === null && r.body.suggestion.display_name === "Alice Shop" && r.body.currency === "XAF" && o.admin.calls.length === 0, JSON.stringify(r));
  const o2 = mkOwner({ bk_business_profiles: [{ profile_id: OWNER.profile.id, display_name: "Boutique" }, { profile_id: OTHER_PROFILE, display_name: "Someone else" }], profiles: [] });
  r = await H.getBusinessProfile(o2);
  check("GET business profile returns only the owner's own row", r.body.profile.display_name === "Boutique");
  r = await H.putBusinessProfile(o, { display_name: " " });
  check("PUT invalid -> 400 and no database call", r.status === 400 && o.admin.calls.length === 0);
  r = await H.putBusinessProfile(o, { display_name: "Boutique Élise \u{1F6CD}️", legal_name: "SARL", address: "12 rue", tax_label: "TVA", tax_rate_bp: 1900, default_due_days: 14, profile_id: OTHER_PROFILE, user_id: "evil", p_profile_id: OTHER_PROFILE });
  const [fn, args] = o.admin.calls[0];
  check("PUT calls ONLY doc_upsert_business_profile with the OWNER's ids (a client-supplied profile id is ignored)", r.status === 200 && fn === "doc_upsert_business_profile" && args.p_profile_id === OWNER.profile.id && args.p_actor_user_id === OWNER.userId && args.p_display_name === "Boutique Élise \u{1F6CD}️" && args.p_tax_rate_bp === 1900 && !JSON.stringify(args).includes(OTHER_PROFILE) && !JSON.stringify(args).includes("evil"), JSON.stringify(args));
}

// ======================================================================== drafts
{
  const o = mkOwner();
  let r = await H.createDraft(o, goodDraft({ lines: [{ description: "x", quantity: "0", unit_price: "1" }] }));
  check("create with an invalid line -> 400, nothing called", r.status === 400 && r.body.error === "validation_failed" && o.admin.calls.length === 0);
  r = await H.createDraft(o, goodDraft({ total: "1", subtotal: "1", number: "INV-1999-0001", issue_date: "1999-01-01", currency: "USD", profile_id: OTHER_PROFILE, status: "paid", content_hash: "b".repeat(64), amount_paid: "5000" }));
  const [fn, args] = o.admin.calls[0];
  const KEYS = ["p_actor_user_id", "p_customer", "p_client_request_id", "p_doc_type", "p_document_id", "p_due_date", "p_lines", "p_locale", "p_notes", "p_profile_id", "p_replaces_document_id", "p_tax_enabled", "p_terms"].sort();
  check("create draft: doc_save_draft with p_document_id null, the owner's ids, status 201", r.status === 201 && fn === "doc_save_draft" && args.p_document_id === null && args.p_profile_id === OWNER.profile.id && args.p_actor_user_id === OWNER.userId && args.p_doc_type === "invoice", JSON.stringify(r));
  eq("CLIENT-SUPPLIED totals, number, issue date, currency, status, hash, amount paid and profile id are never forwarded (exact argument set)", Object.keys(args).sort(), KEYS);
  check("the exact text (emoji, U+202F) reaches the database function unchanged", args.p_customer.name === "Chukwudi \u{1F60A}" && args.p_customer.address === "Akwa Douala" && args.p_lines[0].description === "Café \u{1F60A}" && args.p_notes === "Merci \u{1F64F}");
  const dup = mkOwner({}, { doc_save_draft: { data: { duplicate: true, document: { id: ID(1) } }, error: null } });
  r = await H.createDraft(dup, goodDraft());
  check("a duplicate request id returns the original with 200, not 201", r.status === 200 && r.body.duplicate === true);
  const dbe = mkOwner({}, { doc_save_draft: { data: null, error: { code: "P0001", message: "tax_not_configured" } } });
  r = await H.createDraft(dbe, goodDraft({ tax_enabled: true }));
  eq("a database refusal maps to its status", [r.status, r.body.error], [409, "tax_not_configured"]);

  const tables = { bk_documents: [doc({ id: ID(1), status: "draft", number: null, content_hash: null, issued_at: null, issue_date: null, seller_snapshot: null }), doc({ id: ID(2), status: "issued" }), doc({ id: ID(3), profile_id: OTHER_PROFILE, status: "draft", number: null }), doc({ id: ID(4), currency: "USD", status: "draft", number: null })] };
  const u = mkOwner(tables);
  r = await H.updateDraft(u, ID(1), goodDraft());
  check("update a draft: doc_save_draft with that id", r.status === 200 && u.admin.calls[0][0] === "doc_save_draft" && u.admin.calls[0][1].p_document_id === ID(1) && u.admin.calls[0][1].p_profile_id === OWNER.profile.id);
  const u2 = mkOwner(tables);
  r = await H.updateDraft(u2, ID(2), goodDraft());
  check("an ISSUED invoice cannot be edited: 409 document_not_draft, no write attempted", r.status === 409 && r.body.error === "document_not_draft" && u2.admin.calls.length === 0);
  r = await H.updateDraft(u2, ID(3), goodDraft());
  check("another business's draft is not found (404), no write attempted", r.status === 404 && u2.admin.calls.length === 0);
  r = await H.updateDraft(u2, "not-a-uuid", goodDraft());
  check("malformed id -> 404", r.status === 404 && u2.admin.calls.length === 0);
  r = await H.updateDraft(u2, ID(4), goodDraft({ lines: [{ description: "x", quantity: "1", unit_price: "10.50" }] }));
  check("a draft is validated in ITS OWN currency (a USD draft accepts cents even if the profile is XAF)", r.status === 200);
  const u3 = mkOwner(tables);
  r = await H.discardDraft(u3, ID(1));
  check("discard a draft: doc_void_document with a fixed reason", r.status === 200 && u3.admin.calls[0][0] === "doc_void_document" && u3.admin.calls[0][1].p_document_id === ID(1) && u3.admin.calls[0][1].p_reason === "Draft discarded");
  const u4 = mkOwner(tables);
  r = await H.discardDraft(u4, ID(2));
  check("an issued invoice cannot be 'deleted': 409 and nothing is called", r.status === 409 && u4.admin.calls.length === 0);
}

// ======================================================================== state changes
{
  const o = mkOwner();
  let r = await H.issueDocument(o, ID(1));
  const [fn, args] = o.admin.calls[0];
  eq("issue sends ONLY the owner ids and the document id (no totals, number, date or hash can be supplied)", [fn, Object.keys(args).sort()], ["doc_issue", ["p_actor_user_id", "p_document_id", "p_profile_id"]]);
  check("issue returns the database result", r.status === 200 && r.body.ok === true);
  r = await H.issueDocument(o, "nope");
  eq("issue with a malformed id -> 404", r.status, 404);
  r = await H.voidDocument(o, ID(1), { reason: " " });
  check("void invoice needs a reason (400, nothing called)", r.status === 400 && o.admin.calls.length === 1);
  r = await H.voidDocument(o, ID(1), { reason: "Entered twice", profile_id: OTHER_PROFILE });
  check("void invoice: doc_void_document with the reason and the owner's ids", o.admin.calls[1][0] === "doc_void_document" && o.admin.calls[1][1].p_reason === "Entered twice" && o.admin.calls[1][1].p_profile_id === OWNER.profile.id);
  const bad = mkOwner({}, { doc_issue: { data: null, error: { code: "P0001", message: "customer_required" } } });
  r = await H.issueDocument(bad, ID(1));
  eq("illegal transition/state surfaces as the database's refusal (400 customer_required)", [r.status, r.body.error], [400, "customer_required"]);
  const nv = mkOwner({}, { doc_void_document: { data: null, error: { code: "P0001", message: "invoice_has_payments" } } });
  r = await H.voidDocument(nv, ID(1), { reason: "x" });
  eq("voiding an invoice that has payments -> 409 invoice_has_payments", [r.status, r.body.error], [409, "invoice_has_payments"]);
}
{
  const o = mkOwner();
  const P = (b) => H.recordPayment(o, ID(1), { amount: "2000", method: "mobile_money", reference: "Réf \u{1F60A}", paid_on: "2026-01-01", client_request_id: REQ(7), ...b });
  let r = await H.recordPayment(o, ID(1), { amount: "0", method: "cash", client_request_id: REQ(7) });
  check("payment with a bad amount -> 400, nothing called", r.status === 400 && o.admin.calls.length === 0);
  r = await H.recordPayment(o, ID(1), { amount: "10", method: "cash" });
  check("payment WITHOUT a request id -> 400 (idempotency is mandatory)", r.status === 400 && r.body.details.includes("request_id_required") && o.admin.calls.length === 0);
  r = await P({ currency: "USD", profile_id: OTHER_PROFILE, receipt_number: "RCT-1999-0001", bk_entry_id: "x", total: "1" });
  const [fn, args] = o.admin.calls[0];
  eq("payment: doc_record_payment with exactly the expected arguments (no currency, receipt number, entry id or profile id from the client)", [fn, Object.keys(args).sort()], ["doc_record_payment", ["p_actor_user_id", "p_amount", "p_client_request_id", "p_invoice_id", "p_method", "p_paid_on", "p_profile_id", "p_reference"]]);
  check("payment values: amount as exact text, owner's ids, the client's idempotency key, status 201", r.status === 201 && args.p_amount === "2000" && args.p_profile_id === OWNER.profile.id && args.p_client_request_id === REQ(7) && args.p_reference === "Réf \u{1F60A}" && args.p_invoice_id === ID(1));
  const dup = mkOwner({}, { doc_record_payment: { data: { duplicate: true, payment: { id: "p" } }, error: null } });
  r = await H.recordPayment(dup, ID(1), { amount: "2000", method: "cash", client_request_id: REQ(7) });
  check("a retried payment request returns the original with 200", r.status === 200 && r.body.duplicate === true);
  for (const [msg, status] of [["exceeds_balance", 409], ["invoice_not_payable", 409], ["currency_changed", 409], ["invalid_paid_on", 400], ["document_not_found", 404]]) {
    const e = mkOwner({}, { doc_record_payment: { data: null, error: { code: "P0001", message: msg } } });
    r = await H.recordPayment(e, ID(1), { amount: "10", method: "cash", client_request_id: REQ(8) });
    check(`payment refused by the database (${msg}) -> ${status}`, r.status === status && r.body.error === msg);
  }
  const usd = mkOwner({}, {}, "USD");
  await H.recordPayment(usd, ID(1), { amount: "10.5", method: "cash", client_request_id: REQ(7) });
  check("USD payment amounts keep their cents exactly", usd.admin.calls[0][1].p_amount === "10.50");
  const vp = mkOwner();
  r = await H.voidPayment(vp, ID(9), { reason: "wrong amount" });
  check("void payment: ONLY doc_void_payment (the controlled workflow), owner's ids, the reason", r.status === 200 && vp.admin.calls.length === 1 && vp.admin.calls[0][0] === "doc_void_payment" && vp.admin.calls[0][1].p_payment_id === ID(9) && vp.admin.calls[0][1].p_profile_id === OWNER.profile.id);
  check("void payment never touches the generic bookkeeping void", !vp.admin.calls.some(([n]) => n === "bk_void_entry"));
  r = await H.voidPayment(vp, ID(9), { reason: "" });
  check("void payment needs a reason", r.status === 400 && vp.admin.calls.length === 1);
  r = await H.voidPayment(vp, "x", { reason: "r" });
  eq("void payment with a malformed id -> 404 payment_not_found", [r.status, r.body.error], [404, "payment_not_found"]);
}

// ======================================================================== reads: list and one document
{
  const rows = [
    doc({ id: ID(1), number: "INV-2026-0001", status: "issued", due_date: "2000-01-01", total: "5000.000", amount_paid: "0.000" }),
    doc({ id: ID(2), number: "INV-2026-0002", status: "partially_paid", total: "5000.000", amount_paid: "2000.000", due_date: "2999-01-01", created_at: "2026-10-02T10:00:00Z" }),
    doc({ id: ID(3), status: "draft", number: null, total: "100.000", created_at: "2026-10-03T10:00:00Z" }),
    doc({ id: ID(4), profile_id: OTHER_PROFILE, number: "INV-2026-0001" }),
    doc({ id: ID(5), doc_type: "receipt", number: "RCT-2026-0001", parent_document_id: ID(2), created_at: "2026-10-04T10:00:00Z" }),
  ];
  const o = mkOwner({ bk_documents: rows });
  let r = await H.listDocuments(o, {});
  check("list: only the owner's INVOICES (not another business's, not receipts), newest first, amounts as exact minor units", r.status === 200 && r.body.items.map((i) => i.id).join() === [ID(3), ID(2), ID(1)].join() && r.body.total === 3 && r.body.items[1].total_minor === 5000 && r.body.items[1].amount_paid_minor === 2000 && r.body.items[1].balance_minor === 3000 && r.body.items[1].minor_digits === 0, JSON.stringify(r.body).slice(0, 300));
  const filters = o.supabase.log[0].filters;
  check("list queries are scoped by the owner's profile id and the invoice type", filters.some(([, c, v]) => c === "profile_id" && v === OWNER.profile.id) && filters.some(([, c, v]) => c === "doc_type" && v === "invoice"));
  check("overdue is calculated (past due date, balance > 0) and shown as a flag, never stored", r.body.items.find((i) => i.id === ID(1)).overdue === true && r.body.items.find((i) => i.id === ID(2)).overdue === false && r.body.items.find((i) => i.id === ID(3)).overdue === false);
  check("the customer name comes from the frozen snapshot", r.body.items[0].customer_name === "Client \u{1F60A}");
  r = await H.listDocuments(o, { status: "partially_paid" });
  check("list filter by status", r.body.items.length === 1 && r.body.items[0].id === ID(2));
  eq("invalid status / paging are refused", [(await H.listDocuments(o, { status: "bogus" })).status, (await H.listDocuments(o, { limit: "0" })).status, (await H.listDocuments(o, { limit: "101" })).status, (await H.listDocuments(o, { offset: "-1" })).status, (await H.listDocuments(o, { limit: "abc" })).status], [400, 400, 400, 400, 400]);
  r = await H.listDocuments(o, { limit: "2", offset: "1" });
  check("paging returns the slice and the full count", r.body.items.length === 2 && r.body.total === 3 && r.body.limit === 2 && r.body.offset === 1);
  const unavailable = mkOwner({}, {}, "XAF", { bk_documents: { code: "PGRST205", message: "Could not find the table 'public.bk_documents' in the schema cache" } });
  r = await H.listDocuments(unavailable, {});
  eq("before the Phase 2 migration the list says 'unavailable' (503), it does not crash", [r.status, r.body.error], [503, "documents_unavailable"]);
}
{
  const inv = doc({ id: ID(1), status: "partially_paid", amount_paid: "2000.000" });
  const tables = {
    bk_documents: [inv, doc({ id: ID(6), doc_type: "receipt", number: "RCT-2026-0001", parent_document_id: ID(1), total: "2000.000", subtotal: "2000.000", type_snapshot: { method: "cash", reference: null, paid_on: "2026-10-02", amount: "2000.000", balance_after: "3000.000", invoice_number: "INV-2026-0001" } }), doc({ id: ID(7), profile_id: OTHER_PROFILE })],
    bk_document_lines: [line(), line({ document_id: ID(6), description: "INV-2026-0001", unit_price: "2000.000", gross_amount: "2000.000", line_total: "2000.000" })],
    bk_document_payments: [{ id: ID(20), profile_id: OWNER.profile.id, invoice_id: ID(1), receipt_document_id: ID(6), amount: "2000.000", balance_after: "3000.000", method: "cash", reference: null, paid_on: "2026-10-02", created_at: "2026-10-02T09:00:00Z", voided_at: null, void_reason: null }],
    bk_document_events: [{ document_id: ID(1), profile_id: OWNER.profile.id, event_type: "issued", created_at: "2026-10-01T10:00:00Z", details: {} }, { document_id: ID(1), profile_id: OWNER.profile.id, event_type: "payment_recorded", created_at: "2026-10-02T09:00:00Z", details: {} }],
  };
  const o = mkOwner(tables);
  let r = await H.getDocument(o, ID(1));
  const b = r.body;
  check("invoice detail: model with exact minor units; total, amount received and balance are separate figures", r.status === 200 && b.model.totalMinor === 5000 && b.model.amountPaidMinor === 2000 && b.balance_minor === 3000 && b.model.number === "INV-2026-0001" && b.model.customer.name === "Client \u{1F60A}", JSON.stringify(b).slice(0, 200));
  check("detail lists the payment with its receipt number, as 'recorded by the business' data (no verification field exists)", b.payments.length === 1 && b.payments[0].receipt_number === "RCT-2026-0001" && b.payments[0].amount_minor === 2000 && b.payments[0].balance_after_minor === 3000 && !("verified" in b.payments[0]) && !JSON.stringify(b).toLowerCase().includes("verified"));
  check("detail includes the audit events in order", b.events.map((e) => e.event_type).join() === "issued,payment_recorded");
  check("offered actions follow the state: partially paid -> record payment, pdf; no edit/issue/discard; cannot be voided while payments exist", b.actions.recordPayment === true && b.actions.pdf === true && b.actions.edit === false && b.actions.issue === false && b.actions.discard === false && b.actions.void === false, JSON.stringify(b.actions));
  check("a payment can be voided only through the controlled workflow (offered while allowed)", b.payments[0].can_void === true);
  const act = async (over) => (await H.getDocument(mkOwner({ ...tables, bk_documents: [doc({ id: ID(1), ...over })] }), ID(1))).body.actions;
  eq("draft actions", await (async () => { const a = await act({ status: "draft", number: null, issued_at: null, issue_date: null, seller_snapshot: null, content_hash: null }); return [a.edit, a.issue, a.discard, a.recordPayment, a.void]; })(), [true, true, true, false, false]);
  eq("issued actions", await (async () => { const a = await act({ status: "issued" }); return [a.edit, a.issue, a.discard, a.recordPayment, a.void, a.pdf]; })(), [false, false, false, true, true, true]);
  eq("paid actions (no more payments, cannot void)", await (async () => { const a = await act({ status: "paid", amount_paid: "5000.000" }); return [a.recordPayment, a.void, a.pdf]; })(), [false, false, true]);
  eq("void actions (history/PDF only; may be corrected)", await (async () => { const a = await act({ status: "void", voided_at: "2026-10-03T10:00:00Z", void_reason: "x" }); return [a.recordPayment, a.void, a.edit, a.pdf, a.correct]; })(), [false, false, false, true, true]);
  r = await H.getDocument(o, ID(6));
  check("receipt detail: payment facts, invoice link, and the parent's lines", r.status === 200 && r.body.doc_type === "receipt" && r.body.model.payment.amountMinor === 2000 && r.body.model.payment.method === "cash" && r.body.model.payment.invoiceNumber === "INV-2026-0001" && r.body.parent.number === "INV-2026-0001" && r.body.model.parent.lines.length === 1 && r.body.actions.edit === false && r.body.actions.recordPayment === false);
  r = await H.getDocument(o, ID(7));
  eq("another business's document -> 404", [r.status, r.body.error], [404, "document_not_found"]);
  eq("malformed id -> 404", (await H.getDocument(o, "x")).status, 404);
  const rd = (await H.getDocument(mkOwner({ bk_documents: [doc({ id: ID(1), status: "draft", number: null, issued_at: null, issue_date: null, seller_snapshot: null, content_hash: null, tax_rate_bp: 1900, tax_label: "TVA" })], bk_document_lines: [line({ quantity: "2.500" })] }), ID(1))).body;
  check("a draft returns its editable form (exact line text; tax flag derived)", rd.draft && rd.draft.tax_enabled === true && rd.draft.lines[0].quantity === "2.500" && rd.draft.lines[0].unit_price === "5000.000" && rd.draft.locale === "fr");
  check("an issued document has no editable draft form", b.draft === null);
  const readsOnly = o.supabase.log.every((l) => ["bk_documents", "bk_document_lines", "bk_document_payments", "bk_document_events"].includes(l.table) && l.filters.some(([, c]) => ["profile_id", "document_id", "id"].includes(c)));
  check("every read is scoped by profile/document id", readsOnly);
  const broken = (await H.getDocument(mkOwner({ bk_documents: [doc({ id: ID(1), total: "12.5" })], bk_document_lines: [line()] }), ID(1)));
  eq("an unreadable stored amount is a clean 500, never a wrong number", [broken.status, broken.body.error], [500, "document_unreadable"]);
}

// ======================================================================== corrections, preserved links, editor forms
{
  const draftDoc = doc({ id: ID(1), status: "draft", number: null, issued_at: null, issue_date: null, seller_snapshot: null, content_hash: null, replaces_document_id: ID(8), due_date: "2026-12-01", tax_rate_bp: null });
  const tables = { bk_documents: [draftDoc, doc({ id: ID(8), status: "void", voided_at: "2026-10-03T10:00:00Z", void_reason: "x", due_date: "2026-10-15" }), doc({ id: ID(9), status: "issued" }), doc({ id: ID(10), status: "void", voided_at: "2026-10-03T10:00:00Z", void_reason: "x" }), doc({ id: ID(11), status: "draft", number: null, issued_at: null, issue_date: null, seller_snapshot: null, content_hash: null })], bk_document_lines: [line({ document_id: ID(1) }), line({ document_id: ID(8), description: "Corrige \u{1F60A}", quantity: "2.500", unit_price: "1500.000", discount_amount: "100.000" }), line({ document_id: ID(9) }), line({ document_id: ID(10) }), line({ document_id: ID(11) })] };
  const o = mkOwner(tables);
  await H.updateDraft(o, ID(1), goodDraft());
  check("editing a corrected-invoice draft that omits replaces_document_id KEEPS the stored link (the database would otherwise clear it)", o.admin.calls[0][1].p_replaces_document_id === ID(8), JSON.stringify(o.admin.calls[0][1].p_replaces_document_id));
  const o2 = mkOwner(tables);
  await H.updateDraft(o2, ID(11), goodDraft());
  check("a plain draft stays unlinked", o2.admin.calls[0][1].p_replaces_document_id === null);
  const o3 = mkOwner(tables);
  await H.updateDraft(o3, ID(1), goodDraft({ replaces_document_id: ID(10) }));
  check("an explicit replacement id from the editor is forwarded (the database validates it)", o3.admin.calls[0][1].p_replaces_document_id === ID(10));
  let r = await H.getDocument(mkOwner(tables), ID(8));
  check("a voided, previously issued invoice offers a CORRECTION form: exact line text, no due date, tax flag, locale", r.body.correction_form && r.body.correction_form.lines[0].description === "Corrige \u{1F60A}" && r.body.correction_form.lines[0].quantity === "2.500" && r.body.correction_form.lines[0].discount_amount === "100.000" && r.body.correction_form.due_date === null && r.body.correction_form.locale === "fr" && r.body.draft === null && r.body.actions.correct === false, JSON.stringify(r.body.actions));
  r = await H.getDocument(mkOwner(tables), ID(10));
  check("a voided invoice that nothing replaces offers 'correct'", r.body.actions.correct === true && r.body.correction_form !== null);
  r = await H.getDocument(mkOwner(tables), ID(9));
  check("an issued invoice has neither a draft form nor a correction form", r.body.draft === null && r.body.correction_form === null);
  r = await H.getDocument(mkOwner(tables), ID(1));
  check("a draft returns its own form including its due date", r.body.draft.due_date === "2026-12-01" && r.body.correction_form === null && r.body.replaces_document_id === ID(8));
  r = await H.getBusinessProfile(mkOwner({ profiles: [{ id: OWNER.profile.id, name: "N", username: "u" }], bk_business_profiles: [] }));
  check("business profile response carries the owner's own profile id (used only to list their own products)", r.body.profile_id === OWNER.profile.id);
  const act = (await H.listDocuments(mkOwner({ bk_documents: [doc({ id: ID(1), status: "draft", number: null }), doc({ id: ID(2), status: "issued", number: "INV-2026-0002" }), doc({ id: ID(3), status: "partially_paid", number: "INV-2026-0003", amount_paid: "100.000", created_at: "2026-10-02T10:00:00Z" }), doc({ id: ID(4), status: "paid", number: "INV-2026-0004", amount_paid: "5000.000", created_at: "2026-10-03T10:00:00Z" }), doc({ id: ID(5), status: "void", number: "INV-2026-0005", voided_at: "x", void_reason: "r", created_at: "2026-10-04T10:00:00Z" })] }), {})).body.items;
  const flags = (n) => { const a = act.find((i) => i.number === n || (n === null && i.number === null)).actions; return Object.entries(a).filter(([, v]) => v).map(([k]) => k).sort().join(); };
  eq("list row actions: draft", flags(null), "discard,edit,issue,pdf");
  eq("list row actions: issued", flags("INV-2026-0002"), "pdf,recordPayment,share,void");
  eq("list row actions: partially paid (cannot void while paid)", flags("INV-2026-0003"), "pdf,recordPayment,share");
  eq("list row actions: paid", flags("INV-2026-0004"), "pdf,share");
  eq("list row actions: void (history only; the list never offers 'correct')", flags("INV-2026-0005"), "pdf");
}

// ======================================================================== PDF
{
  const inv = doc({ id: ID(1) });
  const tables = { bk_documents: [inv, doc({ id: ID(2), status: "draft", number: null, issued_at: null, issue_date: null, seller_snapshot: null, content_hash: null }), doc({ id: ID(3), profile_id: OTHER_PROFILE })], bk_document_lines: [line(), line({ document_id: ID(2) })] };
  const good = mkOwner(tables, { bk_doc_hash: { data: "a".repeat(64), error: null } });
  let r = await H.renderPdf(good, ID(1));
  check("issued invoice: a real PDF named after the number", r.status === 200 && Buffer.from(r.pdf).subarray(0, 5).toString() === "%PDF-" && r.filename === "INV-2026-0001.pdf", JSON.stringify(r).slice(0, 120));
  check("the integrity hash is checked through the controlled function before rendering", good.admin.calls.length === 1 && good.admin.calls[0][0] === "bk_doc_hash" && good.admin.calls[0][1].p_document_id === ID(1));
  const tampered = mkOwner(tables, { bk_doc_hash: { data: "b".repeat(64), error: null } });
  r = await H.renderPdf(tampered, ID(1));
  eq("TAMPER EVIDENCE: a stored document whose hash no longer matches is NOT rendered (500 integrity_check_failed, no bytes)", [r.status, r.body?.error, "pdf" in r], [500, "integrity_check_failed", false]);
  const nohash = mkOwner({ bk_documents: [doc({ id: ID(1), content_hash: null })], bk_document_lines: [line()] }, { bk_doc_hash: { data: "a".repeat(64), error: null } });
  eq("an issued document without a stored hash is refused", (await H.renderPdf(nohash, ID(1))).status, 500);
  const draftO = mkOwner(tables);
  r = await H.renderPdf(draftO, ID(2));
  check("a DRAFT renders as a watermarked preview with no hash call and a safe filename", r.status === 200 && draftO.admin.calls.length === 0 && /^draft-[0-9a-f]{8}\.pdf$/.test(r.filename), r.filename);
  eq("another business's document -> 404", (await H.renderPdf(good, ID(3))).status, 404);
  eq("malformed id -> 404", (await H.renderPdf(good, "x")).status, 404);
  const rcpt = mkOwner({
    bk_documents: [doc({ id: ID(6), doc_type: "receipt", number: "RCT-2026-0001", parent_document_id: ID(1), total: "2000.000", subtotal: "2000.000", type_snapshot: { method: "cash", reference: "\u{1F60A}", paid_on: "2026-10-02", amount: "2000.000", balance_after: "3000.000", invoice_number: "INV-2026-0001" } }), inv],
    bk_document_lines: [line({ document_id: ID(6) }), line()],
  }, { bk_doc_hash: { data: "a".repeat(64), error: null } });
  r = await H.renderPdf(rcpt, ID(6));
  check("receipt PDF renders (with its invoice's lines) and is named RCT-...", r.status === 200 && r.filename === "RCT-2026-0001.pdf" && Buffer.from(r.pdf).subarray(0, 5).toString() === "%PDF-");
  check("hostile stored text (emoji, U+202F) renders without crashing", (await H.renderPdf(mkOwner({ bk_documents: [doc({ id: ID(1), customer_snapshot: { name: "\u{1F60A}محمد", address: "a b" }, notes: "\u{1F64F}" })], bk_document_lines: [line({ description: "\u{1F60A} 12 000" })] }, { bk_doc_hash: { data: "a".repeat(64), error: null } }), ID(1))).status === 200);
}

// ======================================================================== the REAL route files: authorization first, headers, plumbing
{
  const ownerOk = (o) => { globalThis.__docsOwner = { ok: true, owner: o }; };
  const denied = (reason) => { globalThis.__docsOwner = { ok: false, reason }; };
  const req = (method = "GET", body) => new Request("http://x/api", { method, ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }) });
  const ROUTES = [
    ["business-profile", "GET", {}], ["business-profile", "PUT", {}], ["", "GET", {}], ["", "POST", {}], [`${ID(1)}`, "GET", { id: ID(1) }], [`${ID(1)}`, "PUT", { id: ID(1) }], [`${ID(1)}`, "DELETE", { id: ID(1) }],
    [`${ID(1)}/issue`, "POST", { id: ID(1) }], [`${ID(1)}/void`, "POST", { id: ID(1) }], [`${ID(1)}/payments`, "POST", { id: ID(1) }], [`${ID(1)}/pdf`, "GET", { id: ID(1) }], [`payments/${ID(9)}/void`, "POST", { paymentId: ID(9) }],
  ];
  const fileFor = (p) => p.replace(ID(1), "[id]").replace(ID(9), "[paymentId]").replace(/^payments\/\[paymentId\]/, "payments/[paymentId]");
  let allDenied = true, anyCall = 0;
  for (const [p, method, params] of ROUTES) {
    const mod = route(fileFor(p));
    const a = mkOwner();
    for (const [reason, status] of [["not_signed_in", 401], ["plan_not_enabled", 403], ["not_owner", 403], ["demo_profile", 403], ["category_not_enabled", 403]]) {
      denied(reason);
      const res = await mod[method](req(method, {}), { params });
      if (res.status !== status || (await res.json()).error !== reason) allDenied = false;
    }
    anyCall += a.admin.calls.length;
  }
  check(`every one of the ${ROUTES.length} route handlers denies a signed-out, un-entitled, non-owner, demo or wrong-category caller (401/403) before doing anything`, allDenied && anyCall === 0);
  check("every route file exports force-dynamic and uses the shared owner gate", ROUTES.every(([p]) => { const s = read(`src/app/api/documents/${fileFor(p) ? (fileFor(p) === "" ? "" : fileFor(p) + "/") : ""}route.ts`.replace("//", "/")); return /export const dynamic = "force-dynamic"/.test(s) && /withOwner\(/.test(s); }));

  const tables = { bk_documents: [doc({ id: ID(1) })], bk_document_lines: [line()] };
  ownerOk(mkOwner(tables, { bk_doc_hash: { data: "a".repeat(64), error: null } }));
  let res = await route("[id]/pdf").GET(req(), { params: { id: ID(1) } });
  check("PDF route: application/pdf, attachment filename, and the privacy headers (no-store, no-referrer, noindex, nosniff)", res.status === 200 && res.headers.get("content-type") === "application/pdf" && /attachment; filename="INV-2026-0001\.pdf"/.test(res.headers.get("content-disposition")) && res.headers.get("cache-control") === "private, no-store" && res.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(res.headers.get("x-robots-tag")) && res.headers.get("x-content-type-options") === "nosniff" && Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");
  res = await route("[id]").GET(req(), { params: { id: ID(1) } });
  check("JSON routes carry the same privacy headers", res.status === 200 && res.headers.get("cache-control") === "private, no-store" && res.headers.get("referrer-policy") === "no-referrer");
  res = await route("").POST(new Request("http://x/api", { method: "POST", body: "{not json" }));
  check("a malformed JSON body is a clean 400, not a crash", res.status === 400 && (await res.json()).error === "validation_failed");
  res = await route("[id]/payments").POST(req("POST", { amount: "10", method: "cash", client_request_id: REQ(1) }), { params: { id: ID(1) } });
  check("payments route reaches the controlled function", res.status === 201);
  delete globalThis.__docsOwner;
}

// ======================================================================== static: the write boundary and the protected systems
{
  const files = ["src/lib/documents/handlers.ts", "src/lib/documents/routeKit.ts", "src/lib/documents/http.ts", "src/lib/documents/validation.ts", ...fs.readdirSync(path.join(SRC, "app/api/documents"), { recursive: true }).filter((f) => String(f).endsWith("route.ts")).map((f) => `src/app/api/documents/${String(f).replace(/\\/g, "/")}`)];
  const code = files.map((f) => [f, strip(read(f))]);
  check("NO handler or route writes a table directly (no .insert/.update/.delete/.upsert)", code.every(([, s]) => !/\.(insert|update|delete|upsert)\s*\(/.test(s)));
  const rpcNames = new Set(code.flatMap(([, s]) => [...s.matchAll(/(?:rpc\(\s*|rpc\(owner,\s*)"([a-z_]+)"/g)].map((m) => m[1])));
  const allowed = new Set(["doc_upsert_business_profile", "doc_save_draft", "doc_issue", "doc_record_payment", "doc_void_payment", "doc_void_document", "bk_doc_hash", "doc_create_share", "doc_revoke_share"]);
  check("the only functions ever called are the controlled Phase 2 ones (+ the hash check)", rpcNames.size > 0 && [...rpcNames].every((n) => allowed.has(n)), [...rpcNames].join());
  check("the generic Phase 1 bookkeeping writes are never called from the document API", code.every(([, s]) => !/bk_record_entry|bk_void_entry|bk_entries/.test(s)));
  check("no route reads a business/profile id from the request (session-derived only)", code.every(([f, s]) => !/body\??\.(profile_id|organization_id|org_id|user_id)|searchParams\.get\(["'](profile|org|user)/i.test(s) || f.endsWith("validation.ts")));
  check("no document route or handler imports payment, checkout, order or settlement code", code.every(([, s]) => !/productCheckout|customer_payments|commerce_sale_earnings|settlement|fapshi|stripe|protection|onOrderPaid|musicReceipt/i.test(s.replace(/\/\/.*$/gm, ""))));
  check("the issue route accepts no body at all (nothing to trust)", !/readJson|request\.json/.test(strip(read("src/app/api/documents/[id]/issue/route.ts"))));
  check("PDF and detail reads never use the service role (owner-scoped client) except the hash check", !/owner\.admin\.from\(/.test(strip(read("src/lib/documents/handlers.ts"))));
  check("every list/get query carries an explicit profile filter", (strip(read("src/lib/documents/handlers.ts")).match(/\.eq\("profile_id", (owner\.profile\.id|pid)\)/g) || []).length >= 8);
}

console.error = realConsoleError;
fs.rmSync(stub, { force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
