// Business Toolkit Phase 7C (bookkeeping entry corrections): the REAL correction handler, route files, history route, Entries screen and translations run
// against an in-memory fake. The bk_record_entry RPC is faked with the SAME semantics as the SQL function (idempotent on the request id; replace = void the
// original with the fixed reason, insert the replacement with replaces_entry_id, write the 'created' and 'replaced' events; the same error codes), and the
// fake database is shared with the report builder so the financial effect on the reports can be checked. No network, no database, no migration.
//   Run:  node scripts/tests/entryCorrection.test.mjs
import fs from "fs";
import path from "path";
import { SRC, PROFILE, OTHER, USER, ID, makeJiti, makeDb, makeAdmin, mkOwner, entry, counters } from "./phase7Harness.mjs";

const REPO = path.join(SRC, "..");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const tmp = [];
const jiti = makeJiti(tmp, "corr");
const P = jiti(path.join(SRC, "lib/reports/period.ts"));
const B = jiti(path.join(SRC, "lib/reports/build.ts"));
const C = jiti(path.join(SRC, "lib/corrections/entries.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const correctRoute = jiti(path.join(SRC, "app/api/reports/entries/[id]/correct/route.ts"));
const historyRoute = jiti(path.join(SRC, "app/api/reports/entries/route.ts"));

console.error = () => {};
const { c, check, eq } = counters();
const NOW = new Date("2026-12-10T10:00:00Z");
const RID = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
const E = { sale: ID(101), expense: ID(102), cash_in: ID(103), cash_out: ID(104), other: ID(105), linked: ID(106), voided: ID(107), invpay: ID(108), reserved: ID(109), usd: ID(110), foreign: ID(111), nov: ID(112), linkedSale: ID(113) };
const ORDER_ID = ID(900);

const FIXTURE = () => ({
  bk_entries: [
    entry(E.sale, "sale", 5000, "2026-12-03", { description: "Market stall", category: "market" }),
    entry(E.expense, "expense", 700, "2026-12-04", { category: "rent", cash_settled: false }),
    entry(E.cash_in, "cash_in", 3000, "2026-12-02"), entry(E.cash_out, "cash_out", 1000, "2026-12-02"),
    entry(E.other, "other_income", 400, "2026-12-05"),
    entry(E.linked, "expense", 900, "2026-12-06", { linked_order_type: "restaurant_order", linked_order_id: ORDER_ID }),
    entry(E.linkedSale, "sale", 1200, "2026-12-06", { linked_order_type: "music_order", linked_order_id: ID(901) }),
    entry(E.voided, "sale", 800, "2026-12-01", { voided_at: "2026-12-02T08:00:00Z", void_reason: "mistake" }),
    entry(E.invpay, "sale", 2500, "2026-12-07", { category: "invoice_payment" }),
    entry(E.reserved, "sale", 600, "2026-12-07", { category: "invoice_payment" }),
    entry(E.usd, "sale", 10, "2026-12-07", { currency: "USD" }),
    { ...entry(E.foreign, "sale", 9000, "2026-12-08"), profile_id: OTHER },
    entry(E.nov, "sale", 4000, "2026-11-20"),
  ],
  bk_document_payments: [{ id: "pay1", bk_entry_id: E.invpay }],
  bk_entry_events: [],
  product_orders: [],
});

// a fake of bk_record_entry with the SQL function's semantics, writing to the same tables the readers use
function recordEntryFake(tables, log) {
  return async (a) => {
    log.push(a);
    const entries = tables.bk_entries;
    if (a.p_client_request_id) { const ex = entries.find((e) => e.profile_id === a.p_profile_id && e.client_request_id === a.p_client_request_id); if (ex) return { data: { entry: ex, duplicate: true }, error: null }; }
    const fail = (m) => ({ data: null, error: { message: m } });
    if (a.p_entry_date > "2026-12-10") return fail("date_in_future");
    if (a.p_linked_order_id && a.p_kind === "sale" && entries.some((e) => e.profile_id === a.p_profile_id && e.kind === "sale" && e.linked_order_id === a.p_linked_order_id && !e.voided_at && e.id !== a.p_replaces_entry_id)) return fail("order_already_counted");
    let old = null;
    if (a.p_replaces_entry_id) {
      old = entries.find((e) => e.id === a.p_replaces_entry_id);
      if (!old || old.profile_id !== a.p_profile_id) return fail("entry_not_found");
      if (old.voided_at) return fail("entry_already_voided");
      old.voided_at = "2026-12-10T10:00:00Z"; old.void_reason = "Replaced by a correction";
    }
    const row = { id: ID(1000 + entries.length), profile_id: a.p_profile_id, kind: a.p_kind, amount: a.p_amount, currency: "XAF", entry_date: a.p_entry_date, category: (a.p_category ?? "").trim() || null, description: (a.p_description ?? "").trim() || null, cash_settled: a.p_cash_settled ?? true, linked_order_type: a.p_linked_order_type, linked_order_id: a.p_linked_order_id, replaces_entry_id: a.p_replaces_entry_id, client_request_id: a.p_client_request_id, voided_at: null, void_reason: null, created_at: "2026-12-10T10:00:00Z" };
    entries.push(row);
    tables.bk_entry_events.push({ entry_id: row.id, event_type: "created" });
    if (old) tables.bk_entry_events.push({ entry_id: old.id, event_type: "replaced", details: { replaced_by: row.id, old_amount: old.amount, new_amount: row.amount } });
    return { data: { entry: row, duplicate: false }, error: null };
  };
}
function ctx(tables = FIXTURE(), opts = {}) {
  const rpcLog = [], dbLog = [];
  const admin = { ...makeDb(tables, []), calls: [], rpc: async (name, args) => { admin.calls.push(name); return name === "bk_record_entry" ? recordEntryFake(tables, rpcLog)(args) : { data: null, error: { code: "PGRST202", message: "x" } }; } };
  if (opts.paymentsError) admin.from = (t) => (t === "bk_document_payments" ? { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: opts.paymentsError }) }) }) } : makeDb(tables, []).from(t));
  const owner = { userId: USER, profile: { id: PROFILE, currency: opts.currency ?? "XAF" }, supabase: makeDb(tables, dbLog), admin, tables, rpcLog, dbLog };
  return owner;
}
const fix = (tables, id) => tables.bk_entries.find((e) => e.id === id);
const run = async (o, id, body) => { const r = await C.correctEntry(o, id, body, { now: NOW }); return { status: r.status, body: r.body }; };
const monthReport = async (o, y, m) => B.buildMonthlyReport({ ...o, supabase: makeDb(o.tables, []), admin: makeAdmin({ doc_receivables_summary: { data: null, error: { code: "x", message: "x" } } }) }, P.periodFor(y, m, NOW).period, { now: NOW, sections: { topProducts: false, invoicing: false, business: false, receivables: false, inventory: false } });

