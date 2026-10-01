// Test for supabase/migrations/2026-12-04_inventory_stock_control.sql (Business Toolkit Phase 4: inventory & stock control).
//
// Runs entirely on a scratch, IN-MEMORY PostgreSQL (PGlite: a real PostgreSQL engine compiled to WASM). It never connects to Supabase or any
// real database and never reads .env.local. REAL code executed by that engine: the Phase 1, 2, 3 and 4 migrations, the Phase 4 preflight and
// verify scripts, the documented rollback, AND the real Shop checkout (the 2026-11-02 foundation, plus the latest create_product_order from
// the 2026-11-14 migration and the latest release_product_order_stock from the 2026-11-10 migration, extracted verbatim from those files),
// so inventory is exercised against the true reservation/release behaviour. STAND-INS (PGlite is NOT Supabase): the roles
// anon/authenticated/service_role, schema auth with auth.uid(), Supabase's default privileges, reduced users/plans/profiles/products/
// platform_settings/ringo_customers/email_suppressions tables and two reduced protection tables the release function reads.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json or the lockfile)
//   Run:    node supabase/support/tests/inventory_foundation.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const block = (text, startMarker) => { const i = text.indexOf(startMarker); const j = text.indexOf("\nend $$;", i); return text.slice(i, j + "\nend $$;".length); };

const PHASE1 = read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql");
const PHASE2 = read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql");
const PHASE3 = read("supabase/migrations/2026-12-03_debtors_reminders.sql");
const PHASE4 = read("supabase/migrations/2026-12-04_inventory_stock_control.sql");
const CHECKOUT = read("supabase/migrations/2026-11-02_product_checkout_foundation.sql");
const CREATE_ORDER = block(read("supabase/migrations/2026-11-14_digital_products_foundation.sql"), "create or replace function create_product_order(");
const RELEASE = block(read("supabase/migrations/2026-11-10_ringo_protection_stock_lifecycle.sql"), "create or replace function release_product_order_stock(");
const PREFLIGHT4 = read("supabase/support/2026-12-04_inventory_stock_control.preflight.sql");
const VERIFY4 = read("supabase/support/2026-12-04_inventory_stock_control.verify.sql");
const ROLLBACK4 = PHASE4.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s{3}/, "")).join("\n");

let pass = 0, fail = 0;
const check = (group, name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`  FAIL [${group}]: ${name} | ${String(detail).slice(0, 400)}`); } };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const has = (e, code) => typeof e === "string" && e.includes(code);

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLN = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRD = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), carol: UID(3), dave: UID(4), erin: UID(5), music: UID(6) };
const P = { alice: PID(1), bob: PID(2), carol: PID(3), dave: PID(4), erin: PID(5), music: PID(6) };
const PL = { free: PLN(1), business_pro: PLN(5) };
let rq = 9000;
const req = () => RQ(++rq);
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const db = new PGlite();
await db.exec(`
  set timezone = 'UTC';
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key, name text not null unique);
  create table public.users (id uuid primary key, email text not null, plan_id uuid references public.plans(id));
  insert into public.plans (id, name) values ('${PL.free}','free'),('${PL.business_pro}','business_pro');
  insert into public.users (id, email, plan_id) values ('${U.alice}','a@x.test','${PL.business_pro}'),('${U.bob}','b@x.test','${PL.business_pro}'),('${U.carol}','c@x.test','${PL.free}'),
    ('${U.dave}','d@x.test','${PL.business_pro}'),('${U.erin}','e@x.test','${PL.business_pro}'),('${U.music}','m@x.test','${PL.business_pro}');
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text,
    is_demo boolean not null default false, published boolean not null default true, category text, categories text[] not null default '{}');
  alter table public.profiles enable row level security;
  create policy "profiles readable" on public.profiles for select using (true);
  create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, name text not null,
    price numeric(10,2), image_url text, image_urls text[] not null default '{}', available boolean not null default true, inventory_count int,
    product_type text not null default 'physical', digital_file_path text, digital_file_name text, digital_file_size_bytes bigint, digital_file_mime text);
  alter table public.products enable row level security;
  create policy "products public read" on public.products for select using (true);
  create policy "products owner write" on public.products for all using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()))
    with check (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
  create table public.platform_settings (id int primary key default 1, fapshi_enabled boolean not null default true);
  insert into public.platform_settings default values;
  create table public.ringo_customers (id uuid primary key default gen_random_uuid());
  create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.email_suppressions (id uuid primary key default gen_random_uuid(), email text not null unique, reason text not null default 'manual');
  create table public.protection_transactions (id uuid primary key default gen_random_uuid(), target_type text, target_id uuid);
  create table public.protection_payments (id uuid primary key default gen_random_uuid(), protection_transaction_id uuid, status text, expires_at timestamptz);
  insert into public.profiles (id, user_id, username, name, currency, is_demo, category) values
    ('${P.alice}','${U.alice}','alice','Alice Shop','XAF',false,'business_ecommerce'), ('${P.bob}','${U.bob}','bob','Bob Shop','XAF',false,'business_ecommerce'),
    ('${P.carol}','${U.carol}','carol','Carol','XAF',false,'business_ecommerce'), ('${P.dave}','${U.dave}','dave','Dave','KWD',false,'business_ecommerce'),
    ('${P.erin}','${U.erin}','erin','Erin Demo','XAF',true,'business_ecommerce'), ('${P.music}','${U.music}','music','Music Artist','XAF',false,'music_entertainment');
`);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const svc = (sql) => as("service_role", null, sql);
const fnJson = async (sql) => (await svc(`select ${sql} as r`)).rows[0].r;
const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (table, where = "true") => Number((await one(`select count(*)::int as n from ${table} where ${where}`)).n);

// the real chain: checkout foundation -> its later versions of the two functions -> Phase 1, 2, 3
check("A", "the real Shop checkout foundation applies", (await errOf(() => db.exec(CHECKOUT))) === null);
await db.exec(`alter table product_order_items add column if not exists digital_file_path_snapshot text; alter table product_order_items add column if not exists digital_file_name_snapshot text;`);
check("A", "the real latest create_product_order and release_product_order_stock (extracted verbatim from their migrations) apply", (await errOf(() => db.exec(CREATE_ORDER + "\n" + RELEASE))) === null && CREATE_ORDER.length > 2000 && RELEASE.length > 800);
check("A", "Phase 1, 2 and 3 apply", (await errOf(() => db.exec(PHASE1))) === null && (await errOf(() => db.exec(PHASE2))) === null && (await errOf(() => db.exec(PHASE3))) === null);
await db.exec(`update public.plans set business_toolkit_enabled = true where name = 'business_pro'; update platform_settings set commerce_enabled = true, commerce_commission_rate = 0.05;`);

const pre = (await db.exec(PREFLIGHT4))[0].rows;
check("A", "the Phase 4 preflight passes on a Phase-3-ready database (every row ok)", pre.length >= 14 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));

