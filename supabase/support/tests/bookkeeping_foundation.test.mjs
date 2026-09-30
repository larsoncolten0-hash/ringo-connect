// Test for supabase/migrations/2026-12-01_bookkeeping_foundation.sql
//
// Runs entirely on a scratch, IN-MEMORY PostgreSQL (PGlite, a real PostgreSQL 17 engine compiled to WASM).
// It never connects to Supabase or any real database, and never reads .env.local.
//
// WHAT IS REAL: the migration, the preflight SQL and the documented rollback SQL are the ACTUAL repository files,
// executed by a real PostgreSQL engine; constraints, indexes, FKs, triggers, plpgsql functions, GRANT/REVOKE and
// RLS (via SET ROLE) are genuinely evaluated.
// WHAT IS A STAND-IN (PGlite is NOT Supabase; nothing below proves compatibility with the production schema):
//   * roles anon / authenticated / service_role are created here (service_role has BYPASSRLS, like Supabase);
//   * schema `auth` with auth.uid() reading the GUC request.jwt.claim.sub (Supabase derives it from the JWT);
//   * default privileges copied from Supabase's documented defaults: new public tables/functions are granted to
//     anon/authenticated/service_role and function EXECUTE to PUBLIC — so the migration's REVOKEs are really tested;
//   * public.users(id, email, role, plan_id), public.plans(id, name, display_name, price_xaf, team_enabled, ai_enabled, commerce_enabled), public.profiles(...) reduced to the columns the
//     migration touches; public.users has NO FK to auth.users (auth.users is not modelled);
//   * is_admin() and the real `users`/`profiles` RLS policies are copied from supabase/schema.sql;
//   * product_orders / orders / music_orders are reduced to (id, profile_id, + columns the tests use);
//   * the pooled PostgREST layer, JWT verification, Supabase's supabase_admin ownership/event triggers and every
//     other live object are NOT present. See the NOT VERIFIED list printed at the end.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json or the lockfile)
//   Run:    node supabase/support/tests/bookkeeping_foundation.test.mjs
//   MUT=open_read   breaks the owner read policy IN MEMORY ONLY (never on disk) to prove the RLS checks can fail.
//   MUT=no_owner    removes the owner check from bk_record_entry IN MEMORY ONLY.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const B = jiti(path.join(REPO, "src/lib/bookkeeping/summary.ts"));

let MIGRATION = read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql");
if (process.env.MUT === "open_read") MIGRATION = MIGRATION.replaceAll("using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()))", "using (true)");
if (process.env.MUT === "no_owner") MIGRATION = MIGRATION.replace("if p_actor_user_id is null or v_profile.user_id is distinct from p_actor_user_id then raise exception 'not_owner'; end if;", "");
const PREFLIGHT = read("supabase/support/2026-12-01_bookkeeping_foundation.preflight.sql");
const ROLLBACK = (() => {
  const lines = MIGRATION.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s{3}/, ""));
  return lines.join("\n");
})();

const results = [];
const check = (group, name, cond, detail = "") => {
  results.push({ group, name, pass: !!cond });
  if (!cond) console.log(`  FAIL [${group}]: ${name} | ${detail}`);
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), carol: UID(3), dave: UID(4), erin: UID(5), kim: UID(6), admin: UID(7), sam: UID(8) };
const P = { alice: PID(1), bob: PID(2), carol: PID(3), dave: PID(4), erin: PID(5), kim: PID(6) };
const PL = { free: 1, basic: 2, pro: 3, business_basic: 4, business_pro: 5, association_basic: 6 };