// ------------------------------------------------------------------------ the happy path: original preserved and voided, replacement active, audit trail
{
  const o = ctx();
  const r = await run(o, E.sale, { amount: "5500", client_request_id: RID(1) });
  check("a correction answers 201 with the new entry and the replaced id", r.status === 201 && r.body.entry.amount === "5500" && r.body.replaced_entry_id === E.sale && r.body.duplicate === false, JSON.stringify(r));
  const old = fix(o.tables, E.sale), neu = o.tables.bk_entries.find((e) => e.id === r.body.entry.id);
  eq("the original is PRESERVED (same amount, date, kind) and voided with the fixed reason", [old.amount, old.entry_date, old.kind, !!old.voided_at, old.void_reason], ["5000", "2026-12-03", "sale", true, "Replaced by a correction"]);
  eq("the replacement is the active entry and carries the replaces_entry_id chain; omitted fields keep the original values", [neu.voided_at, neu.replaces_entry_id, neu.kind, neu.entry_date, neu.category, neu.description, neu.cash_settled], [null, E.sale, "sale", "2026-12-03", "market", "Market stall", true]);
  eq("the audit trail has the 'created' event for the replacement and the 'replaced' event for the original", [o.tables.bk_entry_events.map((e) => e.event_type), o.tables.bk_entry_events[1].details.replaced_by === neu.id], [["created", "replaced"], true]);
  eq("exactly ONE RPC call, and it is the existing bk_record_entry with the replace id and the owner's own ids", [o.rpcLog.length, o.rpcLog[0].p_replaces_entry_id, o.rpcLog[0].p_profile_id, o.rpcLog[0].p_actor_user_id, o.rpcLog[0].p_client_request_id], [1, E.sale, PROFILE, USER, RID(1)]);
  check("only that RPC is used: no void RPC and no direct write", o.admin.calls.join() === "rpc" || o.admin.calls.every((n) => n === "bk_record_entry"));
  const dec = await monthReport(o, 2026, 12);
  eq("reports count the replacement and NOT the original: live December revenue = replacement 5 500 + linked music sale 1 200 + other income 400 + two invoice-payment-category sales 2 500 and 600", dec.revenue.totalMinor, 5500 + 1200 + 400 + 2500 + 600);
  eq("the voided original shows only in the 'voided entries excluded' note", dec.exclusions.voidedEntries, 2);
}