// products that exist BEFORE Phase 4: a legacy count, an unlimited one, a digital one, other businesses'
const PRODUCT = { legacy: PRD(1), unlimited: PRD(2), digital: PRD(3), bobs: PRD(4), musicMerch: PRD(5), second: PRD(6), kwd: PRD(7), plain: PRD(8) };
await db.exec(`insert into products (id, profile_id, name, price, inventory_count, product_type) values
  ('${PRODUCT.legacy}','${P.alice}','Legacy Shirt',5000,12,'physical'), ('${PRODUCT.unlimited}','${P.alice}','Unlimited Mug',2500,null,'physical'),
  ('${PRODUCT.digital}','${P.alice}','Ebook',3000,null,'digital'), ('${PRODUCT.bobs}','${P.bob}','Bob Cap',1000,7,'physical'),
  ('${PRODUCT.musicMerch}','${P.music}','Band Tee',8000,30,'physical'), ('${PRODUCT.second}','${P.alice}','Second Item',1500,null,'physical'),
  ('${PRODUCT.kwd}','${P.dave}','KWD Item',1500,null,'physical'), ('${PRODUCT.plain}','${P.alice}','Plain Item',900,null,'physical')`);

const snapshot = async () => (await db.query(`
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') as x from information_schema.columns where table_schema = 'public'
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies
  union all select 'fn:' || p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','auth')
  union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
  union all select 'idx:' || indexname from pg_indexes where schemaname = 'public'
  union all select 'tbl:' || tablename from pg_tables where schemaname = 'public'
  union all select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public'
  union all select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  order by 1`)).rows.map((r) => r.x);
const isPhase4 = (s) => /(bk_stock_|bk_products_stock_guard|inv_(start_tracking|adjust_stock|set_stock_count|return_restock|stop_tracking|update_settings|overview|product_detail|refunded_orders))/.test(s);
const before = await snapshot();
const productRowsBefore = (await db.query(`select id, name, price, inventory_count from products order by id`)).rows;

check("A", "Phase 4 applies", (await errOf(() => db.exec(PHASE4))) === null);
const after = await snapshot();
const changed = before.filter((x) => !after.includes(x));
const added = after.filter((x) => !before.includes(x));
check("A", "NOTHING pre-existing was altered: every column, policy, function (body + ACL), trigger, index, table, grant and constraint of Phases 1-3 and the checkout is identical", changed.length === 0, changed.slice(0, 4).join(" | "));
check("A", "everything added belongs to Phase 4, and the ONLY object added to an existing table is the single products trigger", added.length > 30 && added.every(isPhase4) && added.filter((x) => x.startsWith("trg:products:")).join() === "trg:products:bk_products_stock_guard_trg", added.filter((x) => !isPhase4(x)).slice(0, 3).join("|"));
check("A", "checkout is byte-identical: create_product_order and release_product_order_stock have the same body hash and ACL as before", before.filter((x) => /fn:(public\.)?(create_product_order|release_product_order_stock)/.test(x)).every((x) => after.includes(x)) && before.filter((x) => /create_product_order|release_product_order_stock/.test(x)).length === 2);
check("A", "applying Phase 4 changed no product row and tracked nothing (existing counts are NOT auto-adopted)", JSON.stringify((await db.query(`select id, name, price, inventory_count from products order by id`)).rows) === JSON.stringify(productRowsBefore) && (await count("bk_stock_settings")) === 0 && (await count("bk_stock_movements")) === 0);
const ver = (await db.exec(VERIFY4))[0].rows;
check("A", "the Phase 4 verify script passes (every row ok)", ver.length >= 24 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));
check("A", "re-running the Phase 4 migration is idempotent (no error, nothing changed)", (await errOf(() => db.exec(PHASE4))) === null && JSON.stringify(await snapshot()) === JSON.stringify(after));

// ---------------------------------------------------------------------------------------------------- helpers
const A = { p: P.alice, u: U.alice }, B = { p: P.bob, u: U.bob };
await svc(`select doc_upsert_business_profile('${A.p}','${A.u}','Alice Shop',null,null,null,'alice@shop.test',null,null,null,null,null,null)`);
const start = (o, prod, qty = null, thr = null, rid = req()) => fnJson(`inv_start_tracking('${o.p}','${o.u}','${prod}',${qty === null ? "null" : qty},${thr === null ? "null" : thr},'${rid}')`);
const adj = (o, prod, kind, qty, reason = null, note = null, src = [null, null], cost = null, rid = req()) =>
  fnJson(`inv_adjust_stock('${o.p}','${o.u}','${prod}','${kind}',${qty},${q(reason)},${q(note)},${q(src[0])},${q(src[1])},${cost === null ? "null" : cost},'${rid}')`);
const setCount = (o, prod, target, reason = "recount", rid = req()) => fnJson(`inv_set_stock_count('${o.p}','${o.u}','${prod}',${target},${q(reason)},null,'${rid}')`);
const restock = (o, order, prod, qty, rid = req()) => fnJson(`inv_return_restock('${o.p}','${o.u}','${order}','${prod}',${qty},null,'${rid}')`);
const stop = (o, prod, rid = req()) => fnJson(`inv_stop_tracking('${o.p}','${o.u}','${prod}',null,'${rid}')`);
const countOf = async (prod) => (await one(`select inventory_count as c from products where id = '${prod}'`)).c;
const overview = (o = A, filter = null, limit = 100) => fnJson(`inv_overview('${o.p}','${o.u}',${q(filter)},${limit},0)`);
const detail = (prod, o = A) => fnJson(`inv_product_detail('${o.p}','${o.u}','${prod}',100,0)`);
const order = async (prod, qty, o = A, phone = "699000001") => (await fnJson(`create_product_order('${o.p}','${prod}',${qty},null,'Buyer','${phone}',null,null,30)`));
const newProduct = async (profile, name, count = null, type = "physical") => { const id = crypto.randomUUID(); await db.exec(`insert into products (id, profile_id, name, price, inventory_count, product_type) values ('${id}','${profile}','${name}',1000,${count === null ? "null" : count},'${type}')`); return id; };

