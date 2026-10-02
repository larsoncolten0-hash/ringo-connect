// Ringo AI x Business Toolkit: the REAL prepare -> Confirm & Apply -> Toolkit path against the REAL SQL.
//
// What is real: the repository's Ringo AI migrations (foundation .. menu item create), the Shop checkout foundation, the Business Toolkit Phase 1-4 migrations and
// the un-applied 2026-12-05 business-drafts migration run on an in-memory PostgreSQL (PGlite, a real PostgreSQL engine in WASM); ai_claim_draft (row lock, revision,
// expiry), the draft audit trail, bk_record_entry, doc_save_draft / doc_issue / doc_record_payment (receipt + bookkeeping sale in one transaction), the customer
// book, the inventory RPCs, the immutability triggers, the grants and the RLS policies are all genuinely evaluated. The application code is the REAL code: the
// prepare_* tools, the Ringo AI gate, the Business Toolkit gate (resolveBookkeepingOwner), applyDraft, the draft store, the Toolkit handlers.
// What is a stand-in: the PostgREST layer (a small query translator below), the roles / auth.uid(), the session cookie (a global "who is signed in"), and reduced
// users / plans / profiles / products tables. It never connects to Supabase or any real database, never reads .env.local, calls no model and no network.
// Nothing here proves compatibility with the production schema, and the 2026-12-05 migration is only applied to the scratch database.
//   Run:  node scripts/tests/aiBusinessApplySql.test.mjs
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
const serverStubFile = path.join(os.tmpdir(), `aibas_server_${process.pid}.cjs`);
fs.writeFileSync(serverStubFile, "module.exports = { createClient: () => globalThis.__sessionClient(), createAdminClient: () => globalThis.__adminClient() };");
tmp.push(serverStubFile);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStubFile, "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const TOOLS = load("lib/ai/tools/definitions/businessDrafts.ts");
const { applyDraft } = load("lib/ai/drafts/apply.ts");
const { discardDraft } = load("lib/ai/drafts/store.ts");
const DOC = load("lib/documents/handlers.ts");
const INV = load("lib/inventory/handlers.ts");
const { resolveBookkeepingOwner } = load("lib/bookkeeping/access.ts");

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ID = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = ["alice", "bob", "carol", "dan", "erin", "fay", "gus", "hana"];
const U = Object.fromEntries(names.map((n, i) => [n, ID("c", i + 1)]));
const PR = Object.fromEntries(names.map((n, i) => [n, ID("a", i + 1)]));
const CONV = Object.fromEntries(names.map((n, i) => [n, ID("e", i + 1)]));
const PLN = { free: ID("d", 1), full: ID("d", 2), aiOnly: ID("d", 3), toolkitOnly: ID("d", 4) };
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// ------------------------------------------------------------------------ the database: real migrations on a scratch PostgreSQL
const db = new PGlite();
await db.exec(`
  set timezone = 'UTC';
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key, name text not null unique, max_products int, ai_enabled boolean not null default false, business_toolkit_enabled boolean not null default false);
  create table public.users (id uuid primary key, email text not null, role text not null default 'creator', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text,
    is_demo boolean not null default false, published boolean not null default true, category text, categories text[] not null default '{}');
  alter table public.profiles enable row level security;
  create policy "profiles readable" on public.profiles for select using (true);
  create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, name text not null,
    price numeric(10,2), image_url text, image_urls text[] not null default '{}', available boolean not null default true, inventory_count int,
    product_type text not null default 'physical', digital_file_path text, digital_file_name text, digital_file_size_bytes bigint, digital_file_mime text);
  alter table public.products enable row level security;
  create policy "products public read" on public.products for select using (true);
  create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.events (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.menu_items (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.tracks (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.protection_transactions (id uuid primary key default gen_random_uuid(), target_type text, target_id uuid);
  create table public.protection_payments (id uuid primary key default gen_random_uuid(), protection_transaction_id uuid, status text, expires_at timestamptz);
  create table public.platform_settings (id int primary key default 1, fapshi_enabled boolean not null default true);
  insert into public.platform_settings default values;
  create table public.ringo_customers (id uuid primary key default gen_random_uuid());
  create table public.email_suppressions (id uuid primary key default gen_random_uuid(), email text not null unique, reason text not null default 'manual');
`);
const MIGRATIONS = ["2026-10-25_ringo_ai_foundation", "2026-10-26_ringo_ai_quota_reservations", "2026-10-27_ringo_ai_drafts", "2026-10-28_ringo_ai_product_update", "2026-10-29_ringo_ai_content_actions",
  "2026-10-30_ringo_ai_menu_item_create", "2026-11-02_product_checkout_foundation", "2026-12-01_bookkeeping_foundation", "2026-12-02_documents_invoices_receipts", "2026-12-03_debtors_reminders",
  "2026-12-04_inventory_stock_control"];
for (const m of MIGRATIONS) await db.exec(read(`supabase/migrations/${m}.sql`));
const BUSINESS = read("supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql");
const ROLLBACK = read("supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql");