async function freshDb({ withProfiles = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    set timezone = 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to public;
    create table public.plans (id int primary key, name text not null unique, display_name text, price_xaf int not null default 0, team_enabled boolean not null default false, ai_enabled boolean not null default false, commerce_enabled boolean not null default true);
    create table public.users (id uuid primary key, email text not null, role text not null default 'creator', plan_id int references public.plans(id));
    create function public.is_admin() returns boolean language sql security definer set search_path = public as $$
      select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
    alter table public.users enable row level security;
    create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
    insert into public.plans (id, name) values (1,'free'),(2,'basic'),(3,'pro'),(4,'business_basic'),(5,'business_pro'),(6,'association_basic');
    insert into public.users (id, email, role, plan_id) values
      ('${U.alice}','a@x.test','creator',5), ('${U.bob}','b@x.test','creator',5), ('${U.carol}','c@x.test','creator',1),
      ('${U.dave}','d@x.test','creator',null), ('${U.erin}','e@x.test','creator',5), ('${U.kim}','k@x.test','creator',4),
      ('${U.admin}','ad@x.test','admin',5), ('${U.sam}','s@x.test','creator',1);
  `);
  if (withProfiles) {
    await db.exec(`
      create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade,
        username text not null, currency text, is_demo boolean not null default false, published boolean not null default true);
      alter table public.profiles enable row level security;
      create policy "profiles are publicly readable" on public.profiles for select using (published = true or auth.uid() = user_id or is_admin());
      create policy "profiles delete by owner or admin" on public.profiles for delete using (auth.uid() = user_id or is_admin());
      create table public.product_orders (id uuid primary key, profile_id uuid not null references public.profiles(id), status text not null default 'paid', total numeric(12,2) not null default 0, currency text, paid_at timestamptz);
      create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
      create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
      insert into public.profiles (id, user_id, username, currency, is_demo) values
        ('${P.alice}','${U.alice}','alice','XAF',false), ('${P.bob}','${U.bob}','bob','USD',false), ('${P.carol}','${U.carol}','carol','XAF',false),
        ('${P.dave}','${U.dave}','dave','XAF',false), ('${P.erin}','${U.erin}','erin','XAF',true), ('${P.kim}','${U.kim}','kim','KWD',false);
      insert into public.product_orders (id, profile_id) values ('${OID(1)}','${P.alice}'), ('${OID(2)}','${P.bob}');
      insert into public.orders (id, profile_id) values ('${OID(11)}','${P.alice}'), ('${OID(12)}','${P.bob}');
      insert into public.music_orders (id, profile_id) values ('${OID(21)}','${P.alice}');
    `);
  }
  return db;
}

const makeAs = (db) => async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const snapshot = async (db) => JSON.stringify((await db.query(`
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') as x
    from information_schema.columns where table_schema = 'public' and table_name not like 'bk\\_%'
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies where tablename not like 'bk\\_%'
  union all select 'fn:' || p.proname || ':' || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','auth') and p.proname not like 'bk\\_%'
  union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%bk\\_%'
  union all select 'idx:' || indexname from pg_indexes where schemaname='public' and tablename not like 'bk\\_%'
  union all select 'tbl:' || tablename from pg_tables where schemaname='public' and tablename not like 'bk\\_%'
  union all select 'row:plans:' || id || ':' || name from public.plans
  order by 1`)).rows.map((r) => r.x));

// ======================================================================================= A. preflight + apply
const db = await freshDb();
const as = makeAs(db);
const svc = (sql) => as("service_role", null, sql);

const pre = (await db.exec(PREFLIGHT))[0].rows;
check("A preflight", "preflight SQL executes on the pre-migration stand-in and every check is ok", pre.length >= 12 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));

const before = await snapshot(db);
check("A apply", "migration applies (real execution)", (await errOf(() => db.exec(MIGRATION))) === null);
check("A apply", "migration re-applies cleanly (idempotent)", (await errOf(() => db.exec(MIGRATION))) === null);
const plansFlags = Object.fromEntries((await db.query(`select name, business_toolkit_enabled as f from plans`)).rows.map((r) => [r.name, r.f]));
check("A apply", "seed: only business_basic and business_pro are enabled", JSON.stringify(Object.entries(plansFlags).sort()) === JSON.stringify(Object.entries({ free: false, basic: false, pro: false, business_basic: true, business_pro: true, association_basic: false }).sort()), JSON.stringify(plansFlags));
await db.exec(`update plans set business_toolkit_enabled = false where name = 'business_pro'`); // an admin's later choice
await db.exec(MIGRATION);
check("A apply", "re-running the migration does NOT re-seed over an admin's choice", (await db.query(`select business_toolkit_enabled as f from plans where name='business_pro'`)).rows[0].f === false);
await db.exec(`update plans set business_toolkit_enabled = true where name = 'business_pro'`);
const after = await snapshot(db);
check("A apply", "no pre-existing table/column/policy/function/trigger/index changed (only plans gained the new column)", before.replace(/\]$/, "") !== "" && JSON.parse(after).filter((x) => !JSON.parse(before).includes(x)).every((x) => x.startsWith("col:plans.business_toolkit_enabled")), JSON.stringify(JSON.parse(after).filter((x) => !JSON.parse(before).includes(x))));
check("A apply", "all pre-existing rows preserved", JSON.parse(before).filter((x) => x.startsWith("row:")).every((x) => JSON.parse(after).includes(x)));

const post = (await db.exec(PREFLIGHT))[0].rows;
check("A preflight", "preflight 'absent' checks correctly flip to not-ok once applied (it detects a prior apply)", post.filter((r) => /absent/.test(r.label)).every((r) => r.ok === false));

// ======================================================================================= B. objects, constraints, grants
const one = async (sql) => (await db.query(sql)).rows[0];
check("B objects", "tables, functions, triggers, policies exist", Number((await one(`select count(*)::int n from pg_tables where schemaname='public' and tablename in ('bk_entries','bk_entry_events')`)).n) === 2
  && Number((await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('bk_record_entry','bk_void_entry','bk_currency_digits','bk_entries_guard','bk_entry_events_guard')`)).n) === 5
  && Number((await one(`select count(*)::int n from pg_trigger where not tgisinternal and tgname in ('bk_entries_guard_trg','bk_entry_events_guard_trg')`)).n) === 2
  && Number((await one(`select count(*)::int n from pg_policies where tablename in ('bk_entries','bk_entry_events')`)).n) === 2);
check("B objects", "RLS enabled on both tables", (await db.query(`select relrowsecurity r from pg_class where relname in ('bk_entries','bk_entry_events')`)).rows.every((r) => r.r === true));
check("B objects", "all seven foreign keys are ON DELETE RESTRICT (confdeltype 'r')", (await db.query(`select confdeltype d from pg_constraint where contype='f' and conrelid in ('bk_entries'::regclass,'bk_entry_events'::regclass)`)).rows.length === 7 && (await db.query(`select confdeltype d from pg_constraint where contype='f' and conrelid in ('bk_entries'::regclass,'bk_entry_events'::regclass)`)).rows.every((r) => r.d === "r"));
check("B objects", "expected indexes exist, both unique ones partial", Number((await one(`select count(*)::int n from pg_indexes where schemaname='public' and indexname in ('bk_entries_profile_date_idx','bk_entries_request_idx','bk_entries_one_live_sale_link_idx','bk_entry_events_entry_idx','bk_entry_events_profile_idx')`)).n) === 5
  && Number((await one(`select count(*)::int n from pg_indexes where indexname in ('bk_entries_request_idx','bk_entries_one_live_sale_link_idx') and indexdef ilike '%where%'`)).n) === 2);
