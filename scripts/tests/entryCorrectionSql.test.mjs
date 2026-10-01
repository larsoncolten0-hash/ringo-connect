// Business Toolkit Phase 7C: the REAL correction path against the REAL bookkeeping SQL.
//
// What is real: the repository's Phase 1 (bookkeeping) and Phase 2 (documents, invoice payments) migrations run on an in-memory PostgreSQL (PGlite, a real
// PostgreSQL engine in WASM): bk_record_entry, its idempotency and replace logic, the immutability triggers, the constraints, the event log, the grants and
// the RLS policies are all genuinely evaluated. The correction handler (src/lib/corrections/entries.ts), the generic POST /api/bookkeeping/entries route, the
// invoice-payment guard and the report builder (buildMonthlyReport) are the REAL application code. The owner's client runs as the `authenticated` role with
// the owner's JWT subject (so RLS applies) and the trusted client runs as `service_role`, like the routes do in production.
// What is a stand-in: the PostgREST layer (a tiny query translator below), roles/auth.uid(), and reduced users/plans/profiles/orders tables. It never
// connects to Supabase or any real database and never reads .env.local. Nothing here proves compatibility with the production schema.
//   Run:  node scripts/tests/entryCorrectionSql.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `esql_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@": SRC }, interopDefault: true, cache: false });
const C = jiti(path.join(SRC, "lib/corrections/entries.ts"));
const B = jiti(path.join(SRC, "lib/reports/build.ts"));
const P = jiti(path.join(SRC, "lib/reports/period.ts"));
const postRoute = jiti(path.join(SRC, "app/api/bookkeeping/entries/route.ts"));
const correctRoute = jiti(path.join(SRC, "app/api/reports/entries/[id]/correct/route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLN = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2) };
const PR = { alice: PID(1), bob: PID(2) };
let rq = 5000;
const req = () => RQ(++rq);

// ------------------------------------------------------------------------ the database: real migrations on a scratch PostgreSQL
const db = new PGlite();
await db.exec(`
  set timezone = 'UTC';
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key, name text not null unique, display_name text, price_xaf int not null default 0, team_enabled boolean not null default false, ai_enabled boolean not null default false, commerce_enabled boolean not null default true);
  create table public.users (id uuid primary key, email text not null, role text not null default 'creator', plan_id uuid references public.plans(id));
  create function public.is_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  alter table public.users enable row level security;
  create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
  insert into public.plans (id, name) values ('${PLN(1)}','free'),('${PLN(5)}','business_pro');
  insert into public.users (id, email, role, plan_id) values ('${U.alice}','a@x.test','creator','${PLN(5)}'), ('${U.bob}','b@x.test','creator','${PLN(5)}');
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text, is_demo boolean not null default false, published boolean not null default true);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (published = true or auth.uid() = user_id or is_admin());
  create table public.products (id uuid primary key, profile_id uuid not null references public.profiles(id), name text);
  create table public.product_orders (id uuid primary key, profile_id uuid not null references public.profiles(id), status text not null default 'paid', total numeric(12,2) not null default 0, currency text, paid_at timestamptz);
  create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  insert into public.profiles (id, user_id, username, name, currency) values ('${PR.alice}','${U.alice}','alice','Alice Shop','XAF'), ('${PR.bob}','${U.bob}','bob','Bob Shop','XAF');
  insert into public.orders (id, profile_id) values ('${OID(11)}','${PR.alice}');
  insert into public.music_orders (id, profile_id) values ('${OID(21)}','${PR.alice}');
`);
await db.exec(read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql"));
await db.exec(read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql"));
const one = async (sql) => (await db.query(sql)).rows[0];
const rows = async (sql) => (await db.query(sql)).rows;
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const today = (await one(`select (now() at time zone 'Africa/Douala')::date::text d`)).d;
const dayShift = (key, n) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const thisFirst = `${today.slice(0, 7)}-01`;
const prevLast = dayShift(thisFirst, -1);
const prevFirst = `${prevLast.slice(0, 7)}-01`;
const prevDay = (n) => dayShift(prevFirst, n - 1);
const NOW = new Date();

// ------------------------------------------------------------------------ a tiny PostgREST-style translator over PGlite (run as a given role)
const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : q(v));
function client(role, sub) {
  const run = (sql) => as(role, sub, sql);
  return {
    from(table) {
      const st = { cols: "*", where: [], order: [], limit: null, offset: 0, single: false };
      const sql = () => {
        const cols = st.cols === "*" ? "*" : splitCols(st.cols).map((c) => (c.includes("(") ? `'[]'::json as "${c.slice(0, c.indexOf("("))}"` : `"${c}"`)).join(", ");
        const w = st.where.length ? ` where ${st.where.join(" and ")}` : "";
        const o = st.order.length ? ` order by ${st.order.join(", ")}` : "";
        const l = st.limit !== null ? ` limit ${st.limit} offset ${st.offset}` : "";
        return `select coalesce(json_agg(r), '[]'::json) as j from (select ${cols} from public."${table}"${w}${o}${l}) r`;
      };
      const chain = {
        select(c) { st.cols = c ?? "*"; return chain; },
        eq(c, v) { st.where.push(`"${c}" = ${lit(v)}`); return chain; },
        in(c, v) { st.where.push(`"${c}" in (${v.map(lit).join(",")})`); return chain; },
        is(c, v) { st.where.push(`"${c}" is ${v === null ? "null" : lit(v)}`); return chain; },
        not(c, op, v) { st.where.push(`"${c}" is not ${v === null ? "null" : lit(v)}`); return chain; },
        gte(c, v) { st.where.push(`"${c}" >= ${lit(v)}`); return chain; },
        lte(c, v) { st.where.push(`"${c}" <= ${lit(v)}`); return chain; },
        lt(c, v) { st.where.push(`"${c}" < ${lit(v)}`); return chain; },
        order(c, o) { st.order.push(`"${c}" ${o?.ascending === false ? "desc" : "asc"}`); return chain; },
        limit(n) { st.limit = n; return chain; },
        range(a, b) { st.limit = b - a + 1; st.offset = a; return chain; },
        maybeSingle: async () => { st.limit = 2; try { const j = (await run(sql())).rows[0].j; return j.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: j[0] ?? null, error: null }; } catch (e) { return { data: null, error: { code: e.code, message: e.message.split("\n")[0] } }; } },
        then(res, rej) { return run(sql()).then((r) => ({ data: r.rows[0].j, error: null }), (e) => ({ data: null, error: { code: e.code, message: e.message.split("\n")[0] } })).then(res, rej); },
      };
      return chain;
    },
    rpc: async (name, args) => {
      const list = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      try { return { data: (await run(`select ${name}(${list}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code, message: e.message.split("\n")[0] } }; }
    },
  };
}
const ownerOf = (who) => ({ userId: U[who], profile: { id: PR[who], currency: "XAF" }, supabase: client("authenticated", U[who]), admin: client("service_role", null) });
const alice = ownerOf("alice"), bob = ownerOf("bob");

// ------------------------------------------------------------------------ helpers: real RPC calls as the trusted routes make them
const record = async (o, p) => { const r = await o.admin.rpc("bk_record_entry", { p_profile_id: o.profile.id, p_actor_user_id: o.userId, p_kind: p.kind, p_amount: String(p.amount), p_entry_date: p.date, p_category: p.category ?? null, p_description: p.description ?? null, p_cash_settled: p.settled ?? true, p_linked_order_type: p.linkType ?? null, p_linked_order_id: p.linkId ?? null, p_replaces_entry_id: p.replaces ?? null, p_client_request_id: p.rid ?? req() }); if (r.error) throw new Error(r.error.message); return r.data.entry; };
const correct = async (o, id, body) => { const r = await C.correctEntry(o, id, body); return { status: r.status, body: r.body }; };
const entryRow = async (id) => one(`select *, entry_date::text as d from bk_entries where id = ${q(id)}`);
const live = async (profile = PR.alice) => (await rows(`select id, kind, amount::text a, entry_date::text d, replaces_entry_id from bk_entries where profile_id = ${q(profile)} and voided_at is null order by entry_date, id`));
const events = async (id) => (await rows(`select event_type, details from bk_entry_events where entry_id = ${q(id)} order by created_at, id`));
const LIGHT = { topProducts: false, invoicing: false, business: false, receivables: false, inventory: false };
const report = async (o, y, m) => B.buildMonthlyReport(o, P.periodFor(y, m, NOW).period, { now: NOW, sections: LIGHT });
const [py, pm] = prevFirst.split("-").map(Number), [ty, tm] = thisFirst.split("-").map(Number);

// ------------------------------------------------------------------------ 1. a real correction: original voided and kept, replacement active, events written
const orig = await record(alice, { kind: "sale", amount: 5000, date: prevDay(5), category: "market", description: "Market stall" });
const prevBefore = await report(alice, py, pm), thisBefore = await report(alice, ty, tm);
eq("setup: the original sale is counted in the previous month", prevBefore.revenue.manualSalesMinor, 5000);
const rid1 = req();
const r1 = await correct(alice, orig.id, { amount: "5500", entry_date: thisFirst, client_request_id: rid1 });
check("the correction through the real RPC answers 201", r1.status === 201 && r1.body.duplicate === false && r1.body.replaced_entry_id === orig.id, JSON.stringify(r1).slice(0, 300));
const o1 = await entryRow(orig.id), n1 = await entryRow(r1.body.entry.id);
eq("the original is PRESERVED (amount, date, kind, category untouched) and voided with the fixed reason", [Number(o1.amount), o1.d, o1.kind, o1.category, o1.voided_at !== null, o1.void_reason], [5000, prevDay(5), "sale", "market", true, "Replaced by a correction"]);
eq("the replacement is active, linked by replaces_entry_id, same kind, carries the unchanged category and description", [n1.voided_at, n1.replaces_entry_id, n1.kind, n1.category, n1.description, Number(n1.amount), n1.client_request_id], [null, orig.id, "sale", "market", "Market stall", 5500, rid1]);
eq("the audit events: 'created' on the replacement, 'replaced' on the original with both amounts and the replacement id", [(await events(n1.id)).map((e) => e.event_type), (await events(orig.id)).map((e) => e.event_type), (await events(orig.id)).find((e) => e.event_type === "replaced").details.replaced_by === n1.id, Number((await events(orig.id)).find((e) => e.event_type === "replaced").details.old_amount), Number((await events(orig.id)).find((e) => e.event_type === "replaced").details.new_amount)], [["created"], ["created", "replaced"], true, 5000, 5500]);
eq("exactly one live entry of the chain exists", (await live()).filter((e) => e.id === orig.id || e.replaces_entry_id === orig.id).map((e) => e.id), [n1.id]);

// ------------------------------------------------------------------------ 2. the report: the original is excluded, the replacement counts in ITS month
const prevAfter = await report(alice, py, pm), thisAfter = await report(alice, ty, tm);
eq("a correction across months: the previous month loses the original (5 000), this month gains the replacement (5 500)", [prevAfter.revenue.totalMinor - prevBefore.revenue.totalMinor, thisAfter.revenue.totalMinor - thisBefore.revenue.totalMinor], [-5000, 5500]);
eq("cash follows (the sale was settled): -5 000 then +5 500", [prevAfter.cash.receivedDirectMinor - prevBefore.cash.receivedDirectMinor, thisAfter.cash.receivedDirectMinor - thisBefore.cash.receivedDirectMinor], [-5000, 5500]);
eq("the voided original shows only as an exclusion note in the month it was dated", [prevAfter.exclusions.voidedEntries - prevBefore.exclusions.voidedEntries, thisAfter.exclusions.voidedEntries - thisBefore.exclusions.voidedEntries], [1, 0]);

// ------------------------------------------------------------------------ 3. idempotent retry and no duplicate replacement
const again = await correct(alice, orig.id, { amount: "5500", entry_date: thisFirst, client_request_id: rid1 });
check("a retry with the SAME request id replays the first result (200 duplicate, same replacement)", again.status === 200 && again.body.duplicate === true && again.body.entry.id === n1.id, JSON.stringify(again).slice(0, 300));
const second = await correct(alice, orig.id, { amount: "5600", client_request_id: req() });
check("a second correction of the already-replaced original (new request id) is refused (409 entry_already_voided)", second.status === 409 && second.body.error === "entry_already_voided");
eq("still exactly one replacement row for the original", Number((await one(`select count(*)::int n from bk_entries where replaces_entry_id = ${q(orig.id)}`)).n), 1);
const direct = await alice.admin.rpc("bk_record_entry", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_kind: "sale", p_amount: "1", p_entry_date: today, p_category: null, p_description: null, p_cash_settled: true, p_linked_order_type: null, p_linked_order_id: null, p_replaces_entry_id: orig.id, p_client_request_id: req() });
check("even calling the RPC directly cannot replace a voided entry (the SQL refuses: entry_already_voided)", !!direct.error && /entry_already_voided/.test(direct.error.message));
const [x, y] = await Promise.all([correct(alice, n1.id, { amount: "5700", client_request_id: req() }), correct(alice, n1.id, { amount: "5800", client_request_id: req() })]);
check("two concurrent corrections of the same entry: one replacement, the other refused", [x.status, y.status].sort().join() === "201,409" && Number((await one(`select count(*)::int n from bk_entries where replaces_entry_id = ${q(n1.id)}`)).n) === 1, `${x.status},${y.status}`);
const head = (await live()).find((e) => e.replaces_entry_id === n1.id);
check("the replacement can itself be corrected: the chain grows and exactly one entry of the chain is live", !!head && (await live()).filter((e) => [orig.id, n1.id, head.id].includes(e.id)).length === 1);

// ------------------------------------------------------------------------ 4. kind and order link
for (const k of ["expense", "cash_in", "cash_out", "other_income"]) {
  const e = await record(alice, { kind: k, amount: 300, date: prevDay(6), settled: true });
  const r = await correct(alice, e.id, { amount: "310", client_request_id: req() });
  check(`${k}: the replacement is still ${k} in the database`, r.status === 201 && (await entryRow(r.body.entry.id)).kind === k, JSON.stringify(r).slice(0, 200));
  const wrong = await correct(alice, (await live()).find((x) => x.replaces_entry_id === e.id).id, { kind: k === "expense" ? "sale" : "expense", amount: "320", client_request_id: req() });
  check(`${k}: asking for another kind is refused and nothing changes`, wrong.status === 400 && wrong.body.details[0] === "kind_cannot_change");
}
const linked = await record(alice, { kind: "expense", amount: 900, date: prevDay(7), linkType: "restaurant_order", linkId: OID(11) });
const rl = await correct(alice, linked.id, { amount: "950", client_request_id: req() });
eq("an order link is carried forward by the server into the replacement row", [rl.status, (await entryRow(rl.body.entry.id)).linked_order_type, (await entryRow(rl.body.entry.id)).linked_order_id], [201, "restaurant_order", OID(11)]);
const head2 = (await live()).find((e) => e.replaces_entry_id === linked.id);
for (const [name, extra] of [["removing it", { linked_order_type: null, linked_order_id: null }], ["pointing it at another order", { linked_order_type: "music_order", linked_order_id: OID(21) }]]) {
  const r = await correct(alice, head2.id, { amount: "960", client_request_id: req(), ...extra });
  check(`client attempt: ${name} is refused and the link in the database is unchanged`, r.status === 400 && r.body.details[0] === "order_link_cannot_change" && (await entryRow(head2.id)).linked_order_id === OID(11) && !(await entryRow(head2.id)).voided_at);
}
const linkedSale = await record(alice, { kind: "sale", amount: 1200, date: prevDay(8), linkType: "music_order", linkId: OID(21) });
const rls = await correct(alice, linkedSale.id, { amount: "1300", client_request_id: req() });
check("a manual sale linked to a music order can be corrected (the SQL's one-live-sale-per-order rule does not block its own replacement)", rls.status === 201 && (await entryRow(rls.body.entry.id)).linked_order_id === OID(21));

// ------------------------------------------------------------------------ 5. invoice payments stay blocked (real Phase 2 payment)
const svc = async (expr) => (await as("service_role", null, `select ${expr} as r`)).rows[0].r;
await svc(`doc_upsert_business_profile(${q(PR.alice)}::uuid, ${q(U.alice)}::uuid, 'Alice Boutique', null, null, null, null, null, null, null, null::int, null, null::int)`);
const d0 = (await svc(`doc_save_draft(${q(PR.alice)}::uuid, ${q(U.alice)}::uuid, null::uuid, 'invoice', 'fr', '{"name":"Payer"}'::jsonb, null::date, null, null, false, '[{"description":"Job","quantity":"1","unit_price":"8000"}]'::jsonb, null::uuid, ${q(req())}::uuid)`)).document;
const issued = (await svc(`doc_issue(${q(PR.alice)}::uuid, ${q(U.alice)}::uuid, ${q(d0.id)}::uuid)`)).document;
const paid = await svc(`doc_record_payment(${q(PR.alice)}::uuid, ${q(U.alice)}::uuid, ${q(issued.id)}::uuid, 3000::numeric, 'cash', null, ${q(today)}::date, ${q(req())}::uuid)`);
const payEntry = paid.payment.bk_entry_id;
const pe = await entryRow(payEntry);
check("setup: the real payment created a sale entry in category invoice_payment, linked to the payment row", pe.kind === "sale" && pe.category === "invoice_payment" && Number(pe.amount) === 3000 && pe.voided_at === null);
const rp = await correct(alice, payEntry, { amount: "3100", client_request_id: req() });
check("the correction route refuses an invoice-payment entry (409 entry_linked_to_invoice_payment)", rp.status === 409 && rp.body.error === "entry_linked_to_invoice_payment", JSON.stringify(rp));
eq("...and the entry and the payment are untouched", [(await entryRow(payEntry)).voided_at, Number((await one(`select count(*)::int n from bk_entries where replaces_entry_id = ${q(payEntry)}`)).n), (await one(`select voided_at from bk_document_payments where id = ${q(paid.payment.id)}`)).voided_at], [null, 0, null]);
globalThis.__owner = { ok: true, owner: alice };
const generic = await postRoute.POST(new Request("http://x/api/bookkeeping/entries", { method: "POST", body: JSON.stringify({ kind: "sale", amount: 3100, entry_date: today, replaces_entry_id: payEntry, client_request_id: req() }) }));
check("the generic POST /api/bookkeeping/entries refuses to replace it too (409), against the real database", generic.status === 409 && (await generic.json()).error === "entry_linked_to_invoice_payment" && !(await entryRow(payEntry)).voided_at && Number((await one(`select count(*)::int n from bk_entries where replaces_entry_id = ${q(payEntry)}`)).n) === 0);
const gOk = await postRoute.POST(new Request("http://x/api/bookkeeping/entries", { method: "POST", body: JSON.stringify({ kind: "expense", amount: 111, entry_date: today, client_request_id: req() }) }));
check("control: the generic route still creates an ordinary entry (201)", gOk.status === 201);
const manual = await record(alice, { kind: "sale", amount: 777, date: prevDay(9), category: "invoice_payment" });
const rm = await correct(alice, manual.id, { amount: "778", client_request_id: req() });
check("a manual entry that merely carries the reserved invoice_payment category is not corrected here either (fail closed)", rm.status === 409);
const mv = await record(alice, { kind: "sale", amount: 400, date: prevDay(10), category: "retail" });
const rmv = await correct(alice, mv.id, { amount: "401", category: "invoice_payment", client_request_id: req() });
check("a manual entry cannot be turned INTO an invoice_payment entry by a correction (400 category_reserved)", rmv.status === 400 && rmv.body.details[0] === "category_reserved" && !(await entryRow(mv.id)).voided_at);
const reportBefore = await report(alice, ty, tm);
const vp = await svc(`doc_void_payment(${q(PR.alice)}::uuid, ${q(U.alice)}::uuid, ${q(paid.payment.id)}::uuid, 'wrong amount')`);
check("control: the controlled path (void the payment from the invoice) voids the payment AND its entry together", !!vp && !!(await entryRow(payEntry)).voided_at && !!(await one(`select voided_at from bk_document_payments where id = ${q(paid.payment.id)}`)).voided_at);
const reportAfter = await report(alice, ty, tm);
eq("...and the report drops the invoice payment exactly once (-3 000)", reportAfter.revenue.invoicePaymentsMinor - reportBefore.revenue.invoicePaymentsMinor, -3000);

// ------------------------------------------------------------------------ 6. other business, voided, validation against the real constraints
const bobEntry = await record(bob, { kind: "sale", amount: 9000, date: prevDay(5) });
const rb = await correct(alice, bobEntry.id, { amount: "9100", client_request_id: req() });
check("another business's entry: 404, nothing touched", rb.status === 404 && !(await entryRow(bobEntry.id)).voided_at && Number((await one(`select count(*)::int n from bk_entries where replaces_entry_id = ${q(bobEntry.id)}`)).n) === 0);
eq("row level security (real policy): alice's own client cannot read bob's entry at all", (await alice.supabase.from("bk_entries").select("id").eq("id", bobEntry.id)).data, []);
const rbv = await correct(bob, bobEntry.id, { amount: "9100", client_request_id: req() });
check("the owner of that business can correct it", rbv.status === 201);
const rvd = await correct(alice, orig.id, { amount: "1", client_request_id: req() });
check("a voided entry: 409", rvd.status === 409 && rvd.body.error === "entry_already_voided");
const fut = await correct(alice, mv.id, { amount: "401", entry_date: dayShift(today, 1), client_request_id: req() });
check("a future date is refused (400 date_in_future) before the database is called", fut.status === 400 && fut.body.details.includes("date_in_future"));
const cashFalse = await record(alice, { kind: "cash_in", amount: 50, date: prevDay(11) });
const rcf = await correct(alice, cashFalse.id, { amount: "50", cash_settled: false, client_request_id: req() });
check("cash entries must stay settled (400), the database constraint is never the first line", rcf.status === 400 && rcf.body.details.includes("cash_entry_must_be_settled"));
const rid3 = req();
await correct(alice, mv.id, { amount: "402", client_request_id: rid3 });
const clash = await correct(alice, (await live()).find((e) => e.kind === "other_income").id, { amount: "403", client_request_id: rid3 });
check("a request id already used by another entry's correction is refused (409 client_request_id_in_use) rather than replayed", clash.status === 409 && clash.body.error === "client_request_id_in_use", JSON.stringify(clash));
globalThis.__owner = { ok: true, owner: alice };
const viaRoute = await correctRoute.POST(new Request("http://x/api/reports/entries/x/correct", { method: "POST", body: JSON.stringify({ amount: "410", client_request_id: req() }) }), { params: { id: (await live()).find((e) => e.kind === "other_income").id } });
check("the real route works end to end against the database (private no-store, 201)", viaRoute.status === 201 && /no-store/.test(viaRoute.headers.get("cache-control")));
const totalLive = await rows(`select entry_date::text d from bk_entries where profile_id = ${q(PR.alice)} and voided_at is null`);
check("no entry was ever deleted or edited in place: every original still exists", Number((await one(`select count(*)::int n from bk_entries where profile_id = ${q(PR.alice)}`)).n) >= totalLive.length + 6);
const mut = await errOf(() => db.exec(`update bk_entries set amount = 1 where id = ${q(orig.id)}`));
check("the database itself refuses to edit an entry in place (immutability trigger)", !!mut, String(mut));
async function errOf(fn) { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } }

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