const one = async (sql) => (await db.query(sql)).rows[0];
const rows = async (sql) => (await db.query(sql)).rows;
const exec = (sql) => db.exec(sql);
const count = async (sql) => Number((await one(sql)).n);
const checkDef = async () => (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.ai_drafts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%draft_type%'`)).d;

// ============================================================================ 1. the migration itself (before it, the database only knows the original 8 types)
const typeSql = (t) => `insert into ai_drafts (user_id, profile_id, conversation_id, draft_type, payload, summary) values ('${ID("c", 1)}','${ID("a", 1)}','${ID("e", 1)}','${t}','{}','x')`;
await exec(`
  insert into public.plans (id, name, ai_enabled, business_toolkit_enabled) values ('${PLN.free}','free',false,false),('${PLN.full}','full',true,true),('${PLN.aiOnly}','ai_only',true,false),('${PLN.toolkitOnly}','toolkit_only',false,true);
  insert into public.users (id, email, plan_id) values
    ('${U.alice}','a@x.test','${PLN.full}'),('${U.bob}','b@x.test','${PLN.full}'),('${U.carol}','c@x.test','${PLN.full}'),('${U.dan}','d@x.test','${PLN.aiOnly}'),
    ('${U.erin}','e@x.test','${PLN.toolkitOnly}'),('${U.fay}','f@x.test','${PLN.full}'),('${U.gus}','g@x.test','${PLN.full}'),('${U.hana}','h@x.test','${PLN.full}');
  insert into public.profiles (id, user_id, username, name, currency, is_demo, category) values
    ('${PR.alice}','${U.alice}','alice','Alice Shop','XAF',false,'business_ecommerce'),('${PR.bob}','${U.bob}','bob','Bob Shop','XAF',false,'business_ecommerce'),
    ('${PR.carol}','${U.carol}','carol','Carol Consulting','XAF',false,'professional_services'),('${PR.dan}','${U.dan}','dan','Dan','XAF',false,'business_ecommerce'),
    ('${PR.erin}','${U.erin}','erin','Erin','XAF',false,'business_ecommerce'),('${PR.fay}','${U.fay}','fay','Fay Demo','XAF',true,'business_ecommerce'),
    ('${PR.gus}','${U.gus}','gus','Gus Diner','XAF',false,'restaurant_food'),('${PR.hana}','${U.hana}','hana','Hana Clinic','XAF',false,'health_medical');
`);
for (const n of names) await exec(`insert into public.ai_conversations (id, user_id, profile_id, locale) values ('${CONV[n]}','${U[n]}','${PR[n]}','en')`);
const before12 = await db.query(typeSql("bk.entry.create")).then(() => "inserted", () => "refused");
eq("migration: BEFORE it, a business draft type is refused by the database", before12, "refused");
await db.exec(BUSINESS);
const widened = await checkDef();
check("migration: AFTER it, the 5 business types and the original 8 are all allowed", ["bk.entry.create", "bk.invoice.create", "bk.invoice.payment", "bk.customer.create", "bk.stock.adjust", "profile.update", "product.create", "event.create", "product.update", "event.update", "track.update", "menu_item.update", "menu_item.create"].every((t) => widened.includes(`'${t}'`)), widened);
await db.exec(BUSINESS);
eq("migration: running it a second time is harmless (idempotent) and leaves exactly one draft_type CHECK", await count(`select count(*) n from pg_constraint where conrelid = 'public.ai_drafts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%draft_type%'`), 1);
const badType = await db.query(typeSql("bk.bogus")).then(() => "inserted", (e) => e.message.split("\n")[0]);
check("migration: an unknown draft type is still refused by the database", /check/i.test(String(badType)), badType);
const bizCode = BUSINESS.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
check("migration: it adds no table, column, index, trigger, policy or function (only the CHECK)", !/create\s+(table|function|index|trigger|policy|or replace)|add\s+column/i.test(bizCode));
check("migration: it contains no data statement (no insert/update/delete/truncate/drop table)", !/\b(insert|update|delete|truncate)\b|drop\s+table/i.test(bizCode));

const say = (who, text) => exec(`insert into public.ai_messages (conversation_id, role, content) values ('${CONV[who]}','user',${q(text)})`);

// ------------------------------------------------------------------------ a tiny PostgREST-style translator over PGlite (run as a given role)
const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `${q(JSON.stringify(v))}::jsonb` : q(v));
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const dbErr = (e) => ({ code: e.code, message: String(e.message).split("\n")[0] });
// PGlite serialises queries, but the role switch + query + reset below is several statements: run them one at a time so concurrent callers cannot interleave.
let chainTail = Promise.resolve();
const serial = (fn) => { const next = chainTail.then(fn, fn); chainTail = next.then(() => undefined, () => undefined); return next; };
function client(role, subOf) {
  const run = (sql) => serial(() => as(role, subOf(), sql));
  return {
    from(table) {
      const st = { cols: "*", where: [], order: [], limit: null, offset: 0, mode: "select", values: null, head: false };
      const colSql = () => st.cols === "*" ? "*" : splitCols(st.cols).map((c) => {
        const m = /^plans\(([^)]*)\)$/.exec(c);
        if (m) return `(select to_json(x) from (select ${m[1]} from public.plans where plans.id = "${table}".plan_id) x) as plans`;
        if (c.includes("(")) return `'[]'::json as "${c.slice(0, c.indexOf("("))}"`;
        return `"${c}"`;
      }).join(", ");
      const whereSql = () => (st.where.length ? ` where ${st.where.join(" and ")}` : "");
      const sql = () => {
        if (st.mode === "insert") {
          const keys = Object.keys(st.values);
          return `with r as (insert into public."${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((k) => lit(st.values[k])).join(",")}) returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x`;
        }
        if (st.mode === "update") {
          const set = Object.entries(st.values).map(([k, v]) => `"${k}" = ${lit(v)}`).join(", ");
          return `with r as (update public."${table}" set ${set}${whereSql()} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x`;
        }
        if (st.head) return `select '[]'::json as j, (select count(*)::int from public."${table}"${whereSql()}) as n`;
        const o = st.order.length ? ` order by ${st.order.join(", ")}` : "";
        const l = st.limit !== null ? ` limit ${st.limit} offset ${st.offset}` : "";
        return `select coalesce(json_agg(r), '[]'::json) as j from (select ${colSql()} from public."${table}"${whereSql()}${o}${l}) r`;
      };
      const exec1 = async () => { try { const r = (await run(sql())).rows[0]; return { data: r.j, count: r.n ?? null, error: null }; } catch (e) { return { data: null, count: null, error: dbErr(e) }; } };
      const chain = {
        select(c, opts) { if (st.mode === "select" || c !== undefined) st.cols = c ?? "*"; if (opts?.head) st.head = true; return chain; },
        insert(v) { st.mode = "insert"; st.values = v; return chain; },
        update(v) { st.mode = "update"; st.values = v; return chain; },
        eq(c, v) { st.where.push(`"${c}" = ${lit(v)}`); return chain; },
        in(c, v) { st.where.push(`"${c}" in (${v.map(lit).join(",")})`); return chain; },
        is(c, v) { st.where.push(`"${c}" is ${v === null ? "null" : lit(v)}`); return chain; },
        not(c, op, v) { st.where.push(`"${c}" is not ${v === null ? "null" : lit(v)}`); return chain; },
        gte(c, v) { st.where.push(`"${c}" >= ${lit(v)}`); return chain; },
        lte(c, v) { st.where.push(`"${c}" <= ${lit(v)}`); return chain; },
        lt(c, v) { st.where.push(`"${c}" < ${lit(v)}`); return chain; },
        gt(c, v) { st.where.push(`"${c}" > ${lit(v)}`); return chain; },
        or(str) { st.where.push("(" + String(str).split(",").map((cl) => { const i = cl.indexOf(".ilike."); return i < 0 ? "false" : `"${cl.slice(0, i)}" ilike ${q(cl.slice(i + 7))}`; }).join(" or ") + ")"); return chain; },
        order(c, o) { st.order.push(`"${c}" ${o?.ascending === false ? "desc" : "asc"}`); return chain; },
        limit(n) { st.limit = n; return chain; },
        range(a, b) { st.limit = b - a + 1; st.offset = a; return chain; },
        async maybeSingle() { const r = await exec1(); if (r.error) return r; return r.data.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: r.data[0] ?? null, error: null }; },
        async single() { const r = await exec1(); if (r.error) return r; return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: "expected one row" } }; },
        then(res, rej) { return exec1().then((r) => ({ data: r.data, count: r.count, error: r.error }), rej).then(res, rej); },
      };
      return chain;
    },
    rpc: async (name, args) => {
      const list = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      try {
        const r = await run(`select * from ${name}(${list})`);
        const cols = r.fields.map((f) => f.name);
        return { data: cols.length === 1 && cols[0] === name ? r.rows[0]?.[name] ?? null : r.rows, error: null };
      } catch (e) { return { data: null, error: dbErr(e) }; }
    },
  };
}
globalThis.__signedIn = null;
globalThis.__sessionClient = () => { const who = globalThis.__signedIn; return { auth: { getUser: async () => ({ data: { user: who ? { id: U[who] } : null }, error: null }) }, ...client("authenticated", () => (who ? U[who] : null)) }; };
globalThis.__adminClient = () => client("service_role", () => null);