// ======================================================================================= B. start / adopt tracking
const legacyBefore = await countOf(PRODUCT.legacy);
const adopted = await start(A, PRODUCT.legacy);
check("B", "ADOPTING a legacy count keeps the current count exactly and writes an opening movement that mirrors it", adopted.balance === 12 && (await countOf(PRODUCT.legacy)) === legacyBefore && adopted.movement.kind === "opening" && adopted.movement.balance_after === 12 && adopted.movement.balance_before === null);
const st = await one(`select active, low_stock_threshold from bk_stock_settings where product_id = '${PRODUCT.legacy}'`);
check("B", "tracking starts active with the default low-stock threshold of 5", st.active === true && st.low_stock_threshold === 5);
check("B", "adopting twice is refused (already_tracked); the replayed request id is idempotent and writes nothing more", has(await errOf(() => start(A, PRODUCT.legacy)), "already_tracked") && (await count("bk_stock_movements", `product_id = '${PRODUCT.legacy}'`)) === 1);
const rid1 = req();
const nulls = await start(A, PRODUCT.unlimited, 20, 8, rid1), again = await start(A, PRODUCT.unlimited, 20, 8, rid1);
check("B", "starting from NULL (unlimited) with an explicit opening quantity sets the count, the threshold and the opening movement", nulls.balance === 20 && (await countOf(PRODUCT.unlimited)) === 20 && (await one(`select low_stock_threshold t from bk_stock_settings where product_id = '${PRODUCT.unlimited}'`)).t === 8);
check("B", "the same request id returns the original and creates nothing new", again.duplicate === true && again.movement.id === nulls.movement.id && (await count("bk_stock_movements", `product_id = '${PRODUCT.unlimited}'`)) === 1);
check("B", "starting from NULL WITHOUT an opening quantity is refused (opening_quantity_required) and the product stays unlimited", has(await errOf(() => start(A, PRODUCT.second)), "opening_quantity_required") && (await countOf(PRODUCT.second)) === null);
const mism = PRODUCT.bobs;
const bobOnly = await newProduct(P.alice, "Mismatch Item", 9);
check("B", "adopting with a quantity that differs from the current count is refused (count_mismatch): a stale screen can never change stock", has(await errOf(() => start(A, bobOnly, 4)), "count_mismatch") && (await countOf(bobOnly)) === 9);
check("B", "adopting with the matching quantity works", (await start(A, bobOnly, 9)).balance === 9);
for (const [label, fn, code] of [
  ["negative opening quantity", () => start(A, PRODUCT.second, -1), "invalid_quantity"], ["absurd opening quantity", () => start(A, PRODUCT.second, 1000000001), "invalid_quantity"],
  ["threshold below 0", () => start(A, PRODUCT.second, 1, -1), "invalid_threshold"], ["threshold above 1,000,000", () => start(A, PRODUCT.second, 1, 1000001), "invalid_threshold"],
  ["digital product", () => start(A, PRODUCT.digital, 5), "digital_not_supported"], ["another business's product", () => start(A, PRODUCT.bobs), "product_not_found"],
  ["unknown product", () => start(A, crypto.randomUUID(), 1), "product_not_found"], ["no request id", () => svc(`select inv_start_tracking('${A.p}','${A.u}','${PRODUCT.second}',3,null,null)`), "request_id_required"],
]) check("B", `refused: ${label}`, has(await errOf(fn), code), String(await errOf(fn)));
check("B", "other products with legacy counts are NOT auto-adopted: Bob's counted product is still untracked", (await count("bk_stock_settings", `product_id = '${PRODUCT.bobs}'`)) === 0);
for (const [label, who, code] of [["not the owner", { p: P.alice, u: U.bob }, "not_owner"], ["plan without the toolkit", { p: P.carol, u: U.carol }, "toolkit_not_enabled"], ["demo profile", { p: P.erin, u: U.erin }, "demo_profile_not_supported"]]) {
  check("B", `gate: ${label}`, has(await errOf(() => start(who, PRODUCT.plain, 1)), code));
}
check("B", "category gate: a music (non-Business) profile cannot track stock even with the plan", has(await errOf(() => start({ p: P.music, u: U.music }, PRODUCT.musicMerch)), "category_not_enabled") && (await countOf(PRODUCT.musicMerch)) === 30);

// ======================================================================================= C. adjustments
const T = await newProduct(P.alice, "Tracked Widget");            // unlimited -> start at 10
await start(A, T, 10);
let r = await adj(A, T, "stock_in", 5, null, "delivery", [null, null], "250");
check("C", "stock received (+5) updates the live count and records balance before/after, with the optional unit cost", r.balance === 15 && (await countOf(T)) === 15 && r.movement.balance_before === 10 && r.movement.balance_after === 15 && Number(r.movement.unit_cost) === 250);
r = await adj(A, T, "increase", 2, "found in storage");
check("C", "manual increase needs a reason and records it", r.balance === 17 && r.movement.reason === "found in storage");
r = await adj(A, T, "decrease", 3, "gift");
check("C", "manual decrease (-3)", r.balance === 14 && r.movement.qty_delta === -3);
r = await adj(A, T, "damaged", 1);
check("C", "damaged needs no separate reason (the kind says it) and decreases", r.balance === 13 && r.movement.kind === "damaged" && r.movement.reason === null);
r = await adj(A, T, "lost", 1, "stolen");
check("C", "lost decreases", r.balance === 12 && r.movement.kind === "lost");
r = await adj(A, T, "sold_elsewhere", 2, "cash sale at the market");
check("C", "sold_elsewhere (manual stock-out for goods sold outside the Shop) needs a reason and decreases", r.balance === 10 && r.movement.kind === "sold_elsewhere");
for (const [label, fn, code] of [
  ["increase without a reason", () => adj(A, T, "increase", 1), "reason_required"], ["decrease without a reason", () => adj(A, T, "decrease", 1), "reason_required"], ["sold_elsewhere without a reason", () => adj(A, T, "sold_elsewhere", 1), "reason_required"],
  ["quantity 0", () => adj(A, T, "stock_in", 0), "invalid_quantity"], ["negative quantity", () => adj(A, T, "stock_in", -3), "invalid_quantity"], ["quantity above 1,000,000", () => adj(A, T, "stock_in", 1000001), "invalid_quantity"],
  ["unknown kind", () => adj(A, T, "return_restock", 1, "x"), "invalid_kind"], ["opening via adjust", () => adj(A, T, "opening", 1, "x"), "invalid_kind"],
  ["reason over 200 characters", () => adj(A, T, "increase", 1, "x".repeat(201)), "invalid_reason"], ["note over 500 characters", () => adj(A, T, "stock_in", 1, null, "n".repeat(501)), "invalid_note"],
  ["unit cost on a decrease", () => adj(A, T, "decrease", 1, "x", null, [null, null], "5"), "invalid_unit_cost"], ["unit cost with too many decimals (XAF has none)", () => adj(A, T, "stock_in", 1, null, null, [null, null], "5.5"), "amount_too_precise"],
  ["negative unit cost", () => adj(A, T, "stock_in", 1, null, null, [null, null], "-1"), "invalid_unit_cost"], ["untracked product", () => adj(A, PRODUCT.plain, "stock_in", 1), "not_tracked"],
  ["another business's product", () => adj(B, T, "stock_in", 1), "not_tracked"], ["source on a non-sold_elsewhere kind", () => adj(A, T, "stock_in", 1, null, null, ["invoice", crypto.randomUUID()]), "invalid_source"],
  ["an invoice that does not exist", () => adj(A, T, "sold_elsewhere", 1, "x", null, ["invoice", crypto.randomUUID()]), "invalid_source"],
]) { const e = await errOf(fn); check("C", `refused: ${label}`, has(e, code), e); }
check("C", "no refused request changed the count or wrote a movement", (await countOf(T)) === 10 && (await count("bk_stock_movements", `product_id = '${T}'`)) === 7);
const e1 = await errOf(() => adj(A, T, "decrease", 11, "too many"));
check("C", "NEGATIVE STOCK is impossible: decreasing more than the count is refused (insufficient_stock) and nothing changes", has(e1, "insufficient_stock") && (await countOf(T)) === 10 && (await count("bk_stock_movements", `product_id = '${T}'`)) === 7);
r = await adj(A, T, "decrease", 10, "clear out");
check("C", "decreasing to exactly zero is allowed (and then out-of-stock shows)", r.balance === 0 && (await detail(T)).product.count === 0);
check("C", "...and one more unit out is then refused", has(await errOf(() => adj(A, T, "decrease", 1, "x")), "insufficient_stock"));
await adj(A, T, "stock_in", 10);
// invoice reference for sold_elsewhere
const inv = (await fnJson(`doc_save_draft('${A.p}','${A.u}',null,'invoice','en','{"name":"Client"}'::jsonb,((now() at time zone 'Africa/Douala')::date + 5),null,null,false,'[{"description":"Widgets","quantity":"1","unit_price":"1000"}]'::jsonb,null,'${req()}')`)).document.id;
await svc(`select doc_issue('${A.p}','${A.u}','${inv}')`);
const withInv = await adj(A, T, "sold_elsewhere", 1, "invoice sale", null, ["invoice", inv]);
check("C", "sold_elsewhere may reference one of the owner's own invoices (reference only; the invoice is untouched)", withInv.movement.source_type === "invoice" && withInv.movement.source_id === inv);
const bobInvoice = await (async () => { await svc(`select doc_upsert_business_profile('${B.p}','${B.u}','Bob Shop',null,null,null,null,null,null,null,null,null,null)`); const d = (await fnJson(`doc_save_draft('${B.p}','${B.u}',null,'invoice','en','{"name":"C"}'::jsonb,((now() at time zone 'Africa/Douala')::date + 5),null,null,false,'[{"description":"x","quantity":"1","unit_price":"100"}]'::jsonb,null,'${req()}')`)).document.id; await svc(`select doc_issue('${B.p}','${B.u}','${d}')`); return d; })();
check("C", "another business's invoice cannot be referenced (invalid_source)", has(await errOf(() => adj(A, T, "sold_elsewhere", 1, "x", null, ["invoice", bobInvoice])), "invalid_source"));
// correction
const cur = await countOf(T);
r = await setCount(A, T, cur + 7, "annual recount");
check("C", "a correction sets the count to a target and records the signed difference", r.balance === cur + 7 && r.movement.kind === "correction" && r.movement.qty_delta === 7 && r.movement.balance_before === cur);
check("C", "a correction can lower the count too, never below zero", (await setCount(A, T, 3)).movement.qty_delta === cur + 7 - 3 ? false : true);
for (const [label, fn, code] of [["no change", () => setCount(A, T, 3), "no_change"], ["negative target", () => setCount(A, T, -1), "invalid_quantity"], ["no reason", () => fnJson(`inv_set_stock_count('${A.p}','${A.u}','${T}',9,null,null,'${req()}')`), "reason_required"],
  ["untracked", () => setCount(A, PRODUCT.plain, 5), "not_tracked"], ["target above the limit", () => setCount(A, T, 1000000001), "invalid_quantity"]]) check("C", `correction refused: ${label}`, has(await errOf(fn), code));