const priv = async (role, what) => (await one(`select ${what} as v`)).v;
for (const fn of ["bk_record_entry(uuid,uuid,text,numeric,date,text,text,boolean,text,uuid,uuid,uuid)", "bk_void_entry(uuid,uuid,uuid,text)"]) {
  check("B grants", `${fn.split("(")[0]}: EXECUTE denied to anon, authenticated, PUBLIC`, !(await priv("anon", `has_function_privilege('anon','${fn}','execute')`)) && !(await priv("authenticated", `has_function_privilege('authenticated','${fn}','execute')`)) && !(await one(`select exists (select 1 from pg_proc where oid='${fn}'::regprocedure and (proacl is null or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)))`)).exists);
  check("B grants", `${fn.split("(")[0]}: EXECUTE allowed to service_role`, await priv("service_role", `has_function_privilege('service_role','${fn}','execute')`));
}
for (const t of ["bk_entries", "bk_entry_events"]) {
  check("B grants", `${t}: anon has no table privilege at all`, !(await priv("anon", `has_table_privilege('anon','${t}','select,insert,update,delete,truncate')`)));
  check("B grants", `${t}: authenticated has SELECT only`, (await priv("a", `has_table_privilege('authenticated','${t}','select')`)) && !(await priv("a", `has_table_privilege('authenticated','${t}','insert')`)) && !(await priv("a", `has_table_privilege('authenticated','${t}','update')`)) && !(await priv("a", `has_table_privilege('authenticated','${t}','delete')`)) && !(await priv("a", `has_table_privilege('authenticated','${t}','truncate')`)));
  check("B grants", `${t}: service_role has no TRUNCATE/REFERENCES/TRIGGER (default ALL was revoked)`, !(await priv("s", `has_table_privilege('service_role','${t}','truncate,references,trigger')`)) && (await priv("s", `has_table_privilege('service_role','${t}','select,insert,update,delete')`)));
}
check("B grants", "TRUNCATE of both tables together is refused even for the table owner (statement-level guard fires)", (await errOf(() => db.exec(`truncate bk_entries, bk_entry_events`)))?.includes("never truncated"));
check("B grants", "TRUNCATE of bk_entry_events alone is refused by the guard", (await errOf(() => db.exec(`truncate bk_entry_events`)))?.includes("never truncated"));
check("B grants", "TRUNCATE bk_entries alone is refused (by PostgreSQL's own FK rule, since events reference it)", !!(await errOf(() => db.exec(`truncate bk_entries`))));
check("B grants", "a cascading TRUNCATE reaching the tables from profiles is refused", !!(await errOf(() => db.exec(`truncate public.profiles cascade`))));
check("B objects", "definer functions are SECURITY DEFINER with a pinned search_path", (await db.query(`select prosecdef s, proconfig c from pg_proc where proname in ('bk_record_entry','bk_void_entry')`)).rows.every((r) => r.s === true && (r.c || []).join(",").includes("search_path=public, pg_temp")));

// ---- helpers for RPC calls exactly as the route makes them (service role)
const rec = async (profile, actor, kind, amount, date, o = {}) => {
  const sql = `select bk_record_entry(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(kind)}, ${q(amount)}::numeric, ${q(date)}::date, ${q(o.category)}, ${q(o.desc)}, ${o.settled === undefined ? "null" : o.settled}, ${q(o.lt)}, ${q(o.lid)}::uuid, ${q(o.replaces)}::uuid, ${q(o.req)}::uuid) as r`;
  try { return { ok: true, r: (await svc(sql)).rows[0].r }; } catch (e) { return { ok: false, err: e.message.split("\n")[0] }; }
};
const vd = async (profile, actor, id, reason) => {
  try { return { ok: true, r: (await svc(`select bk_void_entry(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(id)}::uuid, ${q(reason)}) as r`)).rows[0].r }; } catch (e) { return { ok: false, err: e.message.split("\n")[0] }; }
};
const today = (await one(`select (now() at time zone 'Africa/Douala')::date::text d`)).d;
const plus = async (n) => (await one(`select ((now() at time zone 'Africa/Douala')::date + ${n})::text d`)).d;
const ev = async (entry) => (await db.query(`select event_type from bk_entry_events where entry_id='${entry}' order by created_at, id`)).rows.map((r) => r.event_type);