// ------------------------------------------------------------------------ helpers
const today = (await one(`select (now() at time zone 'Africa/Douala')::date::text d`)).d;
const dayShift = (key, n) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const ws = (who, actor = { kind: "owner" }) => ({ userId: U[who], profileId: PR[who], username: who, actor });
const CAT = { carol: "professional_services", gus: "restaurant_food", hana: "health_medical" };
const SNAP = (who) => ({ profile: { category: CAT[who] ?? "business_ecommerce", categories: [] }, businessToolkitAi: true });
const emitted = [];
const ctxOf = (who, actor) => ({ workspace: ws(who, actor), snapshot: SNAP(who), locale: "en", conversationId: CONV[who], emitDraft: (d) => emitted.push(d) });
const tool = (name) => TOOLS.BUSINESS_DRAFT_TOOLS.find((t) => t.name === name);
const prepare = async (who, name, input, actor) => {
  globalThis.__signedIn = who;
  const t = tool(name);
  const parsed = t.parseInput(input);
  if (!parsed) return { ok: false, reason: "rejected_input" };
  return t.run(ctxOf(who, actor), parsed);
};
const apply = async (who, id, rev = 1, as_ = who) => { globalThis.__signedIn = as_; return applyDraft(ws(as_), id, rev); };
const draftRow = (id) => one(`select * from ai_drafts where id = ${q(id)}`);
const events = async (id) => (await rows(`select action, error_code from ai_draft_events where draft_id = ${q(id)} order by created_at, id`)).map((e) => e.action + (e.error_code ? `:${e.error_code}` : ""));
const entriesOf = (who, extra = "") => rows(`select id, kind, amount::text a, category, description, cash_settled, client_request_id, entry_date::text d, linked_order_id, voided_at from bk_entries where profile_id = ${q(PR[who])} ${extra} order by created_at, id`);
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ownerOf = async (who) => { globalThis.__signedIn = who; const r = await resolveBookkeepingOwner(); if (!r.ok) throw new Error(`owner ${who}: ${r.reason}`); return r.owner; };
const ENTRY = { draft_id: null, kind: "sale", amount: 1000, date: null, category: null, description: null, settled: null };
const liveSales = async (who) => Number((await one(`select coalesce(sum(amount),0)::text s from bk_entries where profile_id = '${PR[who]}' and voided_at is null and kind = 'sale'`)).s);

// ============================================================================ 2. entries: prepare writes nothing, apply writes once
const before = await count(`select count(*) n from bk_entries`);
const e1 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 25000, category: "market", description: "Market stall" });
check("entry: preparing returns a draft id and writes NOTHING to the books", e1.ok === true && typeof e1.draft_id === "string" && (await count(`select count(*) n from bk_entries`)) === before, JSON.stringify(e1));
const d1 = await draftRow(e1.draft_id);
eq("entry: the stored draft carries the server's identity, the type and the validated payload (exact decimal amount, Douala today)", [d1.user_id, d1.profile_id, d1.draft_type, d1.status, d1.payload.amount, d1.payload.date, d1.payload.currency], [U.alice, PR.alice, "bk.entry.create", "awaiting_confirmation", "25000", today, "XAF"]);
check("entry: the payload has no user id, no profile id, no request id", !/user_id|profile_id|client_request_id/.test(JSON.stringify(d1.payload)));
check("entry: the card the owner sees carries no ids", emitted.length > 0 && !JSON.stringify(emitted.at(-1)).includes(PR.alice) && !JSON.stringify(emitted.at(-1)).includes(U.alice));
const a1 = await apply("alice", e1.draft_id);
check("entry: confirming applies through the Toolkit and answers ok", a1.ok === true && a1.alreadyApplied === false, JSON.stringify(a1).slice(0, 300));
const es = await entriesOf("alice");
eq("entry: exactly one entry with the draft's kind/amount/category/description, settled, not linked to any order", es.map((e) => [e.kind, Number(e.a), e.category, e.description, e.cash_settled, e.linked_order_id]), [["sale", 25000, "market", "Market stall", true, null]]);
eq("entry: the Toolkit request id IS the draft's target id (idempotency key)", es[0].client_request_id, d1.target_id);
const dAfter = await draftRow(e1.draft_id);
eq("entry: the draft is applied and records the created entry", [dAfter.status, dAfter.result_id], ["applied", es[0].id]);
eq("entry: the audit trail is created, apply_started, applied", await events(e1.draft_id), ["created", "apply_started", "applied"]);
const a1b = await apply("alice", e1.draft_id);
check("entry: confirming the same draft again changes nothing (already applied, no second entry)", a1b.ok === false && a1b.code === "already_applied" && (await entriesOf("alice")).length === 1, JSON.stringify(a1b).slice(0, 200));