// ------------------------------------------------------------------------ the kind is always the original's
{
  for (const [key, kind] of [["sale", "sale"], ["expense", "expense"], ["cash_in", "cash_in"], ["cash_out", "cash_out"], ["other", "other_income"]]) {
    const o = ctx();
    const r = await run(o, E[key], { amount: "123", client_request_id: RID(10) });
    check(`${kind}: the replacement stays ${kind} (the RPC receives the ORIGINAL kind)`, r.status === 201 && o.rpcLog[0].p_kind === kind && r.body.entry.kind === kind, JSON.stringify(r));
  }
  for (const other of ["expense", "cash_in", "other_income", "bogus", 7, null]) {
    const o = ctx();
    const r = await run(o, E.sale, { kind: other, amount: "123", client_request_id: RID(11) });
    check(`a client kind of ${JSON.stringify(other)} on a sale is refused (400 kind_cannot_change) and nothing is sent`, r.status === 400 && r.body.details[0] === "kind_cannot_change" && o.rpcLog.length === 0, JSON.stringify(r));
  }
  const same = ctx();
  check("repeating the original kind is harmless", (await run(same, E.sale, { kind: "sale", amount: "123", client_request_id: RID(12) })).status === 201);
}

// ------------------------------------------------------------------------ the order link is carried forward by the server and cannot be changed
{
  const o = ctx();
  const r = await run(o, E.linked, { amount: "950", client_request_id: RID(20) });
  eq("a linked entry's link is carried forward server-side (not sent by the client)", [r.status, o.rpcLog[0].p_linked_order_type, o.rpcLog[0].p_linked_order_id, r.body.entry.linked_order_id], [201, "restaurant_order", ORDER_ID, ORDER_ID]);
  const s = ctx();
  const rs = await run(s, E.linkedSale, { amount: "1300", client_request_id: RID(21) });
  check("a manual sale linked to a music order keeps its link and is not blocked by its own link (the RPC excludes the replaced entry)", rs.status === 201 && s.rpcLog[0].p_linked_order_id === ID(901));
  for (const [name, extra] of [["another order id", { linked_order_type: "restaurant_order", linked_order_id: ID(902) }], ["removing the link (null)", { linked_order_type: null, linked_order_id: null }], ["another order type", { linked_order_type: "music_order", linked_order_id: ORDER_ID }], ["only the id", { linked_order_id: ID(902) }]]) {
    const x = ctx();
    const r2 = await run(x, E.linked, { amount: "950", client_request_id: RID(22), ...extra });
    check(`client attempt: ${name} -> 400 order_link_cannot_change, nothing sent`, r2.status === 400 && r2.body.details[0] === "order_link_cannot_change" && x.rpcLog.length === 0, JSON.stringify(r2));
  }
  const n = ctx();
  const rn = await run(n, E.sale, { amount: "5100", client_request_id: RID(23), linked_order_type: "restaurant_order", linked_order_id: ORDER_ID });
  check("an entry WITHOUT a link cannot gain one through a correction", rn.status === 400 && rn.body.details[0] === "order_link_cannot_change" && n.rpcLog.length === 0);
  const ok = ctx();
  check("repeating the original link is accepted", (await run(ok, E.linked, { amount: "951", client_request_id: RID(24), linked_order_type: "restaurant_order", linked_order_id: ORDER_ID })).status === 201);
  const rep = ctx();
  check("a replaces_entry_id for another entry in the body is refused", (await run(rep, E.sale, { amount: "1", client_request_id: RID(25), replaces_entry_id: E.expense })).body.details?.[0] === "invalid_replaces_entry_id" && rep.rpcLog.length === 0);
}