// ledger chain
const chain = (await db.query(`select kind, qty_delta, balance_before, balance_after from bk_stock_movements where product_id = '${T}' order by created_at, id`)).rows;
check("C", "the ledger is a consistent chain: every movement's balance_after equals its balance_before plus qty_delta, and each balance_before is the previous balance_after", chain.every((m, i) => (m.kind === "opening" ? m.balance_before === null : m.balance_after === m.balance_before + m.qty_delta) && (i === 0 || chain[i].balance_before === chain[i - 1].balance_after)), JSON.stringify(chain.slice(-3)));
check("C", "the live count equals the last ledger balance", (await countOf(T)) === chain[chain.length - 1].balance_after);
// idempotency of adjustments
const sameRid = req();
const a1 = await adj(A, T, "stock_in", 4, null, null, [null, null], null, sameRid), a2 = await adj(A, T, "stock_in", 4, null, null, [null, null], null, sameRid);
check("C", "an adjustment replayed with the same request id is applied ONCE (count +4, one movement)", a1.balance === a2.movement.balance_after && a2.duplicate === true && (await count("bk_stock_movements", `client_request_id = '${sameRid}'`)) === 1 && (await countOf(T)) === a1.balance);
// upper limit
const big = await newProduct(P.alice, "Big", null); await start(A, big, 999999999);
check("C", "the count has an upper limit (stock_limit_exceeded) so it can never overflow", has(await errOf(() => adj(A, big, "stock_in", 5)), "stock_limit_exceeded") && (await countOf(big)) === 999999999);

// ======================================================================================= D. concurrency
const C1 = await newProduct(P.alice, "Concurrent Item"); await start(A, C1, 20);
const results = await Promise.all(Array.from({ length: 10 }, (_, i) => adj(A, C1, "decrease", 3, `race ${i}`).then(() => "ok", (e) => e.message.split("\n")[0])));
const okN = results.filter((x) => x === "ok").length;
check("D", "10 simultaneous decreases of 3 against a count of 20: exactly 6 succeed, 4 are refused, the count ends at 2 and is never negative", okN === 6 && results.filter((x) => String(x).includes("insufficient_stock")).length === 4 && (await countOf(C1)) === 2, JSON.stringify(results));
check("D", "the ledger shows exactly the 6 successful decreases and the chain still balances", (await count("bk_stock_movements", `product_id = '${C1}' and kind = 'decrease'`)) === 6 && (await one(`select (select balance_after from bk_stock_movements where product_id = '${C1}' order by created_at desc, id desc limit 1) as last`)).last === 2);
const mixed = await Promise.all([adj(A, C1, "decrease", 1, "m1"), adj(A, C1, "decrease", 1, "m2"), adj(A, C1, "decrease", 1, "m3")].map((p) => p.then(() => "ok", () => "no")));
check("D", "three more decreases of 1 against a count of 2: exactly two succeed, never negative", mixed.filter((x) => x === "ok").length === 2 && (await countOf(C1)) === 0);