const e2 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, kind: "expense", amount: 1200, date: today, category: "transport", settled: true });
const many = await Promise.all([1, 2, 3, 4, 5].map(() => apply("alice", e2.draft_id)));
check("concurrency: five simultaneous confirmations produce exactly one entry and exactly one success", (await entriesOf("alice", "and kind = 'expense'")).length === 1 && many.filter((r) => r.ok && !r.alreadyApplied).length === 1, many.map((r) => (r.ok ? "ok" : r.code)).join());
eq("concurrency: the audit trail has exactly one applied event", (await events(e2.draft_id)).filter((x) => x === "applied").length, 1);

// ============================================================================ 3. adversarial entry inputs (tools)
const bad = async (label, input, reason) => { const r = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, ...input }); check(`entry input: ${label} is refused (${reason})`, r.ok === false && r.reason === reason, JSON.stringify(r).slice(0, 200)); };
await bad("a negative amount", { amount: -5 }, "invalid_input");
await bad("a zero amount", { amount: 0 }, "invalid_input");
await bad("a text amount", { amount: "ten thousand" }, "invalid_input");
await bad("a fractional XAF amount", { amount: 10.5 }, "invalid_input");
await bad("an enormous amount", { amount: 1e18 }, "invalid_input");
await bad("a future date", { date: dayShift(today, 3) }, "invalid_input");
await bad("a malformed date", { date: "yesterday" }, "invalid_input");
await bad("an unknown kind", { kind: "refund" }, "invalid_input");
await bad("the reserved invoice_payment category", { category: "invoice_payment" }, "invalid_input");
await bad("an over-long description", { description: "x".repeat(600) }, "invalid_input");
const spoof = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 700, profile_id: PR.bob, user_id: U.bob, currency: "USD", linked_order_id: ID("9", 1) });
const spoofRow = await draftRow(spoof.draft_id);
check("entry input: model-supplied profile id, user id, currency and order link are dropped (Alice's draft, in XAF, no order link)", spoofRow.profile_id === PR.alice && spoofRow.user_id === U.alice && spoofRow.payload.currency === "XAF" && !("linked_order_id" in spoofRow.payload) && !JSON.stringify(spoofRow.payload).includes(PR.bob), JSON.stringify(spoofRow.payload));
const cashCat = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, kind: "cash_in", amount: 5000, category: "rent", settled: false });
const cashRow = cashCat.ok ? await draftRow(cashCat.draft_id) : null;
check("entry input: cash in/out ignores a category and is always settled", cashCat.ok === true && cashRow.payload.category === null && cashRow.payload.settled === true, JSON.stringify(cashRow?.payload ?? cashCat));
const dupe = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 25000, category: "market", description: "Market stall" });
check("repeated identical request: a second identical prepare makes a second DRAFT (nothing recorded); only a confirmation records", dupe.ok === true && dupe.draft_id !== e1.draft_id && (await entriesOf("alice", "and kind = 'sale' and amount = 25000")).length === 1);

// ============================================================================ 4. gates: plan, category, demo, staff, apply-time re-check
const refusals = {
  dan: await prepare("dan", "prepare_bookkeeping_entry", ENTRY),
  erin: await prepare("erin", "prepare_bookkeeping_entry", ENTRY),
  fay: await prepare("fay", "prepare_bookkeeping_entry", ENTRY),
  gus: await prepare("gus", "prepare_bookkeeping_entry", ENTRY),
  staff: await prepare("alice", "prepare_bookkeeping_entry", ENTRY, { kind: "staff", permissions: ["settings.manage"] }),
};
eq("gate: AI-only plan (no Business Toolkit) is refused", [refusals.dan.error, refusals.dan.reason], ["business_toolkit_not_available", "plan_required"]);
eq("gate: Toolkit-only plan (no Ringo AI) is refused", [refusals.erin.error, refusals.erin.reason], ["business_toolkit_not_available", "plan_required"]);
eq("gate: a demo profile is refused by the Toolkit gate", [refusals.fay.error, refusals.fay.reason], ["business_toolkit_not_available", "not_available"]);
eq("gate: a restaurant page (no Toolkit category) is refused even with both plans", [refusals.gus.error, refusals.gus.reason], ["business_toolkit_not_available", "not_available"]);
eq("gate: staff are refused even with the settings permission", [refusals.staff.error, refusals.staff.reason], ["business_toolkit_not_available", "staff_not_supported"]);
eq("gate: nothing was drafted for any refused actor", await count(`select count(*) n from ai_drafts where user_id in ('${U.dan}','${U.erin}','${U.fay}','${U.gus}')`), 0);
globalThis.__signedIn = null;
const noSession = await TOOLS.prepareBookkeepingEntry.run(ctxOf("alice"), ENTRY);
eq("gate: no signed-in session means no draft (the Toolkit gate re-resolves the caller)", noSession.error, "business_toolkit_not_available");
globalThis.__signedIn = "bob";
const mismatch = await TOOLS.prepareBookkeepingEntry.run(ctxOf("alice"), ENTRY);
eq("gate: a session that is not the workspace owner is refused (workspace mismatch)", [mismatch.error, mismatch.reason], ["business_toolkit_not_available", "workspace_mismatch"]);