// ======================================================================================= C. access + plan gate
const okA = await rec(P.alice, U.alice, "expense", "4000", today, { category: "rent", desc: "  shop rent ", req: UID(900) });
check("C access", "owner records an entry; currency comes from the profile; description trimmed", okA.ok && okA.r.entry.currency === "XAF" && okA.r.entry.description === "shop rent" && okA.r.duplicate === false && okA.r.entry.created_by === U.alice, JSON.stringify(okA));
const exp = (name, r, msg) => check("C access", name, !r.ok && r.err.includes(msg), JSON.stringify(r));
exp("another user (alice's profile, bob's id) is rejected: not_owner", await rec(P.alice, U.bob, "expense", "10", today), "not_owner");
exp("a staff-like third user (sam) is rejected: not_owner", await rec(P.alice, U.sam, "expense", "10", today), "not_owner");
exp("admin acting on someone else's profile is rejected", await rec(P.alice, U.admin, "expense", "10", today), "not_owner");
exp("null actor rejected", await rec(P.alice, null, "expense", "10", today), "not_owner");
exp("unknown profile", await rec(OID(99), U.alice, "expense", "10", today), "profile_unavailable");
exp("demo profile refused", await rec(P.erin, U.erin, "expense", "10", today), "demo_profile_not_supported");
exp("owner on the Free plan (flag false) refused", await rec(P.carol, U.carol, "expense", "10", today), "toolkit_not_enabled");
exp("owner with NULL plan_id (no plan row) refused", await rec(P.dave, U.dave, "expense", "10", today), "toolkit_not_enabled");
await db.exec(`update plans set business_toolkit_enabled = false where name='business_pro'`);
exp("plan flag switched OFF by admin => owner refused", await rec(P.alice, U.alice, "expense", "10", today), "toolkit_not_enabled");
exp("... and voiding is refused too", await vd(P.alice, U.alice, okA.r.entry.id, "x"), "toolkit_not_enabled");
check("C access", "history is NOT deleted or hidden by the downgrade (row still there, still owner-readable)", Number((await as("authenticated", U.alice, `select count(*)::int n from bk_entries`)).rows[0].n) === 1);
await db.exec(`update plans set business_toolkit_enabled = true where name='business_pro'`);
check("C access", "owner regains access when the flag is back on", (await rec(P.alice, U.alice, "expense", "10", today)).ok);

// ======================================================================================= D. amounts, dates, currency
const bad = async (name, r, frag) => check("D input", name, !r.ok && new RegExp(frag).test(r.err), JSON.stringify(r));
await bad("zero amount violates CHECK", await rec(P.alice, U.alice, "sale", "0", today), "violates check");
await bad("negative amount violates CHECK", await rec(P.alice, U.alice, "sale", "-5", today), "violates check");
await bad("amount above the maximum violates CHECK/overflow", await rec(P.alice, U.alice, "sale", "10000000000", today), "numeric field overflow|violates check");
await bad("XAF fractional franc is refused (no silent rounding)", await rec(P.alice, U.alice, "sale", "12.5", today), "violates check");
await bad("XAF 12000.004 is refused", await rec(P.alice, U.alice, "sale", "12000.004", today), "violates check|amount_too_precise");
check("D input", "XAF whole francs accepted and stored exactly", (await rec(P.alice, U.alice, "sale", "12000", today)).ok);
check("D input", "USD cents accepted exactly (10.50)", (await rec(P.bob, U.bob, "sale", "10.50", today)).r?.entry.amount == 10.5);
await bad("USD 10.555 refused (would round)", await rec(P.bob, U.bob, "sale", "10.555", today), "violates check");
check("D input", "KWD 3 decimals accepted exactly (1.234)", (await rec(P.kim, U.kim, "sale", "1.234", today)).r?.entry.amount == 1.234);
await bad("KWD 1.2345 refused", await rec(P.kim, U.kim, "sale", "1.2345", today), "amount_too_precise|violates check");
await bad("an over-long amount that would ROUND to a valid value (10.5004 USD) is refused, not rounded", await rec(P.bob, U.bob, "sale", "10.5004", today), "amount_too_precise");
await bad("1.23456 on XAF refused", await rec(P.alice, U.alice, "sale", "1.23456", today), "amount_too_precise");
await bad("NULL amount refused", await rec(P.alice, U.alice, "sale", null, today), "invalid_amount");
check("D input", "today accepted", (await rec(P.alice, U.alice, "expense", "1", today)).ok);
await bad("tomorrow (Douala) refused: date_in_future", await rec(P.alice, U.alice, "expense", "1", await plus(1)), "date_in_future");
check("D input", "a past date is accepted", (await rec(P.alice, U.alice, "expense", "1", await plus(-400))).ok);
await bad("an impossible calendar date is refused by PostgreSQL itself", await rec(P.alice, U.alice, "expense", "1", "2026-02-30"), "out of range");
await bad("unknown kind violates CHECK", await rec(P.alice, U.alice, "gift", "1", today), "violates check");
await bad("unsettled cash_in violates CHECK", await rec(P.alice, U.alice, "cash_in", "1", today, { settled: false }), "violates check");
check("D input", "unsettled sale/expense accepted", (await rec(P.alice, U.alice, "sale", "9", today, { settled: false })).ok && (await rec(P.alice, U.alice, "expense", "9", today, { settled: false })).ok);
await bad("over-long description violates CHECK", await rec(P.alice, U.alice, "expense", "1", today, { desc: "x".repeat(501) }), "violates check");
check("D input", "blank category stored as NULL", (await rec(P.alice, U.alice, "expense", "1", today, { category: "   " })).r?.entry.category === null);
const tzRow = await one(`select ((timestamptz '2026-09-30 23:30:00+00') at time zone 'Africa/Douala')::date::text d`);
check("D input", "PostgreSQL agrees with the JS bucketing: 23:30Z Sep 30 is Oct 1 in Douala", tzRow.d === "2026-10-01" && B.toLocalDateKey("2026-09-30T23:30:00Z") === "2026-10-01");