// ------------------------------------------------------------------------ invoice-payment entries are never corrected here
{
  const o = ctx();
  const r = await run(o, E.invpay, { amount: "2600", client_request_id: RID(30) });
  check("an entry that belongs to an invoice payment: 409 entry_linked_to_invoice_payment, nothing sent, nothing voided", r.status === 409 && r.body.error === "entry_linked_to_invoice_payment" && o.rpcLog.length === 0 && !fix(o.tables, E.invpay).voided_at, JSON.stringify(r));
  const res = ctx();
  const rr = await run(res, E.reserved, { amount: "700", client_request_id: RID(31) });
  check("an entry in the reserved invoice_payment category is refused too (second line of defence, fail closed)", rr.status === 409 && rr.body.error === "entry_linked_to_invoice_payment" && res.rpcLog.length === 0, JSON.stringify(rr));
  const unk = ctx(FIXTURE(), { paymentsError: { code: "57014", message: "timeout" } });
  const ru = await run(unk, E.sale, { amount: "5001", client_request_id: RID(32) });
  check("if the invoice-payment check itself fails the correction is refused (500), never guessed", ru.status === 500 && ru.body.error === "internal_error" && unk.rpcLog.length === 0);
  const missing = ctx(FIXTURE(), { paymentsError: { code: "PGRST205", message: "Could not find the table 'public.bk_document_payments'" } });
  check("before Phase 2 exists nothing can be linked: an ordinary entry is corrected as usual", (await run(missing, E.sale, { amount: "5002", client_request_id: RID(33) })).status === 201);
  const cat = ctx();
  const rc = await run(cat, E.sale, { amount: "5003", category: "Invoice_Payment", client_request_id: RID(34) });
  check("a correction cannot MOVE an entry into the reserved invoice_payment category (400 category_reserved)", rc.status === 400 && rc.body.details[0] === "category_reserved" && cat.rpcLog.length === 0);
  check("the Phase 7A guard on the generic POST /api/bookkeeping/entries is still in place", /entryIsInvoicePayment\(owner\.admin, body\.replaces_entry_id\)/.test(read("src/app/api/bookkeeping/entries/route.ts")) && /entry_linked_to_invoice_payment/.test(read("src/app/api/bookkeeping/entries/route.ts")));
}

// ------------------------------------------------------------------------ voided entries, other businesses, ids
{
  const v = ctx();
  const rv = await run(v, E.voided, { amount: "900", client_request_id: RID(40) });
  check("a voided entry cannot be corrected (409 entry_already_voided)", rv.status === 409 && rv.body.error === "entry_already_voided" && v.rpcLog.length === 0);
  const f = ctx();
  const rf = await run(f, E.foreign, { amount: "9100", client_request_id: RID(41) });
  check("another business's entry is 'not found' (404), nothing sent, nothing touched", rf.status === 404 && rf.body.error === "entry_not_found" && f.rpcLog.length === 0 && !fix(f.tables, E.foreign).voided_at);
  const missing = await run(ctx(), ID(5555), { amount: "1", client_request_id: RID(42) });
  check("an unknown id is 404", missing.status === 404);
  for (const bad of ["not-a-uuid", "", "1", "../x", "00000000-0000-0000-0000-00000000000g"]) check(`id ${JSON.stringify(bad)} is 404 before anything is read`, (await run(ctx(), bad, { amount: "1", client_request_id: RID(43) })).status === 404);
  const o = ctx();
  for (const [name, body] of [["no request id", { amount: "1" }], ["bad request id", { amount: "1", client_request_id: "abc" }], ["numeric request id", { amount: "1", client_request_id: 5 }]]) {
    const r = await run(o, E.sale, body);
    check(`${name}: 400 invalid_client_request_id`, r.status === 400 && r.body.details[0] === "invalid_client_request_id" && o.rpcLog.length === 0, JSON.stringify(r));
  }
  for (const body of [null, "x", [], 5]) check(`body ${JSON.stringify(body)} is rejected`, (await run(ctx(), E.sale, body)).status === 400);
  const ru = ctx();
  const rr = await run(ru, E.usd, { amount: "12", client_request_id: RID(44) });
  check("an entry in another currency than the business's is refused, never converted", rr.status === 409 && rr.body.error === "entry_currency_mismatch" && ru.rpcLog.length === 0, JSON.stringify(rr));
}