const g1 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 3333, date: today, description: "gate test", settled: true });
const entriesBeforeGate = (await entriesOf("alice")).length;
const notApplied = async (label, r, codes) => check(`apply gate: ${label} -> refused, nothing recorded`, r.ok === false && (!codes || codes.includes(r.code)) && (await entriesOf("alice")).length === entriesBeforeGate, JSON.stringify(r).slice(0, 200));
await exec(`update users set plan_id = '${PLN.aiOnly}' where id = '${U.alice}'`);
await notApplied("the Toolkit plan removed after preparing", await apply("alice", g1.draft_id));
await exec(`update users set plan_id = '${PLN.toolkitOnly}' where id = '${U.alice}'`);
await notApplied("the AI plan removed after preparing", await apply("alice", g1.draft_id));
await exec(`update profiles set category = 'restaurant_food' where id = '${PR.alice}'`);
await exec(`update users set plan_id = '${PLN.full}' where id = '${U.alice}'`);
await notApplied("the page moved to a non-Toolkit category", await apply("alice", g1.draft_id));
await exec(`update profiles set category = 'business_ecommerce' where id = '${PR.alice}'`);
await exec(`update profiles set is_demo = true where id = '${PR.alice}'`);
await notApplied("the profile turned into a demo profile", await apply("alice", g1.draft_id));
await exec(`update profiles set is_demo = false where id = '${PR.alice}'`);
const g1ok = await apply("alice", g1.draft_id);
check("apply gate: a draft that failed on a gate can be confirmed again once the account is fine, and then records exactly once", g1ok.ok === true && (await entriesOf("alice")).length === entriesBeforeGate + 1, JSON.stringify(g1ok).slice(0, 200));
const g3 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 3335, date: today, description: "currency test", settled: true });
await exec(`update profiles set currency = 'USD' where id = '${PR.alice}'`);
const g3a = await apply("alice", g3.draft_id);
check("apply gate: the business currency changed after preparing -> stale, nothing recorded", g3a.ok === false && g3a.code === "stale" && (await entriesOf("alice", "and description = 'currency test'")).length === 0, JSON.stringify(g3a).slice(0, 200));
await exec(`update profiles set currency = 'XAF' where id = '${PR.alice}'`);
const g3b = await apply("alice", g3.draft_id);
check("apply gate: a stale draft stays stale (it must be re-prepared, never silently applied)", g3b.ok === false && (await entriesOf("alice", "and description = 'currency test'")).length === 0, JSON.stringify(g3b).slice(0, 200));

// ============================================================================ 5. draft lifecycle: expired, discarded, wrong revision, other user
const l1 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 4444, date: today, description: "lifecycle", settled: true });
const nEntries = (await entriesOf("alice")).length;
const wrongRev = await apply("alice", l1.draft_id, 2);
check("lifecycle: confirming a revision the owner never saw is refused", wrongRev.ok === false && wrongRev.code === "revision_mismatch");
const foreign = await apply("alice", l1.draft_id, 1, "bob");
check("lifecycle: another owner confirming Alice's draft finds nothing and writes nothing", foreign.ok === false && foreign.code === "not_found" && (await entriesOf("alice")).length === nEntries && (await entriesOf("bob")).length === 0, JSON.stringify(foreign).slice(0, 200));
await exec(`update ai_drafts set expires_at = now() - interval '1 minute' where id = '${l1.draft_id}'`);
const expired = await apply("alice", l1.draft_id);
check("lifecycle: an expired draft is refused and writes nothing", expired.ok === false && expired.code === "expired" && (await entriesOf("alice")).length === nEntries, JSON.stringify(expired).slice(0, 200));
const l2 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 4445, date: today, description: "discard", settled: true });
globalThis.__signedIn = "alice";
await discardDraft(ws("alice"), l2.draft_id);
const disc = await apply("alice", l2.draft_id);
check("lifecycle: a discarded draft cannot be applied", disc.ok === false && disc.code === "discarded" && (await entriesOf("alice")).length === nEntries);
const l3 = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, amount: 4446, date: today, description: "rev1", settled: true });
const l3r = await prepare("alice", "prepare_bookkeeping_entry", { ...ENTRY, draft_id: l3.draft_id, amount: 4447, date: today, description: "rev2", settled: true });
eq("lifecycle: revising a draft bumps its revision (the owner confirms the revision on the card)", [l3r.ok, l3r.revision], [true, 2]);
const stale1 = await apply("alice", l3.draft_id, 1);
check("lifecycle: the old revision can no longer be applied", stale1.ok === false && stale1.code === "revision_mismatch");
const rev2 = await apply("alice", l3.draft_id, 2);
check("lifecycle: the confirmed revision applies, with the REVISED amount only", rev2.ok === true && Number((await entriesOf("alice", "and description = 'rev2'"))[0]?.a) === 4447 && (await entriesOf("alice", "and description = 'rev1'")).length === 0);

// ============================================================================ 6. customers
await say("alice", "Please add my customer Jean Test, phone 677 11 22 33.");
const c1 = await prepare("alice", "prepare_customer", { draft_id: null, name: "Jean Test", phone: "677112233", email: null });
check("customer: a phone number the owner typed is accepted", c1.ok === true, JSON.stringify(c1));
const c1x = await prepare("alice", "prepare_customer", { draft_id: null, name: "Fake Person", phone: "699000000", email: null });
eq("customer: a phone number the owner never typed is refused", [c1x.ok, c1x.reason], [false, "contact_not_from_user"]);
const c1y = await prepare("alice", "prepare_customer", { draft_id: null, name: "Fake Person", phone: null, email: "made.up@mail.test" });
eq("customer: an e-mail the owner never typed is refused", [c1y.ok, c1y.reason], [false, "contact_not_from_user"]);
const c1a = await apply("alice", c1.draft_id);
eq("customer: confirming adds exactly one customer in Alice's own book, none in Bob's", [c1a.ok, await count(`select count(*) n from bk_customers where profile_id = '${PR.alice}' and name = 'Jean Test'`), await count(`select count(*) n from bk_customers where profile_id = '${PR.bob}'`)], [true, 1, 0]);
const c2 = await prepare("alice", "prepare_customer", { draft_id: null, name: "Jean Duplicate", phone: "677112233", email: null });
const c2a = await apply("alice", c2.draft_id);
check("customer: a second customer with the same phone is reported, never created", c2a.ok === false && c2a.code === "duplicate_customer" && (await count(`select count(*) n from bk_customers where profile_id = '${PR.alice}'`)) === 1, JSON.stringify(c2a).slice(0, 200));
const c3 = await prepare("alice", "prepare_customer", { draft_id: null, name: "   ", phone: null, email: null });
eq("customer: an empty name is refused", [c3.ok, c3.reason], [false, "missing_fields"]);