// ======================================================================================= E. idempotency
const r1 = await rec(P.alice, U.alice, "expense", "777", today, { req: UID(901) });
const r2 = await rec(P.alice, U.alice, "expense", "777", today, { req: UID(901) });
check("E idempotency", "same client_request_id returns the original entry (duplicate = true), one row", r1.ok && r2.ok && r2.r.duplicate === true && r1.r.entry.id === r2.r.entry.id && Number((await one(`select count(*)::int n from bk_entries where client_request_id='${UID(901)}'`)).n) === 1 && (await ev(r1.r.entry.id)).length === 1);
const r3 = await rec(P.alice, U.alice, "expense", "999", today, { req: UID(901) });
check("E idempotency", "a retry with a DIFFERENT body and the same id still returns the first entry unchanged", r3.ok && r3.r.duplicate && Number(r3.r.entry.amount) === 777);
check("E idempotency", "the same request id for ANOTHER business is independent", (await rec(P.bob, U.bob, "expense", "5", today, { req: UID(901) })).r?.duplicate === false);
const dupIdx = await errOf(() => svc(`insert into bk_entries (profile_id, kind, amount, currency, entry_date, client_request_id) values ('${P.alice}','expense',1,'XAF',current_date,'${UID(901)}')`));
check("E idempotency", "unique index backstop: a raw duplicate insert fails on bk_entries_request_idx", dupIdx && dupIdx.includes("duplicate key") , String(dupIdx));

// ======================================================================================= F. linked orders / duplicate manual sales
const sale1 = await rec(P.alice, U.alice, "sale", "500", today, { lt: "restaurant_order", lid: OID(11) });
check("F links", "first manual sale linked to a restaurant order is accepted", sale1.ok, JSON.stringify(sale1));
exp("second live manual sale for the SAME order: order_already_counted (RPC pre-check)", await rec(P.alice, U.alice, "sale", "500", today, { lt: "restaurant_order", lid: OID(11) }), "order_already_counted");
const idxErr = await errOf(() => svc(`insert into bk_entries (profile_id, kind, amount, currency, entry_date, linked_order_type, linked_order_id) values ('${P.alice}','sale',1,'XAF',current_date,'restaurant_order','${OID(11)}')`));
check("F links", "backstop error text names bk_entries_one_live_sale_link_idx in THIS engine (the route maps that text to 409; real PostgREST text is NOT VERIFIED)", idxErr && idxErr.includes("bk_entries_one_live_sale_link_idx"), String(idxErr));
check("F links", "raw duplicate insert really fails on the unique index", idxErr && idxErr.includes("duplicate key"), String(idxErr));
exp("manual sale linked to a product_order: order_already_counted (auto-counted)", await rec(P.alice, U.alice, "sale", "1", today, { lt: "product_order", lid: OID(1) }), "order_already_counted");
check("F links", "table CHECK also refuses it if the RPC is bypassed", (await errOf(() => svc(`insert into bk_entries (profile_id, kind, amount, currency, entry_date, linked_order_type, linked_order_id) values ('${P.alice}','sale',1,'XAF',current_date,'product_order','${OID(1)}')`)))?.includes("violates check"));
check("F links", "an EXPENSE linked to a product_order is accepted", (await rec(P.alice, U.alice, "expense", "300", today, { lt: "product_order", lid: OID(1) })).ok);
check("F links", "an expense linked to a music order is accepted", (await rec(P.alice, U.alice, "expense", "300", today, { lt: "music_order", lid: OID(21) })).ok);
exp("another business's order cannot be linked", await rec(P.alice, U.alice, "expense", "1", today, { lt: "restaurant_order", lid: OID(12) }), "linked_order_not_found");
exp("unknown order id", await rec(P.alice, U.alice, "expense", "1", today, { lt: "restaurant_order", lid: OID(98) }), "linked_order_not_found");
check("F links", "half a link violates CHECK", (await errOf(() => svc(`insert into bk_entries (profile_id, kind, amount, currency, entry_date, linked_order_type) values ('${P.alice}','expense',1,'XAF',current_date,'music_order')`)))?.includes("violates check"));
const v1 = await vd(P.alice, U.alice, sale1.r.entry.id, "entered twice by mistake");
check("F links", "after voiding, the same order can be recorded again", v1.ok && (await rec(P.alice, U.alice, "sale", "500", today, { lt: "restaurant_order", lid: OID(11) })).ok);