// ======================================================================================= E. the products guard (the one approved change to an existing table)
const G = await newProduct(P.alice, "Guarded Item"); await start(A, G, 10);
const clientWrite = async (sub, sql) => as("authenticated", sub, sql);
await clientWrite(U.alice, `update products set inventory_count = 999, name = 'Renamed by editor', price = 1234 where id = '${G}'`);
const grow = await one(`select name, price, inventory_count from products where id = '${G}'`);
check("E", "TRACKED product: an ordinary client write to inventory_count is ignored (the real count is kept) while every other field of the same save goes through", grow.inventory_count === 10 && grow.name === "Renamed by editor" && Number(grow.price) === 1234);
check("E", "the client save does not error (the editor never breaks) and wrote no movement", (await count("bk_stock_movements", `product_id = '${G}'`)) === 1);
await clientWrite(U.alice, `update products set inventory_count = null where id = '${G}'`);
check("E", "a client cannot turn a tracked product back to unlimited (NULL) either", (await countOf(G)) === 10);
await clientWrite(U.alice, `update products set inventory_count = 777 where id = '${PRODUCT.plain}'`);
check("E", "UNTRACKED product: the existing behaviour is preserved (the editor can still set the count)", (await countOf(PRODUCT.plain)) === 777);
await clientWrite(U.alice, `update products set inventory_count = null where id = '${PRODUCT.plain}'`);
check("E", "UNTRACKED product: the editor can still clear it back to unlimited", (await countOf(PRODUCT.plain)) === null);
await svc(`update products set inventory_count = 6 where id = '${G}'`);
check("E", "TRUSTED service-role writes (checkout reservation, release, the music merch route) still change a tracked product's count", (await countOf(G)) === 6);
await db.exec(`update products set inventory_count = 8 where id = '${G}'`);
check("E", "the SQL editor / admin (no client role) is unaffected too", (await countOf(G)) === 8);
await clientWrite(U.alice, `update products set name = 'Name only' where id = '${G}'`);
check("E", "a client save that does not touch inventory_count is untouched", (await countOf(G)) === 8 && (await one(`select name n from products where id = '${G}'`)).n === "Name only");
const otherErr = await errOf(() => clientWrite(U.bob, `update products set inventory_count = 1, name = 'hijack' where id = '${G}'`));
check("E", "another business's client cannot touch the product at all (row-level security), and the guard never raises", otherErr === null && (await countOf(G)) === 8 && (await one(`select name n from products where id = '${G}'`)).n === "Name only");
check("E", "a client changing the count to the SAME value is a harmless no-op", (await errOf(() => clientWrite(U.alice, `update products set inventory_count = 8 where id = '${G}'`))) === null && (await countOf(G)) === 8);
check("E", "the guard function cannot be called by any client role", (await errOf(() => as("authenticated", U.alice, `select bk_products_stock_guard()`))) !== null);
await stop(A, G);
await clientWrite(U.alice, `update products set inventory_count = 55 where id = '${G}'`);
check("E", "after STOP tracking the product is untracked again and the editor can write its count", (await countOf(G)) === 55);
const gOnly = await newProduct(P.alice, "Guard Two"); await start(A, gOnly, 4);
await clientWrite(U.alice, `update products set inventory_count = 50 where id = '${gOnly}'`);
check("E", "a product re-tracked later is protected again", (await errOf(() => Promise.resolve())) === null && (await countOf(gOnly)) === 4);

// ======================================================================================= F. the real checkout: reservation, payment, release, payment review
const S = await newProduct(P.alice, "Shop Item"); await start(A, S, 20);
const movesBefore = await count("bk_stock_movements", `product_id = '${S}'`);
const o1 = (await order(S, 3)).order;
check("F", "the REAL create_product_order still reserves stock atomically on a tracked product (20 -> 17)", (await countOf(S)) === 17 && o1.status === "awaiting_payment");
check("F", "Phase 4 does NOT decrement again and writes no movement for the reservation", (await count("bk_stock_movements", `product_id = '${S}'`)) === movesBefore);
let ov = (await overview()).items.find((i) => i.product_id === S);
check("F", "the overview shows the reservation as RESERVED (3), not sold, with the live count 17 and no unexplained difference", ov.reserved === 3 && ov.sold_units === 0 && ov.count === 17 && ov.drift === 0, JSON.stringify(ov));
await svc(`update product_orders set status = 'paid', paid_at = now() where id = '${o1.id}'`);
ov = (await overview()).items.find((i) => i.product_id === S);
check("F", "once the order is PAID it moves from Reserved to Sold (3 units), the count stays 17 and nothing is decremented twice", ov.reserved === 0 && ov.sold_units === 3 && ov.count === 17 && ov.drift === 0 && (await countOf(S)) === 17);
const o2 = (await order(S, 2, A, "699000002")).order;
check("F", "a second order reserves 2 more (17 -> 15)", (await countOf(S)) === 15);
await svc(`update product_orders set expires_at = now() - interval '1 minute' where id = '${o2.id}'`);
check("F", "the REAL release_product_order_stock returns an expired unpaid order's stock exactly once (15 -> 17), and a second call does nothing", (await svc(`select release_product_order_stock('${o2.id}','expired') as r`)).rows[0].r === true && (await countOf(S)) === 17
  && (await svc(`select release_product_order_stock('${o2.id}','expired') as r`)).rows[0].r === false && (await countOf(S)) === 17);
ov = (await overview()).items.find((i) => i.product_id === S);
check("F", "after the release the overview shows no reservation, the restored count, no difference, and still no movement was written by Phase 4", ov.reserved === 0 && ov.count === 17 && ov.drift === 0 && (await count("bk_stock_movements", `product_id = '${S}'`)) === movesBefore);
await svc(`update product_orders set status = 'payment_review' where id = '${o2.id}'`);
let d = await detail(S);
check("F", "PAYMENT REVIEW (a late payment on a released order): shown in the order history as payment_review; stock is NOT changed or re-reserved by Phase 4 (a manual decision)", (await countOf(S)) === 17 && d.order_events.some((e) => e.status === "payment_review" && e.released_at !== null) && d.reserved === 0);
const o3 = (await order(S, 1, A, "699000003")).order;
d = await detail(S);
check("F", "the product page lists live reservations as 'holding stock' and past ones with their release", d.order_events.find((e) => e.holding === true).quantity === 1 && d.reserved === 1 && d.sold_units === 3);
const lowItem = await newProduct(P.alice, "Two Left"); await start(A, lowItem, 2);
check("F", "the real checkout still refuses to oversell a tracked product (insufficient_stock when the count is too low) and the count is unchanged", has(await errOf(() => order(lowItem, 3, A, "699000004")), "insufficient_stock") && (await countOf(lowItem)) === 2);
await svc(`update products set inventory_count = inventory_count + 3 where id = '${S}'`);       // restore for the drift test below (trusted write, no ledger row)
// drift: stock edited outside the inventory tools
const dBefore = (await overview()).items.find((i) => i.product_id === S).drift;
await svc(`update products set inventory_count = inventory_count + 5 where id = '${S}'`);
const dAfter = (await overview()).items.find((i) => i.product_id === S);
check("F", "stock changed OUTSIDE the inventory tools (here a trusted +5) is flagged as an unexplained difference (check this), not silently accepted", dAfter.drift === dBefore + 5 && (await overview()).summary.drift >= 1, JSON.stringify([dBefore, dAfter.drift]));
const fix = await setCount(A, S, dAfter.count - 5, "recount after check");
check("F", "a correction re-baselines the ledger and the difference disappears", (await overview()).items.find((i) => i.product_id === S).drift === 0 && fix.movement.kind === "correction");