// ------------------------------------------------------------------------ idempotency and double submit
{
  const o = ctx();
  const first = await run(o, E.sale, { amount: "5500", client_request_id: RID(50) });
  const again = await run(o, E.sale, { amount: "5500", client_request_id: RID(50) });
  check("a double submit with the SAME request id replays the first result (200 duplicate) and creates nothing", first.status === 201 && again.status === 200 && again.body.duplicate === true && again.body.entry.id === first.body.entry.id && o.tables.bk_entries.filter((e) => e.replaces_entry_id === E.sale).length === 1 && o.rpcLog.length === 1, JSON.stringify(again));
  const other = await run(o, E.sale, { amount: "5600", client_request_id: RID(51) });
  check("a second correction of the already-replaced original with a NEW request id is refused (409), so there is never a second active replacement", other.status === 409 && other.body.error === "entry_already_voided" && o.tables.bk_entries.filter((e) => e.replaces_entry_id === E.sale).length === 1);
  const chain = await run(o, first.body.entry.id, { amount: "5700", client_request_id: RID(52) });
  check("the REPLACEMENT can itself be corrected: the chain grows by one, the previous replacement is voided, exactly one entry stays active", chain.status === 201 && o.tables.bk_entries.filter((e) => !e.voided_at && [E.sale, first.body.entry.id, chain.body.entry.id].includes(e.id)).length === 1 && fix(o.tables, first.body.entry.id).voided_at);
  const clash = ctx();
  await run(clash, E.sale, { amount: "5500", client_request_id: RID(53) });
  const rc = await run(clash, E.expense, { amount: "710", client_request_id: RID(53) });
  check("a request id already used by a correction of ANOTHER entry is refused (409), never replayed as if it were this one", rc.status === 409 && rc.body.error === "client_request_id_in_use" && !fix(clash.tables, E.expense).voided_at);
  const race = ctx();
  const [a, b] = await Promise.all([run(race, E.sale, { amount: "5500", client_request_id: RID(54) }), run(race, E.sale, { amount: "5500", client_request_id: RID(55) })]);
  check("two concurrent submissions with different ids produce exactly one active replacement", race.tables.bk_entries.filter((e) => e.replaces_entry_id === E.sale).length === 1 && [a.status, b.status].sort().join() === "201,409", `${a.status},${b.status}`);
}

// ------------------------------------------------------------------------ validation (the same rules as creating an entry) and 'no changes'
{
  const bad = async (body, code, id = E.sale) => { const o = ctx(); const r = await run(o, id, { client_request_id: RID(60), ...body }); check(`${JSON.stringify(body)} -> 400 ${code}, nothing sent`, r.status === 400 && r.body.details.includes(code) && o.rpcLog.length === 0, JSON.stringify(r)); };
  await bad({ amount: "0" }, "invalid_amount"); await bad({ amount: "-5" }, "invalid_amount"); await bad({ amount: "abc" }, "invalid_amount"); await bad({ amount: "" }, "invalid_amount");
  await bad({ amount: "10.5" }, "amount_too_precise");
  await bad({ amount: "100", entry_date: "2026-12-11" }, "date_in_future"); await bad({ amount: "100", entry_date: "2026-13-45" }, "invalid_date"); await bad({ amount: "100", entry_date: "yesterday" }, "invalid_date");
  await bad({ amount: "100", category: "x".repeat(61) }, "invalid_category"); await bad({ amount: "100", category: "" }, "invalid_category");
  await bad({ amount: "100", description: "d".repeat(501) }, "description_too_long");
  await bad({ amount: "100", cash_settled: "yes" }, "invalid_cash_settled");
  await bad({ amount: "100", cash_settled: false }, "cash_entry_must_be_settled", E.cash_in);
  await bad({ client_request_id: RID(61) }, "no_changes");
  await bad({ amount: "5000", entry_date: "2026-12-03", category: "market", description: "Market stall", cash_settled: true }, "no_changes");
  const keep = ctx();
  const r = await run(keep, E.sale, { amount: "5100", client_request_id: RID(62) });
  check("an omitted category/description/settled/date keeps the original value", r.status === 201 && r.body.entry.category === "market" && r.body.entry.description === "Market stall" && r.body.entry.entry_date === "2026-12-03");
  const clear = ctx();
  const rc = await run(clear, E.sale, { amount: "5000", category: null, description: null, client_request_id: RID(63) });
  check("null clears the category and the description", rc.status === 201 && rc.body.entry.category === null && rc.body.entry.description === null);
  const settle = ctx();
  const rs = await run(settle, E.expense, { cash_settled: true, client_request_id: RID(64) });
  check("an expense recorded as unpaid can be corrected to paid (the settled state is editable where the model supports it)", rs.status === 201 && rs.body.entry.cash_settled === true && rs.body.entry.kind === "expense");
  const exact = ctx();
  const re = await run(exact, E.sale, { amount: 5500.0, client_request_id: RID(65) });
  check("a numeric amount is accepted like a string", re.status === 201 && re.body.entry.amount === "5500");
  const usd = ctx(FIXTURE(), { currency: "USD" });
  usd.tables.bk_entries.push(entry(ID(120), "sale", "10.00", "2026-12-04", { currency: "USD" }));
  const ru = await run(usd, ID(120), { amount: "12.50", client_request_id: RID(66) });
  check("amounts follow the business currency (USD: 12.50 is sent as 12.50)", ru.status === 201 && usd.rpcLog[0].p_amount === "12.50", JSON.stringify(ru));
  const noF = ctx();
  const rf = await run(noF, E.sale, { amount: "5100", client_request_id: RID(67), payment_method: "cash", cash_account: "till", reason: "typo", settlement_date: "2026-12-05", profile_id: OTHER, currency: "USD" });
  check("unknown fields (payment method, cash account, reason, settlement date, profile id, currency) are ignored, never stored or forwarded", rf.status === 201 && !JSON.stringify(noF.rpcLog[0]).match(/payment_method|cash_account|reason|settlement|USD/) && noF.rpcLog[0].p_profile_id === PROFILE && Object.keys(noF.rpcLog[0]).length === 12);
}