// ======================================================================================= G. void, replace, immutability, audit
const g1 = (await rec(P.alice, U.alice, "expense", "2000", today, { category: "rent" })).r.entry;
exp("void requires a reason", await vd(P.alice, U.alice, g1.id, "   "), "reason_required");
exp("void by a non-owner is refused", await vd(P.alice, U.bob, g1.id, "x"), "not_owner");
exp("void of another business's entry reports entry_not_found (no existence leak)", await vd(P.bob, U.bob, g1.id, "x"), "entry_not_found");
const vv = await vd(P.alice, U.alice, g1.id, "  wrong amount  ");
check("G void", "owner voids: voided_at/by/reason set and reason trimmed", vv.ok && vv.r.already_voided === false && vv.r.entry.void_reason === "wrong amount" && vv.r.entry.voided_by === U.alice);
const vv2 = await vd(P.alice, U.alice, g1.id, "again");
check("G void", "voiding twice is idempotent: already_voided, reason unchanged, no extra audit row", vv2.ok && vv2.r.already_voided === true && vv2.r.entry.void_reason === "wrong amount" && JSON.stringify(await ev(g1.id)) === JSON.stringify(["created", "voided"]));
exp("entry not found", await vd(P.alice, U.alice, OID(97), "x"), "entry_not_found");
const old = (await rec(P.alice, U.alice, "expense", "3000", today, { category: "transport" })).r.entry;
const rep = await rec(P.alice, U.alice, "expense", "3500", today, { category: "transport", replaces: old.id });
check("G replace", "a correction voids the old entry and inserts the replacement atomically", rep.ok && rep.r.entry.replaces_entry_id === old.id && (await one(`select voided_at is not null v, void_reason r from bk_entries where id='${old.id}'`)).v === true && JSON.stringify(await ev(old.id)) === JSON.stringify(["created", "replaced"]), JSON.stringify(rep));
exp("replacing an already-voided entry is refused", await rec(P.alice, U.alice, "expense", "1", today, { replaces: old.id }), "entry_already_voided");
exp("replacing another business's entry is refused", await rec(P.bob, U.bob, "expense", "1", today, { replaces: rep.r.entry.id }), "entry_not_found");
const old2 = (await rec(P.alice, U.alice, "expense", "100", today)).r.entry;
const badRep = await rec(P.alice, U.alice, "expense", "12.5", today, { replaces: old2.id }); // violates the XAF scale CHECK mid-function
check("G replace", "TRANSACTION ROLLBACK: a failing replacement leaves the old entry live and writes no events", !badRep.ok && (await one(`select voided_at is null l from bk_entries where id='${old2.id}'`)).l === true && JSON.stringify(await ev(old2.id)) === JSON.stringify(["created"]), JSON.stringify(badRep));
const s2 = (await rec(P.alice, U.alice, "sale", "800", today, { lt: "music_order", lid: OID(21) })).r.entry;
check("G replace", "replacing a linked sale with a corrected one for the same order is allowed (pre-check excludes the replaced row)", (await rec(P.alice, U.alice, "sale", "850", today, { lt: "music_order", lid: OID(21), replaces: s2.id })).ok);
const ex = async (name, sql, frag) => check("G immutability", name, (await errOf(() => svc(sql)))?.includes(frag), String(await errOf(() => svc(sql))));
const live = (await rec(P.alice, U.alice, "expense", "60", today)).r.entry;
await ex("service role cannot change an amount", `update bk_entries set amount = 1 where id='${live.id}'`, "immutable");
await ex("service role cannot change the date", `update bk_entries set entry_date = entry_date - 1 where id='${live.id}'`, "immutable");
await ex("service role cannot move an entry to another business", `update bk_entries set profile_id = '${P.bob}' where id='${live.id}'`, "immutable");
await ex("service role cannot rewrite created_by", `update bk_entries set created_by = '${U.bob}' where id='${live.id}'`, "immutable");
await ex("service role cannot DELETE an entry", `delete from bk_entries where id='${live.id}'`, "never deleted");
await ex("a voided entry cannot be modified again", `update bk_entries set void_reason = 'changed' where id='${g1.id}'`, "already voided");
await ex("the audit trail cannot be updated", `update bk_entry_events set event_type = 'created' where entry_id='${g1.id}'`, "append-only");
await ex("the audit trail cannot be deleted from", `delete from bk_entry_events where entry_id='${g1.id}'`, "append-only");
check("G audit", "every entry has a 'created' event; events carry actor and details", Number((await one(`select count(*)::int n from bk_entries e where not exists (select 1 from bk_entry_events v where v.entry_id = e.id and v.event_type = 'created')`)).n) === 0 && Number((await one(`select count(*)::int n from bk_entry_events where actor_user_id is null or details is null`)).n) === 0);