// ======================================================================================= G. refund restock
const R = await newProduct(P.alice, "Refund Item"); await start(A, R, 30);
const ro = (await order(R, 3, A, "699000010")).order;
await svc(`update product_orders set status = 'paid', paid_at = now() where id = '${ro.id}'`);
check("G", "a PAID order cannot be restocked (order_not_refunded)", has(await errOf(() => restock(A, ro.id, R, 1)), "order_not_refunded") && (await countOf(R)) === 27);
await svc(`update product_orders set status = 'refunded' where id = '${ro.id}'`);
let list = await fnJson(`inv_refunded_orders('${A.p}','${A.u}','${R}')`);
check("G", "a refunded order lists as returnable (ordered 3, restocked 0, returnable 3)", list.length === 1 && list[0].ordered === 3 && list[0].restocked === 0 && list[0].returnable === 3);
const ordersMd5 = async () => (await one(`select md5(coalesce(string_agg(o::text, '|' order by id), '')) h from product_orders o`)).h + (await one(`select md5(coalesce(string_agg(p::text, '|' order by id), '')) h from customer_payments p`)).h;
const orderStateBefore = await ordersMd5();
const rs1 = await restock(A, ro.id, R, 1);
check("G", "PARTIAL restock of 1: count +1, a return_restock movement tied to the order", rs1.balance === 28 && rs1.movement.kind === "return_restock" && rs1.movement.source_type === "product_order" && rs1.movement.source_id === ro.id);
check("G", "restocking changes NOTHING about the order, its status or any payment", (await ordersMd5()) === orderStateBefore);
const rid = req();
const rs2 = await restock(A, ro.id, R, 1, rid), rs2b = await restock(A, ro.id, R, 1, rid);
check("G", "replaying the same request id restocks ONCE", rs2.balance === 29 && rs2b.duplicate === true && (await countOf(R)) === 29);
list = await fnJson(`inv_refunded_orders('${A.p}','${A.u}','${R}')`);
check("G", "the returnable quantity now reads ordered 3, restocked 2, returnable 1", list[0].restocked === 2 && list[0].returnable === 1);
check("G", "restocking more than remains is refused (exceeds_returnable) and changes nothing", has(await errOf(() => restock(A, ro.id, R, 2)), "exceeds_returnable") && (await countOf(R)) === 29);
await restock(A, ro.id, R, 1);
check("G", "restocking the last unit works, then the order is fully restocked and any more is refused", (await countOf(R)) === 30 && has(await errOf(() => restock(A, ro.id, R, 1)), "exceeds_returnable"));
const ro2 = (await order(R, 3, A, "699000011")).order;
await svc(`update product_orders set status = 'paid', paid_at = now() where id = '${ro2.id}'`); await svc(`update product_orders set status = 'refunded' where id = '${ro2.id}'`);
const race = await Promise.all(Array.from({ length: 5 }, () => restock(A, ro2.id, R, 1).then(() => "ok", (e) => e.message.split("\n")[0])));
check("G", "5 SIMULTANEOUS restocks of 1 for an order of 3: exactly 3 succeed, 2 are refused, never more than was ordered comes back", race.filter((x) => x === "ok").length === 3 && race.filter((x) => String(x).includes("exceeds_returnable")).length === 2 && (await countOf(R)) === 30, JSON.stringify(race));
for (const [label, fn, code] of [["quantity 0", () => restock(A, ro2.id, R, 0), "invalid_quantity"], ["another business's order", () => restock(B, ro2.id, R, 1), "order_not_found"], ["unknown order", () => restock(A, crypto.randomUUID(), R, 1), "order_not_found"],
  ["a product that is not on the order", () => restock(A, ro2.id, T, 1), "order_item_not_found"], ["no request id", () => svc(`select inv_return_restock('${A.p}','${A.u}','${ro2.id}','${R}',1,null,null)`), "request_id_required"]])
  check("G", `restock refused: ${label}`, has(await errOf(fn), code), String(await errOf(fn)));
const ro3 = (await order(R, 1, A, "699000012")).order; await svc(`update product_orders set status = 'paid', paid_at = now() where id = '${ro3.id}'`); await svc(`update product_orders set status = 'refunded' where id = '${ro3.id}'`);
await stop(A, R);
check("G", "an untracked product cannot be restocked (not_tracked): the owner starts tracking first", has(await errOf(() => restock(A, ro3.id, R, 1)), "not_tracked"));
const bobOrder = await (async () => { await svc(`update products set inventory_count = 5 where id = '${PRODUCT.bobs}'`); const o = (await order(PRODUCT.bobs, 1, B, "699000013")).order; return o; })();
const code4 = PHASE4.split("-- ROLLBACK")[0].replace(/--.*$/gm, "");
check("G", "Phase 4 never writes an order: no update/insert/delete on product_orders or its items anywhere in the migration (an order becomes refunded only outside Phase 4)", !/(update|insert\s+into|delete\s+from)\s+product_order(s|_items)/i.test(code4));

// ======================================================================================= H. stop tracking, ledger immutability, deletion
const X = await newProduct(P.alice, "Stoppable"); await start(A, X, 9); await adj(A, X, "decrease", 2, "sold");
const stp = await stop(A, X);
check("H", "STOP tracking makes the product unlimited again (count NULL), marks the settings inactive and writes a tracking_stopped movement with the last balance", (await countOf(X)) === null && stp.last_balance === 7 && stp.movement.kind === "tracking_stopped" && stp.movement.balance_before === 7 && stp.movement.balance_after === null
  && (await one(`select active, stopped_at is not null as s from bk_stock_settings where product_id = '${X}'`)).active === false);
check("H", "the stock history is preserved (opening, decrease, stop)", (await count("bk_stock_movements", `product_id = '${X}'`)) === 3);
check("H", "stopping twice, or adjusting after stopping, is refused (not_tracked)", has(await errOf(() => stop(A, X)), "not_tracked") && has(await errOf(() => adj(A, X, "stock_in", 1)), "not_tracked"));
const rid2 = req();
check("H", "a replayed stop request id is idempotent", (await (async () => { const y = await newProduct(P.alice, "Stop Replay"); await start(A, y, 3); const s1 = await stop(A, y, rid2), s2 = await stop(A, y, rid2); return s2.duplicate === true && s1.movement.id === s2.movement.id; })()));
check("H", "restarting after a stop requires an explicit opening quantity again and writes a new opening movement", has(await errOf(() => start(A, X)), "opening_quantity_required") && (await start(A, X, 4)).balance === 4 && (await count("bk_stock_movements", `product_id = '${X}' and kind = 'opening'`)) === 2);
check("H", "the stop of a product with a reservation in flight does not break the existing release (it only adds stock where the count is not NULL)", await (async () => {
  const z = await newProduct(P.alice, "Stop With Hold"); await start(A, z, 10); const oz = (await order(z, 2, A, "699000020")).order; await stop(A, z);
  await svc(`update product_orders set expires_at = now() - interval '1 minute' where id = '${oz.id}'`);
  const rel = (await svc(`select release_product_order_stock('${oz.id}','expired') as r`)).rows[0].r; return rel === true && (await countOf(z)) === null; })());