// ============================================================================ 7. invoices: a DRAFT document only; payments create the receipt and the revenue once
const iv = await prepare("alice", "prepare_invoice", { draft_id: null, client_name: "Jean Test", lines: [{ description: "Website", quantity: 2, unit_price: 5000 }], due_date: dayShift(today, 14), notes: "Thanks" });
check("invoice: preparing for a known customer works and resolves the customer on the server", iv.ok === true, JSON.stringify(iv));
const ivRow = await draftRow(iv.draft_id);
check("invoice: the draft carries the server-resolved customer id (never model-supplied), the exact lines and the business currency", typeof ivRow.payload.customerId === "string" && ivRow.payload.lines.length === 1 && ivRow.payload.currency === "XAF", JSON.stringify(ivRow.payload));
const docsBefore = await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}'`);
const entriesBeforeInv = (await entriesOf("alice")).length;
const ivA = await apply("alice", iv.draft_id);
check("invoice: confirming creates ONE draft invoice", ivA.ok === true && (await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}'`)) === docsBefore + 1, JSON.stringify(ivA).slice(0, 200));
const doc = await one(`select id, doc_type, status, number, total::text t from bk_documents where id = ${q((await draftRow(iv.draft_id)).result_id)}`);
eq("invoice: it is an invoice in DRAFT status with no number and the right total (not issued, not sent)", [doc.doc_type, doc.status, doc.number, Number(doc.t)], ["invoice", "draft", null, 10000]);
eq("invoice: it is linked to the customer", await count(`select count(*) n from bk_document_customer_links where document_id = '${doc.id}' and customer_id = '${ivRow.payload.customerId}'`), 1);
eq("invoice: a draft invoice adds NO bookkeeping entry (no revenue)", (await entriesOf("alice")).length, entriesBeforeInv);
await apply("alice", iv.draft_id);
eq("invoice: confirming again creates no second invoice", await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}'`), docsBefore + 1);
const ivNew = await prepare("alice", "prepare_invoice", { draft_id: null, client_name: "Brand New Client", lines: [{ description: "x", quantity: 1, unit_price: 100 }], due_date: null, notes: null });
const ivNewA = await apply("alice", ivNew.draft_id);
check("invoice: an unknown client name is kept as typed on the invoice and no customer is created", ivNew.ok === true && ivNewA.ok === true && (await count(`select count(*) n from bk_customers where profile_id = '${PR.alice}'`)) === 1);
for (const [label, lines] of [["no lines", []], ["a zero price", [{ description: "x", quantity: 1, unit_price: 0 }]], ["a negative quantity", [{ description: "x", quantity: -1, unit_price: 10 }]], ["a missing description", [{ description: "", quantity: 1, unit_price: 10 }]], ["21 lines", Array.from({ length: 21 }, () => ({ description: "x", quantity: 1, unit_price: 1 }))]]) {
  const r = await prepare("alice", "prepare_invoice", { draft_id: null, client_name: null, lines, due_date: null, notes: null });
  check(`invoice input: ${label} is refused`, r.ok === false, JSON.stringify(r).slice(0, 150));
}

// issue an invoice with the Toolkit's own handler (the AI cannot issue), then take payments through AI drafts
const owner = await ownerOf("alice");
const made = await DOC.createDraft(owner, { locale: "en", customer: { name: "Jean Test" }, due_date: dayShift(today, 10), notes: null, tax_enabled: false, lines: [{ description: "Consulting", quantity: 1, unit_price: "10000" }], client_request_id: RQ(1) });
const invId = made.body.document.id;
const issued = await DOC.issueDocument(owner, invId);
const invNo = issued.body.document.number;
check("setup: an invoice was issued by the Toolkit (not by the AI)", issued.status === 200 && /^INV-/.test(invNo), JSON.stringify(issued.body).slice(0, 200));
const PAY = { draft_id: null, invoice_number: invNo, client_name: null, amount: 100, method: "cash", paid_on: null, reference: null };
const revenueBefore = await liveSales("alice");
const over = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: 12000 });
eq("payment: more than the amount due is refused, with the amount due", [over.ok, over.reason, over.amount_due], [false, "amount_exceeds_balance", 10000]);
const noInv = await prepare("alice", "prepare_invoice_payment", { ...PAY, invoice_number: "INV-1999-9999" });
eq("payment: an unknown invoice number is refused", [noInv.ok, noInv.reason], [false, "target_not_found"]);
const noWho = await prepare("alice", "prepare_invoice_payment", { ...PAY, invoice_number: null });
eq("payment: neither an invoice number nor a client is refused", [noWho.ok, noWho.reason], [false, "missing_fields"]);
const badMethod = await prepare("alice", "prepare_invoice_payment", { ...PAY, method: "bitcoin" });
check("payment: an unknown method is refused", badMethod.ok === false, JSON.stringify(badMethod).slice(0, 150));
const futurePay = await prepare("alice", "prepare_invoice_payment", { ...PAY, paid_on: dayShift(today, 2) });
check("payment: a future payment date is refused", futurePay.ok === false, JSON.stringify(futurePay).slice(0, 150));
const negPay = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: -100 });
check("payment: a negative amount is refused", negPay.ok === false, JSON.stringify(negPay).slice(0, 150));
const bobSees = await prepare("bob", "prepare_invoice_payment", PAY);
eq("payment (adversarial): another business cannot even see Alice's invoice number", [bobSees.ok, bobSees.reason], [false, "target_not_found"]);
const p1 = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: 4000, method: "mobile_money", reference: "MM-123" });
check("payment: a valid partial payment is prepared", p1.ok === true, JSON.stringify(p1));
eq("payment: preparing recorded nothing (invoice still unpaid)", Number((await one(`select amount_paid::text a from bk_documents where id = '${invId}'`)).a), 0);
const p1a = await apply("alice", p1.draft_id);
check("payment: confirming records it", p1a.ok === true, JSON.stringify(p1a).slice(0, 200));
eq("payment: the invoice shows 4 000 paid and is partially paid", await one(`select amount_paid::numeric::float8 a, status from bk_documents where id = '${invId}'`), { a: 4000, status: "partially_paid" });
eq("payment: ONE receipt exists for it", await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}' and doc_type = 'receipt'`), 1);
eq("payment: exactly one bookkeeping sale was created BY the payment (category invoice_payment, 4 000)", (await entriesOf("alice", "and category = 'invoice_payment'")).map((e) => Number(e.a)), [4000]);
await apply("alice", p1.draft_id);
eq("payment: a replayed confirmation neither pays twice nor creates a second receipt or entry", [(await entriesOf("alice", "and category = 'invoice_payment'")).length, await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}' and doc_type = 'receipt'`)], [1, 1]);
eq("double counting: revenue grew by exactly the payment (4 000), once", (await liveSales("alice")) - revenueBefore, 4000);
const over2 = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: 7000 });
eq("payment: after a partial payment the balance is 6 000, so 7 000 is refused", [over2.reason, over2.amount_due], ["amount_exceeds_balance", 6000]);
const pFinal = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: 6000 });
const pFinalA = await apply("alice", pFinal.draft_id);
eq("payment: the final payment settles the invoice (paid) with a second receipt", [pFinalA.ok, (await one(`select status from bk_documents where id = '${invId}'`)).status, await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}' and doc_type = 'receipt'`)], [true, "paid", 2]);
eq("double counting: after both payments revenue grew by the invoice total (10 000) and not a franc more", (await liveSales("alice")) - revenueBefore, 10000);
const overPaid = await prepare("alice", "prepare_invoice_payment", { ...PAY, amount: 100 });
check("payment: a settled invoice no longer accepts a payment draft", overPaid.ok === false, JSON.stringify(overPaid).slice(0, 150));

// forged drafts: rows an attacker with database access could write (the model cannot) are still refused by the Toolkit function at apply time
const forgeDraft = async (who, type, payload) => (await one(`insert into ai_drafts (user_id, profile_id, conversation_id, draft_type, payload, summary) values ('${U[who]}','${PR[who]}','${CONV[who]}','${type}',${q(JSON.stringify(payload))}::jsonb,'forged') returning id`)).id;
const forgedPay = await forgeDraft("bob", "bk.invoice.payment", { invoiceId: invId, invoiceNumber: invNo, amount: "100", method: "cash", paidOn: today, reference: null, currency: "XAF" });
const paidBefore = (await one(`select amount_paid::text a from bk_documents where id = '${invId}'`)).a;
const fp = await apply("bob", forgedPay);
check("forged: a payment draft of Bob's that names Alice's invoice id is refused and Alice's invoice is untouched", fp.ok === false && (await one(`select amount_paid::text a from bk_documents where id = '${invId}'`)).a === paidBefore && (await entriesOf("bob")).length === 0, JSON.stringify(fp).slice(0, 200));
const aliceCustomer = (await one(`select id from bk_customers where profile_id = '${PR.alice}' limit 1`)).id;
const forgedInv = await forgeDraft("bob", "bk.invoice.create", { locale: "en", customerName: "Jean Test", customerId: aliceCustomer, lines: [{ description: "x", quantity: "1", unitPrice: "100" }], dueDate: null, notes: null, currency: "XAF" });
await apply("bob", forgedInv);
eq("forged: an invoice draft of Bob's pointing at Alice's customer is never linked to Alice's customer", await count(`select count(*) n from bk_document_customer_links where customer_id = '${aliceCustomer}' and document_id in (select id from bk_documents where profile_id = '${PR.bob}')`), 0);
const forgedCat = await forgeDraft("alice", "bk.entry.create", { kind: "sale", amount: "100", date: today, category: "invoice_payment", description: null, settled: true, currency: "XAF" });
const fc = await apply("alice", forgedCat);
check("forged: an entry draft in the reserved invoice_payment category is refused at apply (re-validated) and nothing is recorded", fc.ok === false && (await entriesOf("alice", "and amount = 100 and category = 'invoice_payment'")).length === 0, JSON.stringify(fc).slice(0, 200));
const forgedNeg = await forgeDraft("alice", "bk.entry.create", { kind: "sale", amount: "-50", date: today, category: null, description: null, settled: true, currency: "XAF" });
const ft = await apply("alice", forgedNeg);
check("forged: a tampered negative amount is refused at apply and nothing is recorded", ft.ok === false && (await entriesOf("alice", "and amount < 0")).length === 0, JSON.stringify(ft).slice(0, 200));
const forgedFuture = await forgeDraft("alice", "bk.entry.create", { kind: "sale", amount: "50", date: dayShift(today, 5), category: null, description: null, settled: true, currency: "XAF" });
const ff = await apply("alice", forgedFuture);
check("forged: a tampered future date is refused at apply and nothing is recorded", ff.ok === false && (await entriesOf("alice", `and entry_date > '${today}'`)).length === 0, JSON.stringify(ff).slice(0, 200));
const forgedType = await db.query(typeSql("bk.refund.create")).then(() => "inserted", () => "refused");
eq("forged: a draft of an unknown business type cannot even be stored", forgedType, "refused");

// ============================================================================ 8. stock
const prod = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Red Shirt',5000,10) returning id`)).id;
const prodBob = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.bob}','Red Shirt',5000,10) returning id`)).id;
await exec(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Blue Hat',2000,null)`);
const convDrafts = async () => count(`select count(*) n from ai_drafts where conversation_id = '${CONV.alice}'`);
while ((await convDrafts()) < 20) await forgeDraft("alice", "bk.entry.create", { kind: "sale", amount: "1", date: today, category: null, description: "filler", settled: true, currency: "XAF" });
const tooMany = await prepare("alice", "prepare_bookkeeping_entry", ENTRY);
eq("limits: a conversation holds at most 20 drafts; the 21st is refused until some are cleared", [tooMany.ok, tooMany.reason], [false, "too_many_drafts"]);
await exec(`delete from ai_drafts where conversation_id = '${CONV.alice}' and status = 'awaiting_confirmation'`);
const STOCK = { draft_id: null, product_name: "Red Shirt", kind: "stock_in", quantity: 5, reason: null, note: null };
const stockOf = async (id) => Number((await one(`select inventory_count n from products where id = '${id}'`)).n);
const notTracked = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, product_name: "Blue Hat" });
eq("stock: a product whose stock is not tracked is refused with a hint to start tracking", [notTracked.ok, notTracked.reason], [false, "not_tracked"]);
const st = await INV.startTracking(owner, prod, { client_request_id: RQ(2) });
check("setup: tracking started with the Toolkit's own function", st.status === 200 || st.status === 201, JSON.stringify(st.body).slice(0, 200));
const none = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, product_name: "Nonexistent" });
eq("stock: an unknown product is refused", [none.ok, none.reason], [false, "target_not_found"]);
const noReason = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, kind: "decrease", quantity: 2 });
eq("stock: a decrease needs a reason", [noReason.ok, noReason.reason], [false, "missing_fields"]);
for (const [label, input] of [["a negative quantity", { quantity: -3 }], ["a fractional quantity", { quantity: 2.5 }], ["a zero quantity", { quantity: 0 }], ["an unknown kind", { kind: "teleport" }]]) {
  const r = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, ...input });
  check(`stock input: ${label} is refused`, r.ok === false, JSON.stringify(r).slice(0, 150));
}
const s1 = await prepare("alice", "prepare_stock_adjustment", STOCK);
const stockBefore = await stockOf(prod);
check("stock: preparing changes no stock", s1.ok === true && (await stockOf(prod)) === stockBefore, JSON.stringify(s1));
const s1a = await apply("alice", s1.draft_id);
const s1b = await apply("alice", s1.draft_id);
eq("stock: confirming adds exactly 5 units, once (a replay changes nothing)", [s1a.ok, s1b.code, (await stockOf(prod)) - stockBefore], [true, "already_applied", 5]);
const s2 = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, kind: "decrease", quantity: 500, reason: "recount" });
const s2a = await apply("alice", s2.draft_id);
check("stock: a decrease below zero is refused by the Toolkit at apply and the stock is unchanged", s2a.ok === false && (await stockOf(prod)) === stockBefore + 5, JSON.stringify(s2a).slice(0, 200));
const s3 = await prepare("alice", "prepare_stock_adjustment", { ...STOCK, kind: "set_count", quantity: 20, reason: "stocktake" });
const s3a = await apply("alice", s3.draft_id);
eq("stock: a stocktake sets the count to exactly 20", [s3a.ok, await stockOf(prod)], [true, 20]);
const forgedStock = await forgeDraft("bob", "bk.stock.adjust", { productId: prod, productName: "Red Shirt", kind: "stock_in", quantity: 99, reason: null, note: null });
const fs2 = await apply("bob", forgedStock);
check("forged: Bob's stock draft naming Alice's product changes nothing", fs2.ok === false && (await stockOf(prod)) === 20, JSON.stringify(fs2).slice(0, 200));
const bobOwn = await prepare("bob", "prepare_stock_adjustment", STOCK);
check("stock: Bob's untracked product never resolves to Alice's tracked product of the same name", bobOwn.ok === false && bobOwn.reason === "not_tracked" && (await stockOf(prod)) === 20 && (await stockOf(prodBob)) === 10, JSON.stringify(bobOwn).slice(0, 200));
const carolStock = await prepare("carol", "prepare_stock_adjustment", { ...STOCK, product_name: "x" });
check("stock: a services page (no stock tracking) cannot prepare a stock draft, and the tool is not even offered there", carolStock.ok === false && tool("prepare_stock_adjustment").available({ profile: { category: "professional_services", categories: [] }, businessToolkitAi: true }) === false);