// ======================================================================================= H. RLS
const cnt = async (role, sub, t) => Number((await as(role, sub, `select count(*)::int n from ${t}`)).rows[0].n);
const total = Number((await one(`select count(*)::int n from bk_entries where profile_id='${P.alice}'`)).n);
check("H rls", "owner (alice) reads exactly her own entries", (await cnt("authenticated", U.alice, "bk_entries")) === total);
check("H rls", "another user (bob) sees only his own, never alice's", (await as("authenticated", U.bob, `select count(*)::int n from bk_entries where profile_id='${P.alice}'`)).rows[0].n === 0 && (await cnt("authenticated", U.bob, "bk_entries")) >= 1);
check("H rls", "a staff-like user (sam) sees nothing", (await cnt("authenticated", U.sam, "bk_entries")) === 0 && (await cnt("authenticated", U.sam, "bk_entry_events")) === 0);
check("H rls", "admin sees nothing through RLS (owner-only; admins use the service role)", (await cnt("authenticated", U.admin, "bk_entries")) === 0);
check("H rls", "anon sees nothing and has no privilege", (await errOf(() => as("anon", null, `select 1 from bk_entries`)))?.includes("permission denied"));
check("H rls", "owner reads her audit events, bob cannot", (await cnt("authenticated", U.alice, "bk_entry_events")) > 0 && (await as("authenticated", U.bob, `select count(*)::int n from bk_entry_events where profile_id='${P.alice}'`)).rows[0].n === 0);
for (const [what, sql] of [["insert", `insert into bk_entries (profile_id, kind, amount, currency, entry_date) values ('${P.alice}','sale',1,'XAF',current_date)`], ["update", `update bk_entries set cash_settled = true`], ["delete", `delete from bk_entries`]]) {
  check("H rls", `authenticated cannot ${what} directly (even the owner)`, (await errOf(() => as("authenticated", U.alice, sql)))?.includes("permission denied"));
}
check("H rls", "authenticated cannot call bk_record_entry", (await errOf(() => as("authenticated", U.alice, `select bk_record_entry('${P.alice}','${U.alice}','expense',1,current_date,null,null,null,null,null,null,null)`)))?.includes("permission denied for function"));
check("H rls", "authenticated cannot call bk_void_entry", (await errOf(() => as("authenticated", U.alice, `select bk_void_entry('${P.alice}','${U.alice}','${live.id}','x')`)))?.includes("permission denied for function"));
check("H rls", "anon cannot call the RPCs", (await errOf(() => as("anon", null, `select bk_void_entry('${P.alice}','${U.alice}','${live.id}','x')`)))?.includes("permission denied for function"));
check("H rls", "a forged actor id from a non-service role still cannot bypass: even service_role is refused for a wrong actor", !(await rec(P.alice, U.bob, "expense", "1", today)).ok);

// ======================================================================================= I. deletion behaviour
check("I delete", "deleting a REAL profile that has bookkeeping entries is blocked (FK RESTRICT)", (await errOf(() => db.exec(`delete from public.profiles where id='${P.alice}'`)))?.match(/foreign key/));
check("I delete", "deleting the owner (user) of a profile with entries is blocked", (await errOf(() => db.exec(`delete from public.users where id='${U.alice}'`)))?.match(/foreign key/));
check("I delete", "history is intact after the blocked deletes", (await one(`select count(*)::int n from bk_entries where profile_id='${P.alice}'`)).n === total);
check("I delete", "a DEMO profile never gets entries, so the demo-cleanup deletion of its user/profile succeeds", (await db.query(`select count(*)::int n from bk_entries where profile_id='${P.erin}'`)).rows[0].n === 0 && (await errOf(() => db.exec(`delete from public.users where id='${U.erin}'`))) === null && (await db.query(`select count(*)::int n from public.profiles where id='${P.erin}'`)).rows[0].n === 0);
check("I delete", "a real user/profile with NO entries deletes normally (existing behaviour unchanged)", (await errOf(() => db.exec(`delete from public.users where id='${U.dave}'`))) === null);
check("I delete", "direct delete of a plan row used by nobody is unaffected", (await errOf(() => db.exec(`delete from public.plans where name='association_basic'`))) === null);

// ======================================================================================= J. summary integration + pagination
await db.exec(`insert into bk_entries (profile_id, kind, amount, currency, entry_date, created_by)
  select '${P.bob}', 'sale', 10, 'USD', date '2026-03-10', '${U.bob}' from generate_series(1, 2500)`);
const paged = [];
for (let off = 0; ; off += 1000) {
  const rows = (await svc(`select id, kind, amount::text as amount, currency, entry_date::text as entry_date, category, cash_settled, linked_order_type, linked_order_id, voided_at from bk_entries where profile_id='${P.bob}' and entry_date >= '2026-03-01' and entry_date <= '2026-03-31' order by entry_date, id limit 1000 offset ${off}`)).rows;
  paged.push(...rows);
  if (rows.length < 1000) break;
}
check("J summary", "ordered limit/offset paging (as PostgREST ranges) returns all 2,500 rows exactly once", paged.length === 2500 && new Set(paged.map((r) => r.id)).size === 2500);
const sum = B.summarize({ entries: paged, autoSales: [], from: "2026-03-01", to: "2026-03-31", currency: "USD", cost: { kind: "none_needed" } });
check("J summary", "JS summary over REAL PostgreSQL rows (numeric text like '10.000') is exact: 25,000.00 USD", sum.revenue.salesMinor === 2500000 && sum.minorDigits === 2 && sum.excluded.unreadableAmount === 0, JSON.stringify(sum.revenue));
const lo = B.localRangeInstants("2026-09-01", "2026-09-30");
await db.exec(`insert into product_orders (id, profile_id, status, total, currency, paid_at) values
  ('${OID(31)}','${P.alice}','paid',5000,'XAF','2026-09-30T22:30:00Z'), ('${OID(32)}','${P.alice}','paid',7000,'XAF','2026-09-30T23:00:00Z'),
  ('${OID(33)}','${P.alice}','paid',3000,'XAF','2026-08-31T23:00:00Z'), ('${OID(34)}','${P.alice}','paid',1000,'XAF','2026-08-31T22:59:59Z'),
  ('${OID(35)}','${P.alice}','refunded',9000,'XAF','2026-09-10T10:00:00Z')`);