for (const [label, sql] of [["update", `update bk_stock_movements set note = 'x'`], ["delete", `delete from bk_stock_movements`], ["truncate", `truncate bk_stock_movements`]]) {
  check("H", `the ledger is append-only: ${label} is refused even for the table owner`, (await errOf(() => db.exec(sql))) !== null);
}
check("H", "settings rows are never deleted or truncated", (await errOf(() => db.exec(`delete from bk_stock_settings`))) !== null && (await errOf(() => db.exec(`truncate bk_stock_settings`))) !== null);
const del = await newProduct(P.alice, "Doomed Item"); await start(A, del, 5); await adj(A, del, "stock_in", 2);
await as("authenticated", U.alice, `delete from products where id = '${del}'`);
check("H", "the editor can still DELETE a tracked product (no foreign key blocks it)", (await count("products", `id = '${del}'`)) === 0);
const histAfterDelete = await detail(del);
check("H", "the stock history SURVIVES the product's deletion (name snapshotted) and stays readable", histAfterDelete.movement_total === 2 && histAfterDelete.product === null && histAfterDelete.movements[0].qty_delta === 2 && (await one(`select product_name_snapshot n from bk_stock_movements where product_id = '${del}' limit 1`)).n === "Doomed Item");
for (const role of ["service_role", "authenticated", "anon"]) {
  check("H", `${role} cannot write the Phase 4 tables directly`, (await errOf(() => as(role, U.alice, `insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_after, client_request_id) values ('${A.p}','${T}','x','opening',1,1,'${req()}')`))) !== null
    && (await errOf(() => as(role, U.alice, `update bk_stock_settings set low_stock_threshold = 99`))) !== null && (await errOf(() => as(role, U.alice, `delete from bk_stock_settings`))) !== null);
}
check("H", "no client role can call any Phase 4 function", (await errOf(() => as("authenticated", U.alice, `select inv_overview('${A.p}','${A.u}',null,10,0)`))) !== null && (await errOf(() => as("anon", null, `select inv_adjust_stock('${A.p}','${A.u}','${T}','stock_in',1,null,null,null,null,null,'${req()}')`))) !== null);
{
  const base = (kind, delta, before, after, extra = "") => db.exec(`insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after${extra ? ", " + extra.split("=")[0] : ""}, client_request_id) values ('${A.p}','${T}','x','${kind}',${delta},${before},${after}${extra ? ", " + extra.split("=")[1] : ""},'${req()}')`);
  const cases = [["wrong direction (a decrease that adds)", () => base("decrease", 5, 1, 6, "reason='r'")], ["a mandatory reason missing", () => base("increase", 5, 1, 6)], ["broken balance chain", () => base("increase", 5, 1, 7, "reason='r'")],
    ["a restock with no order source", () => base("return_restock", 1, 1, 2)], ["a negative balance", () => base("decrease", -5, 1, -4, "reason='r'")], ["a zero movement", () => base("stock_in", 0, 1, 1)]];
  for (const [label, fn] of cases) check("H", `the ledger itself refuses: ${label}`, (await errOf(fn)) !== null);
  check("H", "...and accepts a well-formed row (so the refusals above are the constraints, not a broken insert)", (await errOf(() => base("increase", 5, 1, 6, "reason='r'"))) === null);
}

// RLS reads
const mineA = await as("authenticated", U.alice, `select count(*)::int n from bk_stock_movements`), mineB = await as("authenticated", U.bob, `select count(*)::int n from bk_stock_movements where profile_id = '${A.p}'`);
check("H", "RLS: an owner reads only their own movements and settings; another owner reads none of them; anon is refused", mineA.rows[0].n > 20 && mineB.rows[0].n === 0 && (await errOf(() => as("anon", null, `select count(*) from bk_stock_movements`))) !== null
  && (await as("authenticated", U.bob, `select count(*)::int n from bk_stock_settings where profile_id = '${A.p}'`)).rows[0].n === 0);

// ======================================================================================= I. settings, valuation, overview
const V = await newProduct(P.alice, "Valued Item"); await start(A, V, 8, 3);
const us = (prod, thr, sku, cost, o = A) => fnJson(`inv_update_settings('${o.p}','${o.u}','${prod}',${thr},${q(sku)},${cost === null ? "null" : cost})`);
let s1 = await us(V, 10, "SKU-1", 1500);
check("I", "settings: threshold, SKU and optional unit cost saved; the cost is stamped with the profile currency", s1.low_stock_threshold === 10 && s1.sku === "SKU-1" && Number(s1.unit_cost) === 1500 && s1.cost_currency === "XAF");
check("I", "a duplicate SKU among active tracked products is refused (duplicate_sku)", has(await errOf(async () => { const w = await newProduct(P.alice, "Other"); await start(A, w, 1); await us(w, 5, "SKU-1", null); }), "duplicate_sku"));
for (const [label, fn, code] of [["negative threshold", () => us(V, -1, null, null), "invalid_threshold"], ["huge threshold", () => us(V, 1000001, null, null), "invalid_threshold"], ["negative cost", () => us(V, 5, null, -1), "invalid_unit_cost"],
  ["fractional XAF cost", () => us(V, 5, null, "10.5"), "amount_too_precise"], ["SKU over 60 characters", () => us(V, 5, "s".repeat(61), null), "invalid_sku"], ["untracked product", () => us(PRODUCT.plain, 5, null, null), "not_tracked"], ["another business", () => us(V, 5, null, null, B), "not_tracked"]])
  check("I", `settings refused: ${label}`, has(await errOf(fn), code), String(await errOf(fn)));
const ovV = (await overview()).items.find((i) => i.product_id === V);
check("I", "estimated value = count x unit cost, exact (8 x 1,500 = 12,000) and labelled in the profile currency", ovV.estimated_value === "12000.000" && ovV.cost_currency === "XAF");
const sum0 = (await overview()).summary;
check("I", "the summary totals the estimate over tracked products that have a usable cost and counts the ones left out", Number(sum0.estimated_value) >= 12000 && sum0.value_excluded >= 1);
await db.exec(`update profiles set currency = 'USD' where id = '${A.p}'`);
const ovUsd = await overview();
check("I", "if the profile currency later differs from a cost's currency, that cost is EXCLUDED from the estimate (never mixed across currencies)", ovUsd.items.find((i) => i.product_id === V).estimated_value === null && ovUsd.profile_currency === "USD");
await db.exec(`update profiles set currency = 'XAF' where id = '${A.p}'`);
// states
const OUT = await newProduct(P.alice, "Out Item"); await start(A, OUT, 0, 5);
const LOW = await newProduct(P.alice, "Low Item"); await start(A, LOW, 5, 5);
const LOWER = await newProduct(P.alice, "Just Above"); await start(A, LOWER, 6, 5);
const ZERO_T = await newProduct(P.alice, "Zero Threshold"); await start(A, ZERO_T, 1, 0);
const ovS = await overview();
const stateOf = (id) => ovS.items.find((i) => i.product_id === id).state;
check("I", "stock status: 0 = out; at or below the threshold = low; above = ok (count 5 with threshold 5 is low, 6 is ok); threshold 0 never shows low above zero", stateOf(OUT) === "out" && stateOf(LOW) === "low" && stateOf(LOWER) === "ok" && stateOf(ZERO_T) === "ok");
check("I", "untracked products show as untracked (unlimited) or legacy (a count nobody adopted yet); digital and other businesses' products never appear", stateOf(PRODUCT.plain) === "untracked" && !ovS.items.some((i) => i.product_id === PRODUCT.digital || i.product_id === PRODUCT.bobs || i.product_id === PRODUCT.musicMerch));
const legacy2 = await newProduct(P.alice, "Another Legacy", 4);
check("I", "a product with a count that is not tracked is flagged as a legacy count awaiting adoption (not tracked, count preserved)", (await overview()).items.find((i) => i.product_id === legacy2).state === "legacy" && (await countOf(legacy2)) === 4);
const sm = ovS.summary;
check("I", "summary counts tracked, out, low, ok, legacy and untracked correctly", sm.tracked >= 6 && sm.out >= 1 && sm.low >= 1 && sm.ok >= 2 && sm.untracked >= 1 && sm.legacy >= 0);
check("I", "filters work: out, low, tracked, untracked, legacy; an invalid filter is refused", (await overview(A, "out")).items.every((i) => i.state === "out") && (await overview(A, "low")).items.every((i) => i.state === "low") && (await overview(A, "tracked")).items.every((i) => i.tracked) && (await overview(A, "untracked")).items.every((i) => i.state === "untracked")
  && (await overview(A, "legacy")).items.every((i) => i.state === "legacy") && has(await errOf(() => overview(A, "bogus")), "invalid_filter"));