// ------------------------------------------------------------------------ financial behaviour on the reports
{
  const o = ctx();
  const novBefore = await monthReport(o, 2026, 11), decBefore = await monthReport(o, 2026, 12);
  const r = await run(o, E.nov, { amount: "4500", entry_date: "2026-12-02", client_request_id: RID(70) });
  const novAfter = await monthReport(o, 2026, 11), decAfter = await monthReport(o, 2026, 12);
  check("a correction across months MOVES the figure: November loses the original, December gains the replacement on its own date", r.status === 201 && novAfter.revenue.totalMinor === novBefore.revenue.totalMinor - 4000 && decAfter.revenue.totalMinor === decBefore.revenue.totalMinor + 4500, `${novBefore.revenue.totalMinor}->${novAfter.revenue.totalMinor}, ${decBefore.revenue.totalMinor}->${decAfter.revenue.totalMinor}`);
  eq("cash follows the same rule (settled sale)", [novAfter.cash.receivedDirectMinor, decAfter.cash.receivedDirectMinor], [novBefore.cash.receivedDirectMinor - 4000, decBefore.cash.receivedDirectMinor + 4500]);
  const live = o.tables.bk_entries.filter((e) => !e.voided_at && (e.id === E.nov || e.replaces_entry_id === E.nov));
  eq("no double counting: exactly one live entry of the chain exists", live.length, 1);
  const same = ctx();
  const before = await monthReport(same, 2026, 12);
  await run(same, E.sale, { amount: "6000", client_request_id: RID(71) });
  const after = await monthReport(same, 2026, 12);
  eq("same-month correction: revenue changes by exactly the difference (+1 000), and the voided original is disclosed, not counted", [after.revenue.totalMinor - before.revenue.totalMinor, after.exclusions.voidedEntries - before.exclusions.voidedEntries], [1000, 1]);
  const exp = ctx();
  const eb = await monthReport(exp, 2026, 12);
  await run(exp, E.expense, { amount: "800", cash_settled: true, client_request_id: RID(72) });
  const ea = await monthReport(exp, 2026, 12);
  eq("expense corrected 700 -> 800 and marked paid: expenses +100, cash paid out +800 (it was unpaid before), net cash -800", [ea.expenses.totalMinor - eb.expenses.totalMinor, ea.cash.paidOutMinor - eb.cash.paidOutMinor, ea.cash.netMovementMinor - eb.cash.netMovementMinor], [100, 800, -800]);
}