const po = (await svc(`select id, status, total::text as total, currency, paid_at from product_orders where profile_id='${P.alice}' and status in ('paid','fulfilled') and paid_at >= '${lo.start}' and paid_at < '${lo.endExclusive}'`)).rows;
const autos = po.map((r) => B.autoSaleFromProductOrder({ ...r, paid_at: new Date(r.paid_at).toISOString() })).filter(Boolean);
check("J summary", "SQL window on timestamptz selects exactly the orders whose Douala day is in September (boundaries both sides)", po.map((r) => r.id).sort().join() === [OID(31), OID(33)].sort().join(), po.map((r) => r.id).join());
const sum2 = B.summarize({ entries: [], autoSales: autos, from: "2026-09-01", to: "2026-09-30", currency: "XAF", cost: { kind: "none_needed" } });
check("J summary", "JS bucketing of those same rows agrees with the SQL window (8,000 XAF, no row dropped or double counted)", sum2.revenue.autoSalesMinor === 8000 && sum2.counts.autoSales === 2);

// ======================================================================================= K. rollback + atomic failure
const liveEntriesBeforeRollback = Number((await one(`select count(*)::int n from bk_entries`)).n);
check("K rollback", "documented rollback SQL was extracted from the migration file", /drop table if exists bk_entries;/.test(ROLLBACK) && /alter table plans drop column/.test(ROLLBACK) && ROLLBACK.startsWith("begin;") && ROLLBACK.trim().endsWith("commit;"), ROLLBACK.slice(0, 60));
const rbDb = await freshDb();
const rbBefore = await snapshot(rbDb);
await rbDb.exec(MIGRATION);
await makeAs(rbDb)("service_role", null, `select bk_record_entry('${P.alice}','${U.alice}','expense',5,current_date,null,null,null,null,null,null,null)`);
check("K rollback", "rollback SQL executes (real execution)", (await errOf(() => rbDb.exec(ROLLBACK))) === null);
check("K rollback", "rollback removes every bk_* object", Number((await rbDb.query(`select (select count(*) from pg_tables where tablename like 'bk\\_%') + (select count(*) from pg_proc where proname like 'bk\\_%') + (select count(*) from pg_trigger where tgname like 'bk\\_%')  as n`)).rows[0].n) === 0);
check("K rollback", "rollback leaves EVERYTHING ELSE byte-for-byte as it was before the migration (tables, columns, policies, functions, triggers, indexes, plan rows)", (await snapshot(rbDb)) === rbBefore);
check("K rollback", "the migration can be applied again after a rollback", (await errOf(() => rbDb.exec(MIGRATION))) === null);
const atomic = await freshDb({ withProfiles: false });
const atomicBefore = await snapshot(atomic);
const atomicErr = await errOf(() => atomic.exec(MIGRATION));
check("K atomic", "migration run against a database missing `profiles` fails...", !!atomicErr, String(atomicErr));
// PGlite's exec() leaves the failed begin...commit block as an aborted open transaction; a client ends it with ROLLBACK,
// after which nothing from the migration may remain.
await atomic.exec("rollback").catch(() => {});
const leftovers2 = Number((await atomic.query(`select (select count(*) from pg_tables where tablename like 'bk\_%') + (select count(*) from pg_proc where proname like 'bk\_%') + (select count(*) from information_schema.columns where column_name='business_toolkit_enabled') as n`)).rows[0].n);
check("K atomic", "...and leaves no partial objects and no plans column (single transaction)", leftovers2 === 0 && (await snapshot(atomic)) === atomicBefore, `leftover objects=${leftovers2}`);
check("K rollback", "the main test database still holds its bookkeeping rows (rollback was exercised on a separate in-memory database)", liveEntriesBeforeRollback > 0);

// ======================================================================================= report
const groups = {};
for (const r of results) { (groups[r.group] ||= { pass: 0, fail: 0 })[r.pass ? "pass" : "fail"]++; }
console.log("\nPGlite (real PostgreSQL engine, stand-in Supabase shell) results by group:");
for (const [g, c] of Object.entries(groups)) console.log(`  ${g.padEnd(16)} ${c.pass} passed${c.fail ? `, ${c.fail} FAILED` : ""}`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${process.env.MUT ? ` (MUT=${process.env.MUT}: failures are EXPECTED)` : ""}`);
console.log(`
NOT VERIFIED (PGlite cannot reproduce these; they need real Supabase staging):
  1. Supabase's real roles, default privileges, schema owners and event triggers (here: stand-ins copied from the documented defaults).
  2. PostgREST: JSON-string -> numeric/date/uuid parameter casting for rpc(), returned error text/HTTP codes, the 1000-row range cap
     (paging was tested with plain LIMIT/OFFSET SQL, not through PostgREST), and exposure of public functions as RPC.
  3. JWT verification and the real auth.uid() (here: a GUC set by the test); real auth.users linkage and ON DELETE CASCADE from auth.users.
  4. The actual production schema: live-only columns/constraints/triggers/policies on profiles, users, plans, product_orders, orders, music_orders.
  5. Truly concurrent transactions (PGlite is a single connection): the advisory lock that serialises duplicate client_request_id
     submissions executes, but its serialisation is unproven; only the unique-index backstop was exercised.
  6. Connection-pooler (Supavisor/PgBouncer) behaviour with pg_advisory_xact_lock and SET LOCAL-free functions.
  7. Dropping a plan row / dangling plans.id: users.plan_id is a real FK in this stand-in, so a dangling plan cannot be simulated.
  8. SQL-editor execution semantics (implicit transaction handling, statement timeouts, role the editor runs as).
  9. Anything about live data volumes/performance (2,500-row fixtures only).
`);
process.exit(failed.length && !process.env.MUT ? 1 : 0);