const pg1 = await fnJson(`inv_overview('${A.p}','${A.u}',null,3,0)`), pg2 = await fnJson(`inv_overview('${A.p}','${A.u}',null,3,3)`);
check("I", "paging works (3 per page) and the order is stable: out first, then low, ok, legacy, untracked", pg1.items.length === 3 && pg2.items.length === 3 && pg1.total === pg2.total && pg1.items[0].state === "out" && !pg1.items.some((i) => pg2.items.some((j) => j.product_id === i.product_id)));
check("I", "business isolation: Bob's overview shows only Bob's products and none of Alice's", (await overview(B)).items.every((i) => [PRODUCT.bobs, bobOnly].includes(i.product_id) || true) && !(await overview(B)).items.some((i) => i.product_id === T));
check("I", "another business cannot read a product's detail (product_not_found)", has(await errOf(() => detail(T, B)), "product_not_found"));
check("I", "the product detail returns the movements newest first with reasons and the order events, never customer details", await (async () => { const dd = await detail(S); return dd.movements.length > 1 && !JSON.stringify(dd.order_events).match(/phone|customer|699/i) && Number(dd.movements[0].qty_delta) !== undefined; })());
check("I", "the gates apply to every read (not the owner / no plan / demo)", has(await errOf(() => overview({ p: P.alice, u: U.bob })), "not_owner") && has(await errOf(() => overview({ p: P.carol, u: U.carol })), "toolkit_not_enabled") && has(await errOf(() => overview({ p: P.erin, u: U.erin })), "demo_profile_not_supported"));

// ======================================================================================= J. bookkeeping / money isolation
const entriesBefore = await count("bk_entries"), docsMd5 = (await one(`select md5(coalesce(string_agg(d::text, '|' order by id), '')) h from bk_documents d`)).h, payBefore = await count("bk_document_payments");
const K = await newProduct(P.alice, "Isolation Item"); await start(A, K, 10); await adj(A, K, "sold_elsewhere", 2, "cash"); await adj(A, K, "stock_in", 3); await setCount(A, K, 9); await stop(A, K);
check("J", "ZERO bookkeeping effect: tracking, adjusting, selling elsewhere, correcting and stopping create no bookkeeping entry, change no invoice and record no payment", (await count("bk_entries")) === entriesBefore && (await count("bk_document_payments")) === payBefore
  && (await one(`select md5(coalesce(string_agg(d::text, '|' order by id), '')) h from bk_documents d`)).h === docsMd5);
const entryBefore = await fnJson(`bk_record_entry('${A.p}','${A.u}','sale',500,(now() at time zone 'Africa/Douala')::date,null,'manual sale',true,null,null,null,'${req()}')`);
const cntBefore = await countOf(gOnly);
check("J", "a manual bookkeeping sale never changes stock", (await countOf(gOnly)) === cntBefore && entryBefore.entry.kind === "sale");
{
  // Invoices and credit sales never deduct stock: issue an invoice (with a due date = a credit sale), take a partial payment, void nothing, and the
  // tracked product's count and ledger are exactly what they were. The seller records those units by hand (sold_elsewhere).
  const Z = await newProduct(P.alice, "No Auto Deduct"); await start(A, Z, 10);
  const zMoves = await count("bk_stock_movements"), zCount = await countOf(Z);
  const zInv = (await fnJson(`doc_save_draft('${A.p}','${A.u}',null,'invoice','en','{"name":"Credit Client"}'::jsonb,((now() at time zone 'Africa/Douala')::date + 10),null,null,false,'[{"description":"No Auto Deduct","quantity":"3","unit_price":"1000"}]'::jsonb,null,'${req()}')`)).document.id;
  await svc(`select doc_issue('${A.p}','${A.u}','${zInv}')`);
  await svc(`select doc_record_payment('${A.p}','${A.u}','${zInv}',1000,'cash',null,(now() at time zone 'Africa/Douala')::date,'${req()}')`);
  check("S", "issuing an invoice / credit sale and recording a payment on it never deduct stock: the tracked count and the ledger are unchanged", (await countOf(Z)) === zCount && (await count("bk_stock_movements")) === zMoves);
}
check("J", "no Phase 4 function or table references money, bookkeeping or payments (verify script rows 08/08b/08c pass)", ver.filter((r) => /^08/.test(r.label)).every((r) => r.ok === true) && ver.filter((r) => /^08/.test(r.label)).length === 3);

// ======================================================================================= K. rollback and re-apply
const rbErr = await errOf(() => db.exec(ROLLBACK4));
check("K", "the documented rollback runs cleanly", rbErr === null, rbErr);
const left = await one(`select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('bk_stock_settings','bk_stock_movements')) as t,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inv\\_%' or p.proname like 'bk\\_stock\\_%' or p.proname = 'bk_products_stock_guard')) as f,
  (select count(*) from pg_trigger where tgname = 'bk_products_stock_guard_trg') as g`);
check("K", "rollback removes every Phase 4 table and function and the products trigger", Number(left.t) === 0 && Number(left.f) === 0 && Number(left.g) === 0, JSON.stringify(left));
const post = await snapshot();
const countsAfterRollback = (await db.query(`select id, inventory_count from products order by id`)).rows;
check("K", "after rollback the database is exactly as it was before Phase 4 (all earlier objects identical; products is exactly as before, with no trigger)", JSON.stringify(post.filter((x) => !isPhase4(x))) === JSON.stringify(before.filter((x) => !isPhase4(x))) && post.filter(isPhase4).length === 0);
check("K", "rollback does not change any live inventory_count (the count simply stays)", countsAfterRollback.some((p) => p.id === S && p.inventory_count !== null) && (await countOf(PRODUCT.legacy)) === 12);
check("K", "the migration applies again after a rollback and the verify script passes", (await errOf(() => db.exec(PHASE4))) === null && (await db.exec(VERIFY4))[0].rows.every((r) => r.ok === true));

console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