// ============================================================================ 9. other Toolkit categories use the same path, in their own books only
const carolEntry = await prepare("carol", "prepare_bookkeeping_entry", { ...ENTRY, kind: "expense", amount: 8000, category: "rent", description: "Office", settled: true });
const carolApply = await apply("carol", carolEntry.draft_id);
eq("categories: a professional-services page can prepare and apply an entry (finance layer), in its own books only", [carolEntry.ok, carolApply.ok, (await entriesOf("carol")).length, (await entriesOf("alice", "and description = 'Office'")).length], [true, true, 1, 0]);
const hanaEntry = await prepare("hana", "prepare_bookkeeping_entry", { ...ENTRY, amount: 15000, description: "Consultation fee", settled: true });
const hanaApply = await apply("hana", hanaEntry.draft_id);
check("categories: a health page can record a fee (financial layer)", hanaEntry.ok === true && hanaApply.ok === true && (await entriesOf("hana")).length === 1);

// ============================================================================ 10. migration rollback safety
const rbRefuse = await db.exec(ROLLBACK).then(() => "ran", (e) => e.message.split("\n")[0]);
check("rollback: refuses to run while business drafts exist (it never deletes a draft)", /Business Toolkit drafts/.test(rbRefuse) && (await count(`select count(*) n from ai_drafts where draft_type like 'bk.%'`)) > 0, rbRefuse);
await exec(`delete from ai_drafts where draft_type like 'bk.%'`);
await db.exec(ROLLBACK);
const rbDef = await checkDef();
check("rollback: once none exist it restores the original 8 types", !rbDef.includes("bk.") && rbDef.includes("menu_item.create"), rbDef);
await db.exec(BUSINESS);
check("rollback: the migration can be applied again afterwards", (await checkDef()).includes("bk.stock.adjust"));

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`aiBusinessApplySql: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