// ------------------------------------------------------------------------ routes
{
  const post = (id, body) => correctRoute.POST(new Request(`http://x/api/reports/entries/${id}/correct`, { method: "POST", body: JSON.stringify(body) }), { params: { id } });
  const o = ctx();
  o.tables.bk_entries.push(entry(ID(130), "sale", 700, "2026-03-05"));
  globalThis.__owner = { ok: true, owner: o };
  const ok = await post(ID(130), { amount: "750", client_request_id: RID(80) });
  const body = await ok.json();
  check("the route corrects for the owner (201)", ok.status === 201 && body.entry.replaces_entry_id === ID(130), JSON.stringify(body));
  check("private, no-store, noindex, no referrer", /private/.test(ok.headers.get("cache-control")) && /no-store/.test(ok.headers.get("cache-control")) && /noindex/.test(ok.headers.get("x-robots-tag")) && ok.headers.get("referrer-policy") === "no-referrer");
  const bad = await correctRoute.POST(new Request("http://x/api", { method: "POST", body: "{not json" }), { params: { id: E.expense } });
  check("an unreadable body is a clean 400, nothing sent", bad.status === 400 && o.rpcLog.length === 1);
  for (const reason of ["not_signed_in", "no_profile", "not_owner", "demo_profile", "category_not_enabled", "plan_not_enabled"]) {
    const d = ctx();
    globalThis.__owner = { ok: false, reason };
    const r = await post(E.sale, { amount: "5500", client_request_id: RID(81) });
    check(`denied (${reason}): ${r.status}, no RPC, nothing changed`, r.status >= 401 && r.status <= 403 && d.rpcLog.length === 0 && !fix(d.tables, E.sale).voided_at);
  }
  const rs = strip(read("src/app/api/reports/entries/[id]/correct/route.ts"));
  check("the route file exports only POST, goes through withOwner and never reads a profile id", (rs.match(/export async function (\w+)/g) || []).join() === "export async function POST" && /withOwner/.test(rs) && !/profile_?id|profileId/i.test(rs));
  const lib = strip(read("src/lib/corrections/entries.ts"));
  check("the handler writes ONLY through bk_record_entry: no direct insert/update/delete, no void RPC, no document or payment write", !/\.(insert|update|delete|upsert)\s*\(/.test(lib) && (lib.match(/\.rpc\(/g) || []).length === 1 && /rpc\("bk_record_entry"/.test(lib) && !/bk_void_entry|doc_void_payment|bk_document_payments"\)\.(insert|update)/.test(lib));
  check("every read of the handler is scoped to the caller's profile", (lib.match(/\.from\("bk_entries"\)[^;]*\.eq\("profile_id", profileId\)/g) || []).length === 2);
}

// ------------------------------------------------------------------------ history route: correction chain and eligibility
{
  const o = ctx();
  const r1 = await run(o, E.sale, { amount: "5500", client_request_id: RID(90) });
  globalThis.__owner = { ok: true, owner: o };
  const res = await historyRoute.GET(new Request("http://x/api/reports/entries?limit=100&include_voided=1"));
  const items = (await res.json()).items;
  const get = (id) => items.find((i) => i.id === id);
  eq("the corrected original shows who replaced it and is not correctable", [get(E.sale).replaced_by_id, get(E.sale).correctable, !!get(E.sale).voided_at], [r1.body.entry.id, false, true]);
  eq("the replacement shows what it replaces and can be corrected again", [get(r1.body.entry.id).replaces_entry_id, get(r1.body.entry.id).correctable], [E.sale, true]);
  eq("an invoice-payment entry is not correctable; neither is a voided one; an ordinary one is", [get(E.invpay).correctable, get(E.voided).correctable, get(E.expense).correctable], [false, false, true]);
  check("the reserved-category entry that is not a payment row is not offered either", get(E.reserved).correctable === false);
  check("history never shows another business's entries", !items.some((i) => i.id === E.foreign));
  check("no new internals leak (client_request_id, profile_id)", !JSON.stringify(items).match(/client_request_id|profile_id/));
}

// ------------------------------------------------------------------------ the Entries screen and the dialog
{
  const view = strip(read("src/components/bookkeeping/EntriesView.tsx")), dlg = strip(read("src/components/bookkeeping/EntryCorrectionDialog.tsx"));
  check("a Correct button is offered only for eligible entries (not voided, server says correctable, not an invoice payment)", /!e\.voided_at && e\.correctable && !e\.invoice_payment/.test(view) && /u\.correct\}/.test(view));
  check("invoice-payment entries show that the correction goes through the invoice", /e\.invoice_payment && !e\.voided_at/.test(view) && /u\.invoicePaymentCorrect/.test(view));
  check("the correction chain is shown for the original and for the replacement", /e\.replaced_by_id/.test(view) && /e\.replaces_entry_id/.test(view) && /chainReplacedBy/.test(view) && /chainReplaces/.test(view));
  check("the void reason (English text from the database) is not shown for a corrected original, so FR users never see it", /e\.void_reason && !e\.replaced_by_id/.test(view));
  check("the dialog posts to the correction route only, with a request id created once per dialog", /\/api\/reports\/entries\/\$\{encodeURIComponent\(entry\.id\)\}\/correct/.test(dlg) && /useState\(newRequestId\)/.test(dlg) && /client_request_id: rid/.test(dlg));
  check("the dialog cannot change the kind or the order link: no kind selector, no ENTRY_KINDS, no kind/link/profile/currency in the request body", !/ENTRY_KINDS/.test(dlg) && !/<select[^>]*value=\{kind/.test(dlg) && !/\bkind:\s/.test(dlg.slice(dlg.indexOf("callApi("))) && !/linked_order|profile_id|currency:/.test(dlg.slice(dlg.indexOf("callApi("), dlg.indexOf("client_request_id: rid"))));
  check("the dialog offers only amount, date, category, description and settled state; no payment method, cash account, settlement date or reason field", /u\.amount/.test(dlg) && /u\.date/.test(dlg) && /u\.category/.test(dlg) && /u\.description/.test(dlg) && !/payment_?method|cash_?account|settlement|reason/i.test(dlg));
  check("before/after preview and a separate confirmation step, with loading, error and double-submit protection", /correctBefore/.test(dlg) && /correctAfter/.test(dlg) && /setStage\("confirm"\)/.test(dlg) && /correctConfirm\b/.test(dlg) && /if \(busy\) return/.test(dlg) && /disabled=\{busy\}/.test(dlg) && /correctSaving/.test(dlg) && /role="alert"/.test(dlg));
  check("the warning that the original stays in the history is shown", /u\.correctWarning/.test(dlg));
  check("cash entries stay settled: the settled checkbox and the field are not offered for cash in/out", /cashKind \? \{\} : \{ cash_settled: settled \}/.test(dlg) && /!cashKind &&/.test(dlg));
  check("the Overview, reports, void and create flows are unchanged: create still posts to /api/bookkeeping/entries, void to the void route", /"\/api\/bookkeeping\/entries"/.test(view) && /\/api\/bookkeeping\/entries\/\$\{entry\.id\}\/void/.test(view));

  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  eq("EN and FR bookkeeping namespaces have exactly the same keys", flat(translations.en.bookkeeping).sort(), flat(translations.fr.bookkeeping).sort());
  for (const lang of ["en", "fr"]) {
    const U = translations[lang].bookkeeping.ui, Er = translations[lang].bookkeeping.errors;
    check(`${lang}: every new error code the correction can return is translated`, ["kind_cannot_change", "order_link_cannot_change", "entry_currency_mismatch", "invalid_client_request_id", "invalid_replaces_entry_id", "client_request_id_in_use", "no_changes", "category_reserved", "entry_already_voided", "entry_not_found", "entry_linked_to_invoice_payment"].every((k) => Er[k]));
    check(`${lang}: function strings return text`, [U.correctKindFixed("Sale"), U.chainReplacedBy("1 Dec", "10"), U.chainReplaces("1 Dec", "10"), U.settledValue(true, true), U.settledValue(false, true), U.settledValue(true, false), U.settledValue(false, false)].every((s) => typeof s === "string" && s.length > 2));
    check(`${lang}: the warning says the original stays in the history`, /history|historique/i.test(U.correctWarning) && /history|historique/i.test(U.correctConfirmBody));
  }
  const used = new Set([...(read("src/components/bookkeeping/EntryCorrectionDialog.tsx") + read("src/components/bookkeeping/EntriesView.tsx")).matchAll(/\bu\.([A-Za-z]+)/g)].map((m) => m[1]));
  check("every translation key the dialog and the list use exists in both languages", [...used].every((k) => k in translations.en.bookkeeping.ui && k in translations.fr.bookkeeping.ui), [...used].filter((k) => !(k in translations.en.bookkeeping.ui)).join());
  const en = translations.en.bookkeeping.ui, fr = translations.fr.bookkeeping.ui;
  check("French correction strings are really translated", Object.keys(en).filter((k) => /^(correct|chain)/.test(k) && typeof en[k] === "string" && en[k].length > 14).every((k) => en[k] !== fr[k]));
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${c.pass} passed, ${c.fail} failed`);
process.exit(c.fail ? 1 : 0);
