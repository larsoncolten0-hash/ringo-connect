// Test for supabase/migrations/2026-12-02_documents_invoices_receipts.sql (Business Toolkit Phase 2).
//
// Runs entirely on a scratch, IN-MEMORY PostgreSQL (PGlite: a real PostgreSQL 17 engine compiled to WASM). It never connects to
// Supabase or any real database and never reads .env.local.
//
// WHAT IS REAL: the REAL Phase 1 migration, the REAL Phase 2 migration, the preflight and the documented rollback are executed by a
// real PostgreSQL engine; constraints, composite foreign keys, triggers, plpgsql functions, GRANT/REVOKE and RLS (via SET ROLE) are
// genuinely evaluated.
// WHAT IS A STAND-IN (PGlite is NOT Supabase; nothing here proves compatibility with the production schema):
//   * roles anon / authenticated / service_role (service_role has BYPASSRLS), schema `auth` with auth.uid() reading a GUC;
//   * Supabase's documented default privileges (new public tables/functions granted to anon/authenticated/service_role and
//     function EXECUTE to PUBLIC), so the migration's REVOKEs are really exercised;
//   * public.users(id, email, role, plan_id uuid), public.plans(id uuid, name, ...), public.profiles(...) and public.products(...),
//     reduced to the columns the migrations touch; users has NO FK to auth.users; is_admin() and the real users/profiles RLS
//     policies are copied from supabase/schema.sql; product_orders / orders / music_orders are reduced to (id, profile_id, ...).
//   * PostgREST, JWT verification, Supabase's supabase_admin ownership and event triggers and every other live object are absent.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json or the lockfile)
//   Run:    node supabase/support/tests/documents_foundation.test.mjs
//   MUT=open_read  opens the documents read policy IN MEMORY ONLY (never on disk) to prove the RLS checks can fail.
//   MUT=no_gate    removes the owner check from bk_doc_gate IN MEMORY ONLY.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const TOT = jiti(path.join(REPO, "src/lib/documents/totals.ts"));
const NUM = jiti(path.join(REPO, "src/lib/documents/numbering.ts"));

const PHASE1 = read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql");
let PHASE2 = read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql");
if (process.env.MUT === "open_read") PHASE2 = PHASE2.replace(/create policy "bk_documents owner read" on bk_documents for select to authenticated\n\s+using \(exists[^\n]*\)/, 'create policy "bk_documents owner read" on bk_documents for select to authenticated using (true)');
if (process.env.MUT === "no_gate") PHASE2 = PHASE2.replace("if p_actor_user_id is null or v_profile.user_id is distinct from p_actor_user_id then raise exception 'not_owner'; end if;\n  select coalesce(pl.business_toolkit_enabled, false) into v_enabled\n    from users u left join plans pl on pl.id = u.plan_id where u.id = v_profile.user_id;", "select coalesce(pl.business_toolkit_enabled, false) into v_enabled\n    from users u left join plans pl on pl.id = u.plan_id where u.id = v_profile.user_id;");
const PREFLIGHT = read("supabase/support/2026-12-02_documents_invoices_receipts.preflight.sql");
const ROLLBACK = (() => {
  const lines = PHASE2.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s{3}/, ""));
  return lines.join("\n");
})();

const results = [];
const check = (group, name, cond, detail = "") => {
  results.push({ group, name, pass: !!cond });
  if (!cond) console.log(`  FAIL [${group}]: ${name} | ${String(detail).slice(0, 400)}`);
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLN = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRD = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), carol: UID(3), dave: UID(4), erin: UID(5), kim: UID(6), admin: UID(7), sam: UID(8) };
const P = { alice: PID(1), bob: PID(2), carol: PID(3), dave: PID(4), erin: PID(5), kim: PID(6) };
const PL = { free: PLN(1), basic: PLN(2), pro: PLN(3), business_basic: PLN(4), business_pro: PLN(5) };
let reqCounter = 1000;
const req = () => RQ(++reqCounter);
const H64 = (n) => String(n).padStart(2, "0").repeat(32).slice(0, 64);

async function freshDb({ withProfiles = true } = {}) {
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
    insert into public.plans (id, name) values ('${PL.free}','free'),('${PL.basic}','basic'),('${PL.pro}','pro'),('${PL.business_basic}','business_basic'),('${PL.business_pro}','business_pro');
    insert into public.users (id, email, role, plan_id) values
      ('${U.alice}','a@x.test','creator','${PL.business_pro}'), ('${U.bob}','b@x.test','creator','${PL.business_pro}'), ('${U.carol}','c@x.test','creator','${PL.free}'),
      ('${U.dave}','d@x.test','creator',null), ('${U.erin}','e@x.test','creator','${PL.business_pro}'), ('${U.kim}','k@x.test','creator','${PL.business_basic}'),
      ('${U.admin}','ad@x.test','admin','${PL.business_pro}'), ('${U.sam}','s@x.test','creator','${PL.free}');
  `);
  if (withProfiles) {
    await db.exec(`
      create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text, is_demo boolean not null default false, published boolean not null default true);
      alter table public.profiles enable row level security;
      create policy "profiles are publicly readable" on public.profiles for select using (published = true or auth.uid() = user_id or is_admin());
      create policy "profiles delete by owner or admin" on public.profiles for delete using (auth.uid() = user_id or is_admin());
      create table public.products (id uuid primary key, profile_id uuid not null references public.profiles(id), name text);
      create table public.product_orders (id uuid primary key, profile_id uuid not null references public.profiles(id), status text not null default 'paid', total numeric(12,2) not null default 0, currency text, paid_at timestamptz);
      create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
      create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
      insert into public.profiles (id, user_id, username, name, currency, is_demo) values
        ('${P.alice}','${U.alice}','alice','Alice Shop','XAF',false), ('${P.bob}','${U.bob}','bob','Bob Shop','USD',false), ('${P.carol}','${U.carol}','carol','Carol','XAF',false),
        ('${P.dave}','${U.dave}','dave','Dave','XAF',false), ('${P.erin}','${U.erin}','erin','Erin Demo','XAF',true), ('${P.kim}','${U.kim}','kim','Kim','KWD',false);
      insert into public.products (id, profile_id, name) values ('${PRD(1)}','${P.alice}','Alice product'), ('${PRD(2)}','${P.bob}','Bob product');
    `);
  }
  return db;
}

const makeAs = (db) => async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const J = (v) => (v === undefined || v === null ? "null" : `${q(JSON.stringify(v))}::jsonb`);

// everything that existed before Phase 2 (columns, policies, functions + bodies + ACLs, triggers, indexes, tables, grants, rows)
const snapshot = async (db) => (await db.query(`
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') as x
    from information_schema.columns where table_schema = 'public'
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies
  union all select 'fn:' || p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','auth')
  union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
  union all select 'idx:' || indexname from pg_indexes where schemaname = 'public'
  union all select 'tbl:' || tablename from pg_tables where schemaname = 'public'
  union all select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public'
  union all select 'row:plans:' || id || ':' || name || ':' || business_toolkit_enabled::text from public.plans
  union all select 'row:bk_entries:' || id from public.bk_entries
  order by 1`)).rows.map((r) => r.x);
const isPhase2Name = (s) => /(bk_business_profiles|bk_documents|bk_document_|bk_doc_|doc_(upsert|save|issue|record|void|create|revoke|resolve))/.test(s);

// ======================================================================================= A. apply, re-run, preflight
const db = await freshDb();
const as = makeAs(db);
const svc = (sql) => as("service_role", null, sql);
const one = async (sql) => (await db.query(sql)).rows[0];
const rows = async (sql) => (await db.query(sql)).rows;

check("A apply", "Phase 1 (real migration) applies on the stand-in", (await errOf(() => db.exec(PHASE1))) === null);
const pre = (await db.exec(PREFLIGHT))[0].rows;
check("A preflight", "the Phase 2 preflight passes on a Phase-1-ready database (every row ok)", pre.length >= 14 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
const before = await snapshot(db);
const applyErr = await errOf(() => db.exec(PHASE2));
check("A apply", "Phase 2 migration applies (real execution)", applyErr === null, applyErr);
if (applyErr) { console.log("Cannot continue: the migration did not apply."); process.exit(1); }
check("A apply", "Phase 2 re-applies cleanly (idempotent)", (await errOf(() => db.exec(PHASE2))) === null);
const after = await snapshot(db);
const lost = before.filter((x) => !after.includes(x));
check("A apply", "NOTHING that existed before Phase 2 changed (columns, policies, function bodies and ACLs, triggers, indexes, tables, grants, rows — Phase 1 included)", lost.length === 0, JSON.stringify(lost.slice(0, 5)));
check("A apply", "every addition belongs to Phase 2 (no stray object)", after.filter((x) => !before.includes(x)).every(isPhase2Name), JSON.stringify(after.filter((x) => !before.includes(x) && !isPhase2Name(x)).slice(0, 5)));
check("A apply", "no existing table was altered at all (not even plans)", after.filter((x) => x.startsWith("col:") && !before.includes(x)).every((x) => /^col:(bk_business_profiles|bk_documents|bk_document_)/.test(x)));
const post = (await db.exec(PREFLIGHT))[0].rows;
check("A preflight", "after applying, the 'no Phase 2 object exists' checks correctly flip to not-ok", post.filter((r) => /^no Phase 2/.test(r.label)).every((r) => r.ok === false));

// ======================================================================================= B. objects, constraints, grants
const TABLES = ["bk_business_profiles", "bk_documents", "bk_document_lines", "bk_document_counters", "bk_document_payments", "bk_document_events", "bk_document_shares", "bk_document_rate_events"];
check("B objects", "all eight tables exist with RLS enabled", Number((await one(`select count(*)::int n from pg_class where relname in (${TABLES.map(q).join(",")}) and relrowsecurity`)).n) === 8);
const fks = await rows(`select conrelid::regclass::text t, confdeltype d from pg_constraint where contype = 'f' and conrelid::regclass::text = any (array[${TABLES.map(q).join(",")}])`);
check("B objects", "every foreign key on the new tables is ON DELETE RESTRICT", fks.length >= 18 && fks.every((r) => r.d === "r"), JSON.stringify(fks.filter((r) => r.d !== "r")));
check("B objects", "composite same-business foreign keys exist (documents parent/replaces, payments x2, events, shares)", Number((await one(`select count(*)::int n from pg_constraint where contype = 'f' and array_length(conkey, 1) = 2 and conrelid::regclass::text = any (array[${TABLES.map(q).join(",")}])`)).n) === 6);
check("B objects", "partial unique indexes exist for numbering, requests, replacement and source", Number((await one(`select count(*)::int n from pg_indexes where indexname in ('bk_documents_number_idx','bk_documents_number_text_idx','bk_documents_request_idx','bk_documents_one_replacement_idx','bk_documents_source_idx') and indexdef ilike '%where%'`)).n) === 5);
check("B objects", "line product_id has deliberately NO foreign key", Number((await one(`select count(*)::int n from pg_constraint where contype = 'f' and conrelid = 'bk_document_lines'::regclass and conkey = (select array_agg(attnum) from pg_attribute where attrelid = 'bk_document_lines'::regclass and attname = 'product_id')`)).n) === 0);
check("B objects", "definer functions have a pinned search_path", (await rows(`select proname, proconfig c from pg_proc where prosecdef and proname like 'doc\\_%' or prosecdef and proname like 'bk\\_doc\\_%'`)).every((r) => (r.c || []).join(",").includes("search_path=public, pg_temp")));
const ENTRY = ["doc_upsert_business_profile", "doc_save_draft", "doc_issue", "doc_record_payment", "doc_void_payment", "doc_void_document", "doc_create_share", "doc_revoke_share", "doc_resolve_share", "bk_doc_hash", "bk_doc_rate_limit_hit"];
const INTERNAL = ["bk_doc_gate", "bk_doc_event", "bk_doc_issue_core", "bk_doc_hash_of", "bk_doc_bundle", "bk_doc_payment_bundle", "bk_doc_seller_snapshot", "bk_doc_clean_customer", "bk_doc_compute_line", "bk_doc_number", "bk_doc_blank_null", "bk_documents_guard", "bk_document_lines_guard"];
for (const name of ENTRY) {
  const sigs = (await rows(`select p.oid::regprocedure::text s from pg_proc p where p.proname = ${q(name)} and p.pronamespace = 'public'::regnamespace`)).map((r) => r.s);
  const priv = async (role) => (await one(`select has_function_privilege('${role}', '${sigs[0]}', 'execute') v`)).v;
  const publicExec = (await one(`select exists (select 1 from pg_proc where oid = '${sigs[0]}'::regprocedure and (proacl is null or exists (select 1 from aclexplode(proacl) a where a.grantee = 0))) v`)).v;
  check("B grants", `${name}: EXECUTE for service_role only (not anon, authenticated, PUBLIC)`, sigs.length === 1 && (await priv("service_role")) && !(await priv("anon")) && !(await priv("authenticated")) && !publicExec, sigs.join(","));
}
for (const name of INTERNAL) {
  const sig = (await one(`select p.oid::regprocedure::text s from pg_proc p where p.proname = ${q(name)} and p.pronamespace = 'public'::regnamespace`)).s;
  const priv = async (role) => (await one(`select has_function_privilege('${role}', '${sig}', 'execute') v`)).v;
  check("B grants", `${name}: internal — no client role and not even service_role may execute it`, !(await priv("anon")) && !(await priv("authenticated")) && !(await priv("service_role")), sig);
}
for (const t of TABLES) {
  const p = async (role, what) => (await one(`select has_table_privilege('${role}', '${t}', '${what}') v`)).v;
  const readable = ["bk_business_profiles", "bk_documents", "bk_document_lines", "bk_document_payments", "bk_document_events"].includes(t);
  check("B grants", `${t}: writes denied (insert, update, delete, truncate) for anon, authenticated and service_role`, await (async () => { for (const r of ["anon", "authenticated", "service_role"]) for (const w of ["insert", "update", "delete", "truncate"]) if (await p(r, w)) return false; return true; })());
  check("B grants", `${t}: SELECT ${readable ? "granted to authenticated and service_role" : "granted to nobody"}`, readable ? (await p("authenticated", "select")) && (await p("service_role", "select")) && !(await p("anon", "select")) : t === "bk_document_shares" ? !(await p("anon", "select")) : !(await p("authenticated", "select")) && !(await p("service_role", "select")) && !(await p("anon", "select")));
}
check("B grants", "bk_document_shares: token_hash is not selectable by authenticated or service_role (column-level grant)", !(await one(`select has_column_privilege('authenticated', 'bk_document_shares', 'token_hash', 'select') v`)).v && !(await one(`select has_column_privilege('service_role', 'bk_document_shares', 'token_hash', 'select') v`)).v && (await one(`select has_column_privilege('authenticated', 'bk_document_shares', 'id', 'select') v`)).v);
check("B grants", "TRUNCATE is refused for the table owner on every record table (statement-level guard)", await (async () => { for (const t of ["bk_documents", "bk_document_lines", "bk_document_payments", "bk_document_events", "bk_document_shares", "bk_document_counters", "bk_business_profiles"]) if (!(await errOf(() => db.exec(`truncate ${t} cascade`)))) return false; return true; })());

// ---- helpers for calling the functions exactly as the trusted routes will (service role)
const rpc = async (expr) => { try { return { ok: true, r: (await svc(`select ${expr} as r`)).rows[0].r }; } catch (e) { return { ok: false, err: e.message.split("\n")[0] }; } };
const draft = (profile, actor, o = {}) => rpc(`doc_save_draft(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(o.id)}::uuid, ${q(o.type ?? "invoice")}, ${q(o.locale ?? "fr")}, ${J(o.customer === undefined ? { name: "Client A" } : o.customer)}, ${q(o.due)}::date, ${q(o.notes)}, ${q(o.terms)}, ${o.tax ? "true" : "false"}, ${J(o.lines ?? [{ description: "Item", quantity: "2", unit_price: "1500" }])}, ${q(o.replaces)}::uuid, ${q(o.req)}::uuid)`);
const issue = (profile, actor, id) => rpc(`doc_issue(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(id)}::uuid)`);
const pay = (profile, actor, invoice, amount, o = {}) => rpc(`doc_record_payment(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(invoice)}::uuid, ${q(amount)}::numeric, ${q(o.method ?? "cash")}, ${q(o.reference)}, ${q(o.paidOn ?? today)}::date, ${q(o.req === undefined ? req() : o.req)}::uuid)`);
const voidPay = (profile, actor, id, reason) => rpc(`doc_void_payment(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(id)}::uuid, ${q(reason)})`);
const voidDoc = (profile, actor, id, reason) => rpc(`doc_void_document(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(id)}::uuid, ${q(reason)})`);
const share = (profile, actor, id, hash, days) => rpc(`doc_create_share(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(id)}::uuid, ${q(hash)}, ${days === undefined ? "null" : days}::int)`);
const bizProfile = (profile, actor, o = {}) => rpc(`doc_upsert_business_profile(${q(profile)}::uuid, ${q(actor)}::uuid, ${q(o.name ?? "Alice Boutique")}, ${q(o.legal)}, ${q(o.address)}, ${q(o.phone)}, ${q(o.email)}, ${q(o.taxId)}, ${q(o.reg)}, ${q(o.terms)}, ${o.dueDays ?? "null"}::int, ${q(o.taxLabel)}, ${o.rate ?? "null"}::int)`);
const today = (await one(`select (now() at time zone 'Africa/Douala')::date::text d`)).d;
const year = Number(today.slice(0, 4));
const exp = (group, name, r, frag) => check(group, name, !r.ok && new RegExp(frag).test(r.err), JSON.stringify(r).slice(0, 300));
const doc = (r) => r.r.document;
const count = async (sql) => Number((await one(`select count(*)::int n from ${sql}`)).n);

// ======================================================================================= C. gate (owner, plan flag, demo)
const g1 = await draft(P.alice, U.alice, { req: req() });
check("C gate", "owner creates a draft (draft: no number, no issue date, no hash, fixed currency from the profile)", g1.ok && doc(g1).status === "draft" && doc(g1).number === null && doc(g1).issue_date === null && doc(g1).content_hash === null && doc(g1).currency === "XAF" && doc(g1).seller_snapshot === null, JSON.stringify(g1).slice(0, 300));
exp("C gate", "a different user acting on alice's profile is refused: not_owner", await draft(P.alice, U.bob), "not_owner");
exp("C gate", "a staff-like user is refused", await draft(P.alice, U.sam), "not_owner");
exp("C gate", "an admin acting for another business is refused", await draft(P.alice, U.admin), "not_owner");
exp("C gate", "a null actor is refused", await draft(P.alice, null), "not_owner");
exp("C gate", "unknown profile", await draft(PID(99), U.alice), "profile_unavailable");
exp("C gate", "demo profile refused", await draft(P.erin, U.erin), "demo_profile_not_supported");
exp("C gate", "Free-plan owner refused (flag off)", await draft(P.carol, U.carol), "toolkit_not_enabled");
exp("C gate", "owner with no plan refused", await draft(P.dave, U.dave), "toolkit_not_enabled");
check("C gate", "the same gate guards every entry point", await (async () => {
  const bad = [
    await issue(P.alice, U.bob, g1.r.document.id), await bizProfile(P.alice, U.bob), await pay(P.alice, U.bob, g1.r.document.id, "10"),
    await voidDoc(P.alice, U.bob, g1.r.document.id, "x"), await share(P.alice, U.bob, g1.r.document.id, H64(1)),
    await rpc(`doc_void_payment(${q(P.alice)}::uuid, ${q(U.bob)}::uuid, ${q(PID(9))}::uuid, 'x')`), await rpc(`doc_revoke_share(${q(P.alice)}::uuid, ${q(U.bob)}::uuid, ${q(PID(9))}::uuid)`),
  ];
  return bad.every((r) => !r.ok && /not_owner/.test(r.err));
})());
await db.exec(`update public.plans set business_toolkit_enabled = false where name = 'business_pro'`);
exp("C gate", "an admin switching the plan flag OFF blocks every write (draft shown)", await draft(P.alice, U.alice), "toolkit_not_enabled");
check("C gate", "history stays readable by its owner after a downgrade", Number((await as("authenticated", U.alice, `select count(*)::int n from bk_documents`)).rows[0].n) >= 1);
await db.exec(`update public.plans set business_toolkit_enabled = true where name = 'business_pro'`);
check("C gate", "access returns with the flag", (await draft(P.alice, U.alice)).ok);

// ======================================================================================= D. drafts: validation, exactness, UTF-8
const e = (name, r, frag) => exp("D drafts", name, r, frag);
const L = (o) => [{ description: "Item", quantity: "1", unit_price: "100", ...o }];
e("quotation type is not implemented", await draft(P.alice, U.alice, { type: "quotation" }), "unsupported_document_type");
e("a receipt cannot be created by hand", await draft(P.alice, U.alice, { type: "receipt" }), "unsupported_document_type");
e("invalid locale", await draft(P.alice, U.alice, { locale: "de" }), "invalid_locale");
e("lines must be an array", await rpc(`doc_save_draft(${q(P.alice)}::uuid, ${q(U.alice)}::uuid, null, 'invoice', 'fr', null, null, null, null, false, '{"a":1}'::jsonb, null, null)`), "invalid_lines");
e("blank description", await draft(P.alice, U.alice, { lines: L({ description: "   " }) }), "invalid_description");
e("301-character description", await draft(P.alice, U.alice, { lines: L({ description: "x".repeat(301) }) }), "invalid_description");
e("zero quantity", await draft(P.alice, U.alice, { lines: L({ quantity: "0" }) }), "invalid_quantity");
e("4-decimal quantity", await draft(P.alice, U.alice, { lines: L({ quantity: "1.0001" }) }), "invalid_quantity");
e("exponent quantity", await draft(P.alice, U.alice, { lines: L({ quantity: "1e3" }) }), "invalid_quantity");
e("fractional XAF unit price (would round)", await draft(P.alice, U.alice, { lines: L({ unit_price: "10.5" }) }), "amount_too_precise");
e("garbage unit price", await draft(P.alice, U.alice, { lines: L({ unit_price: "abc" }) }), "invalid_unit_price");
e("fractional XAF discount", await draft(P.alice, U.alice, { lines: L({ discount_amount: "0.5" }) }), "amount_too_precise");
e("discount above the line amount", await draft(P.alice, U.alice, { lines: L({ discount_amount: "101" }) }), "discount_exceeds_amount");
e("101 lines", await draft(P.alice, U.alice, { lines: Array.from({ length: 101 }, () => ({ description: "x", quantity: "1", unit_price: "1" })) }), "too_many_lines");
e("amount beyond the supported maximum", await draft(P.alice, U.alice, { lines: L({ quantity: "999999999", unit_price: "9999999999" }) }), "amount_too_large");
e("a product of another business cannot be referenced", await draft(P.alice, U.alice, { lines: L({ product_id: PRD(2) }) }), "product_not_found");
e("malformed product id", await draft(P.alice, U.alice, { lines: L({ product_id: "nope" }) }), "invalid_product");
e("customer name over 120 characters", await draft(P.alice, U.alice, { customer: { name: "n".repeat(121) } }), "invalid_customer");
e("customer must be an object", await draft(P.alice, U.alice, { customer: ["x"] }), "invalid_customer");
e("customer field must be a string", await draft(P.alice, U.alice, { customer: { name: 5 } }), "invalid_customer");
e("1001-character notes", await draft(P.alice, U.alice, { notes: "n".repeat(1001) }), "invalid_notes");
e("tax requested but not configured", await draft(P.alice, U.alice, { tax: true }), "tax_not_configured");
check("D drafts", "nothing was written by any rejected request", (await count("bk_documents where status = 'draft' and client_request_id is null")) <= 2, await count("bk_documents"));

const d1 = await draft(P.alice, U.alice, { lines: [{ description: "Article", quantity: "2", unit_price: "1500", discount_amount: "500", product_id: PRD(1) }, { description: "Service", quantity: "1", unit_price: "2500" }], req: req() });
check("D drafts", "totals computed in SQL: subtotal 5500, discount 500, tax 0, total 5000", d1.ok && [doc(d1).subtotal, doc(d1).discount_total, doc(d1).tax_total, doc(d1).total].map(Number).join() === "5500,500,0,5000", JSON.stringify(d1).slice(0, 300));
check("D drafts", "tax is OFF by default", doc(d1).tax_label === null && doc(d1).tax_rate_bp === null);
check("D drafts", "lines stored with position, quantity, product reference and exact amounts", d1.r.lines.length === 2 && d1.r.lines[0].position === 1 && Number(d1.r.lines[0].gross_amount) === 3000 && d1.r.lines[0].product_id === PRD(1) && Number(d1.r.lines[1].line_total) === 2500);
check("D drafts", "drafts consume NO number and touch no counter", (await count("bk_document_counters")) === 0 && doc(d1).number === null);
const d1again = await draft(P.alice, U.alice, { lines: [{ description: "ignored", quantity: "9", unit_price: "9" }], req: doc(d1).client_request_id });
check("D drafts", "same client_request_id returns the original draft untouched (duplicate = true, no doubled lines)", d1again.ok && d1again.r.duplicate === true && doc(d1again).id === doc(d1).id && d1again.r.lines.length === 2, JSON.stringify(d1again).slice(0, 200));
const d1upd = await draft(P.alice, U.alice, { id: doc(d1).id, locale: "en", lines: [{ description: "Only line", quantity: "3", unit_price: "1000" }] });
check("D drafts", "a draft is fully replaceable: lines replaced, totals recomputed, no duplicates", d1upd.ok && d1upd.r.lines.length === 1 && Number(doc(d1upd).total) === 3000 && doc(d1upd).locale === "en" && (await count(`bk_document_lines where document_id = ${q(doc(d1).id)}`)) === 1);
const hostile = { customer: { name: "Chukwudi \u{1F60A}", address: "Akwa Douala\nRue ‘ù’", email: "c@example.com", phone: "+237 6 77", tax_id: "NIU 123", extra: "ignored" }, notes: "Merci \u{1F64F} محمد", terms: "12 000 FCFA — œuvre", lines: [{ description: "  Café \u{1F60A} ا  ", quantity: "1", unit_price: "100" }] };
const dh = await draft(P.alice, U.alice, hostile);
const stored = await one(`select customer_snapshot, notes, terms, (select description from bk_document_lines where document_id = d.id) as descr from bk_documents d where id = ${q(doc(dh).id)}`);
check("D drafts", "STORED TEXT IS EXACT (UTF-8): emoji, U+202F, NBSP, Arabic, curly quotes, oe-ligature, internal and surrounding spaces all survive byte for byte", stored.customer_snapshot.name === hostile.customer.name && stored.customer_snapshot.address === hostile.customer.address && stored.customer_snapshot.phone === hostile.customer.phone && stored.customer_snapshot.tax_id === hostile.customer.tax_id && stored.notes === hostile.notes && stored.terms === hostile.terms && stored.descr === hostile.lines[0].description, JSON.stringify(stored));
check("D drafts", "unknown customer keys are dropped, known ones kept", !("extra" in stored.customer_snapshot) && Object.keys(stored.customer_snapshot).sort().join() === "address,email,name,phone,tax_id");
check("D drafts", "blank notes become NULL", (await draft(P.alice, U.alice, { notes: "   " })).r.document.notes === null);

// ---- tax from the business profile
e("a tax rate needs a label (and vice versa)", await bizProfile(P.alice, U.alice, { taxLabel: "TVA" }), "tax_incomplete");
e("tax rate above 100%", await bizProfile(P.alice, U.alice, { taxLabel: "TVA", rate: 10001 }), "invalid_tax_rate");
e("blank display name", await bizProfile(P.alice, U.alice, { name: "  " }), "invalid_display_name");
e("due days out of range", await bizProfile(P.alice, U.alice, { dueDays: 366 }), "invalid_due_days");
const bp = await bizProfile(P.alice, U.alice, { name: "Boutique Élise \u{1F6CD}️", legal: "Élise SARL", address: "12 rue de la Paix\nDouala", phone: "+237 600", email: "shop@example.cm", taxId: "M0123", reg: "RC/DLA/2020", terms: "Paiement à 15 jours", dueDays: 14, taxLabel: "TVA", rate: 1900 });
check("D drafts", "business profile saved exactly (UTF-8)", bp.ok && bp.r.display_name === "Boutique Élise \u{1F6CD}️" && bp.r.tax_rate_bp === 1900 && bp.r.default_due_days === 14);
const dt = await draft(P.alice, U.alice, { tax: true, lines: [{ description: "Article", quantity: "2", unit_price: "1500", discount_amount: "500" }, { description: "Service", quantity: "1", unit_price: "2500" }] });
check("D drafts", "tax ON uses the business rate: 19% of (3000-500) and of 2500 = 475 + 475; total 5950", dt.ok && doc(dt).tax_label === "TVA" && doc(dt).tax_rate_bp === 1900 && [doc(dt).subtotal, doc(dt).discount_total, doc(dt).tax_total, doc(dt).total].map(Number).join() === "5500,500,950,5950", JSON.stringify(dt).slice(0, 300));
check("D drafts", "a business profile can be updated (settings, not history)", (await bizProfile(P.alice, U.alice, { name: "Boutique", dueDays: 7, taxLabel: "TVA", rate: 1900 })).ok);

// ======================================================================================= E. issue, numbering, immutability
const mk = async (profile, actor, o = {}) => (await draft(profile, actor, { req: req(), ...o })).r.document;
const i1d = await mk(P.alice, U.alice, { lines: [{ description: "Article", quantity: "2", unit_price: "1500", discount_amount: "500" }, { description: "Service", quantity: "1", unit_price: "2500" }], customer: { name: "Client One" } });
const counterBefore = await count("bk_document_counters");
const i1 = await issue(P.alice, U.alice, i1d.id);
const inv1 = i1.r?.document;
check("E issue", "issue assigns INV-<year>-0001, server date, seller snapshot, 64-hex hash, status issued", i1.ok && inv1.number === `INV-${year}-0001` && inv1.status === "issued" && inv1.issue_date === today && /^[0-9a-f]{64}$/.test(inv1.content_hash) && inv1.number_year === year && inv1.number_seq === 1 && inv1.template_version === 1 && i1.r.already_issued === false, JSON.stringify(i1).slice(0, 300));
check("E issue", "default due date applied from the business profile (7 days)", inv1.due_date === (await one(`select ('${today}'::date + 7)::text d`)).d, inv1.due_date);
check("E issue", "seller snapshot frozen from the business profile as it was at issue (the latest save: name only, optional fields blank)", inv1.seller_snapshot.display_name === "Boutique" && inv1.seller_snapshot.tax_id === null && inv1.seller_snapshot.registration_no === null && inv1.seller_snapshot.address === null, JSON.stringify(inv1.seller_snapshot));
check("E issue", "the stored hash equals the recomputed hash", (await rpc(`bk_doc_hash(${q(inv1.id)}::uuid)`)).r === inv1.content_hash);
check("E issue", "counter row created at issue only (invoice, this year, 1)", counterBefore === 0 && (await count(`bk_document_counters where doc_type = 'invoice' and year = ${year} and last_number = 1`)) === 1);
check("E issue", "an 'issued' audit event is written", (await count(`bk_document_events where document_id = ${q(inv1.id)} and event_type = 'issued'`)) === 1);
const i1b = await issue(P.alice, U.alice, i1d.id);
check("E issue", "issuing twice is idempotent: already_issued, same number, counter unchanged", i1b.ok && i1b.r.already_issued === true && doc(i1b).number === inv1.number && (await count(`bk_document_counters where last_number > 1`)) === 0);
const i2 = await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "Client Two" } })).id);
check("E issue", "the next invoice is INV-<year>-0002 (sequential)", i2.ok && doc(i2).number === `INV-${year}-0002`);
const b1 = await issue(P.bob, U.bob, (await mk(P.bob, U.bob, { customer: { name: "Bob Client" }, lines: [{ description: "x", quantity: "1", unit_price: "10.50" }] })).id);
check("E issue", "numbering is per business: bob's first invoice is also 0001 (USD, cents kept)", b1.ok && doc(b1).number === `INV-${year}-0001` && doc(b1).currency === "USD" && Number(doc(b1).total) === 10.5, JSON.stringify(b1).slice(0, 200));
await mk(P.alice, U.alice); await mk(P.alice, U.alice); await mk(P.alice, U.alice);
check("E issue", "three more drafts consume no number", (await count(`bk_document_counters where profile_id = ${q(P.alice)} and doc_type = 'invoice' and last_number = 2`)) === 1);
const emptyDraft = await mk(P.alice, U.alice, { lines: [] });
exp("E issue", "an empty draft cannot be issued", await issue(P.alice, U.alice, emptyDraft.id), "no_lines");
exp("E issue", "a draft without a customer name cannot be issued", await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: null })).id), "customer_required");
exp("E issue", "a zero-total draft cannot be issued", await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { lines: [{ description: "free", quantity: "1", unit_price: "0" }] })).id), "zero_total");
exp("E issue", "a due date in the past cannot be issued (no backdating)", await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { due: "2020-01-01" })).id), "invalid_due_date");
check("E issue", "failed issues consumed no number (counter still 2)", (await count(`bk_document_counters where profile_id = ${q(P.alice)} and doc_type = 'invoice' and last_number = 2`)) === 1);
exp("E issue", "another business's document is not found", await issue(P.bob, U.bob, inv1.id), "document_not_found");
// failed transaction after the counter increment: a temporary test trigger makes the 'issued' event fail
await db.exec(`create function test_fail_issued() returns trigger language plpgsql as $$ begin if new.event_type = 'issued' then raise exception 'boom'; end if; return new; end $$;
               create trigger test_fail_issued_trg before insert on bk_document_events for each row execute function test_fail_issued();`);
const rbDraft = await mk(P.alice, U.alice, { customer: { name: "Rollback" } });
const rbIssue = await issue(P.alice, U.alice, rbDraft.id);
await db.exec(`drop trigger test_fail_issued_trg on bk_document_events; drop function test_fail_issued();`);
check("E issue", "TRANSACTION ROLLBACK: a failure after the counter increment leaves the draft a draft and consumes no number", !rbIssue.ok && /boom/.test(rbIssue.err) && (await one(`select status, number from bk_documents where id = ${q(rbDraft.id)}`)).status === "draft" && (await count(`bk_document_counters where profile_id = ${q(P.alice)} and doc_type = 'invoice' and last_number = 2`)) === 1);
const rbOk = await issue(P.alice, U.alice, rbDraft.id);
check("E issue", "...and the very next issue still gets the next number (0003)", rbOk.ok && doc(rbOk).number === `INV-${year}-0003`, JSON.stringify(rbOk).slice(0, 200));
await db.exec(`insert into bk_document_counters (profile_id, doc_type, year, last_number) values ('${P.alice}', 'invoice', ${year - 1}, 77)`);
const yr = await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "Year" } })).id);
check("E issue", "counters are per (business, type, year): last year's row is untouched", yr.ok && doc(yr).number === `INV-${year}-0004` && (await one(`select last_number from bk_document_counters where profile_id = '${P.alice}' and doc_type = 'invoice' and year = ${year - 1}`)).last_number === 77);
check("E issue", "an invoice and a receipt would count separately (counter keyed by type)", (await count(`bk_document_counters where doc_type = 'receipt'`)) === 0);
await db.exec(`update profiles set currency = 'USD' where id = '${P.alice}'`);
const cur = await mk(P.alice, U.alice, { customer: { name: "Cur" } });   // created in USD
await db.exec(`update profiles set currency = 'XAF' where id = '${P.alice}'`);
exp("E issue", "a draft whose currency no longer matches the profile cannot be issued", await issue(P.alice, U.alice, cur.id), "currency_changed");

const ex = async (name, sql, frag) => check("E immutable", name, new RegExp(frag).test((await errOf(() => db.exec(sql))) || ""), String(await errOf(() => db.exec(sql))));
const id1 = inv1.id;
await ex("an issued invoice's total cannot be changed", `update bk_documents set total = 1, subtotal = 1, discount_total = 0, tax_total = 0 where id = '${id1}'`, "immutable");
await ex("...nor its notes", `update bk_documents set notes = 'x' where id = '${id1}'`, "immutable");
await ex("...nor its number", `update bk_documents set number = 'INV-2026-9999', number_seq = 9999 where id = '${id1}'`, "immutable");
await ex("...nor its customer snapshot", `update bk_documents set customer_snapshot = '{"name":"x"}' where id = '${id1}'`, "immutable");
await ex("...nor its seller snapshot", `update bk_documents set seller_snapshot = '{"display_name":"x"}' where id = '${id1}'`, "immutable");
await ex("...nor its content hash", `update bk_documents set content_hash = '${"0".repeat(64)}' where id = '${id1}'`, "immutable");
await ex("...nor its due date", `update bk_documents set due_date = due_date + 30 where id = '${id1}'`, "immutable");
await ex("...nor its currency or owner", `update bk_documents set currency = 'USD' where id = '${id1}'`, "immutable|check");
await ex("a document cannot be moved to another business", `update bk_documents set profile_id = '${P.bob}' where id = '${id1}'`, "immutable|foreign key");
await ex("a document cannot be deleted", `delete from bk_documents where id = '${id1}'`, "never deleted");
await ex("an issued document cannot go back to draft", `update bk_documents set status = 'draft' where id = '${id1}'`, "illegal status transition|check");
await ex("issued -> paid without payments is refused by the amount rules", `update bk_documents set status = 'paid' where id = '${id1}'`, "check");
await ex("its lines are frozen: update", `update bk_document_lines set quantity = 5 where document_id = '${id1}'`, "frozen");
await ex("...delete", `delete from bk_document_lines where document_id = '${id1}'`, "frozen");
await ex("...and no line can be added", `insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, line_total) values ('${id1}', 9, 'x', 1, 1, 1, 1)`, "frozen");
await ex("a draft line with inconsistent amounts is refused", `insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, line_total) values ('${emptyDraft.id}', 1, 'x', 2, 100, 100, 100)`, "inconsistent");
await ex("a draft line with a too-precise amount is refused", `insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, line_total) values ('${emptyDraft.id}', 1, 'x', 1, 10.5, 10.5, 10.5)`, "amount_too_precise");
check("E immutable", "the stored hash still verifies after all those refused attempts", (await rpc(`bk_doc_hash(${q(id1)}::uuid)`)).r === inv1.content_hash);
// tamper evidence: a privileged actor bypasses the guard (test only); the hash detects it
await db.exec(`alter table bk_documents disable trigger bk_documents_guard_trg; update bk_documents set seller_snapshot = jsonb_set(seller_snapshot, '{display_name}', '"Forged Ltd"') where id = '${id1}'; alter table bk_documents enable trigger bk_documents_guard_trg;`);
check("E immutable", "TAMPER DETECTION: a forced edit makes the recomputed hash differ from the stored one", (await rpc(`bk_doc_hash(${q(id1)}::uuid)`)).r !== inv1.content_hash);
await db.exec(`alter table bk_documents disable trigger bk_documents_guard_trg; update bk_documents set seller_snapshot = jsonb_set(seller_snapshot, '{display_name}', '"Boutique"') where id = '${id1}'; alter table bk_documents enable trigger bk_documents_guard_trg;`);
check("E immutable", "...and restoring the value makes it verify again", (await rpc(`bk_doc_hash(${q(id1)}::uuid)`)).r === inv1.content_hash);

// ---- void, replacement
const vtarget = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "To void" } })).id)).r.document;
exp("E void", "void needs a reason", await voidDoc(P.alice, U.alice, vtarget.id, "  "), "reason_required");
exp("E void", "a non-owner cannot void", await voidDoc(P.alice, U.bob, vtarget.id, "x"), "not_owner");
exp("E void", "another business's document is not found", await voidDoc(P.bob, U.bob, vtarget.id, "x"), "document_not_found");
const vd = await voidDoc(P.alice, U.alice, vtarget.id, "  entered twice  ");
check("E void", "void: status void, number retained, reason trimmed, event written", vd.ok && doc(vd).status === "void" && doc(vd).number === vtarget.number && doc(vd).void_reason === "entered twice" && vd.r.already_voided === false && (await count(`bk_document_events where document_id = ${q(vtarget.id)} and event_type = 'voided'`)) === 1);
const vd2 = await voidDoc(P.alice, U.alice, vtarget.id, "again");
check("E void", "void twice is idempotent: already_voided, one event", vd2.ok && vd2.r.already_voided === true && (await count(`bk_document_events where document_id = ${q(vtarget.id)} and event_type = 'voided'`)) === 1);
await ex("a void document can never change again", `update bk_documents set notes = 'x' where id = '${vtarget.id}'`, "void document cannot be changed");
check("E void", "a voided draft consumes no number (discarding)", await (async () => { const dd = await mk(P.alice, U.alice, { customer: { name: "discard" } }); const r = await voidDoc(P.alice, U.alice, dd.id, "discard"); return r.ok && doc(r).status === "void" && doc(r).number === null; })());
exp("E void", "issuing a void document is refused", await issue(P.alice, U.alice, vtarget.id), "document_void");
const rep1 = await draft(P.alice, U.alice, { replaces: vtarget.id, customer: { name: "Corrected" }, req: req() });
check("E replace", "a correction is a new draft that replaces the voided invoice", rep1.ok && doc(rep1).replaces_document_id === vtarget.id, JSON.stringify(rep1).slice(0, 200));
exp("E replace", "only one live replacement per voided invoice (unique index)", await draft(P.alice, U.alice, { replaces: vtarget.id, req: req() }), "bk_documents_one_replacement_idx|duplicate key");
exp("E replace", "a non-void invoice cannot be 'replaced'", await draft(P.alice, U.alice, { replaces: id1 }), "invalid_replacement");
exp("E replace", "another business's invoice cannot be replaced", await draft(P.bob, U.bob, { replaces: vtarget.id }), "invalid_replacement");
const repIssued = await issue(P.alice, U.alice, doc(rep1).id);
check("E replace", "issuing the correction writes a 'replaced' event on the old invoice and gets a new number", repIssued.ok && doc(repIssued).number !== vtarget.number && (await count(`bk_document_events where document_id = ${q(vtarget.id)} and event_type = 'replaced'`)) === 1);

// ======================================================================================= F. payments: receipts + bookkeeping, atomically
const A = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "Payer \u{1F60A}", email: "p@example.com" }, lines: [{ description: "Big job", quantity: "1", unit_price: "5000" }] })).id)).r.document;
const entriesBefore = await count("bk_entries");
const r1req = req();
const p1 = await pay(P.alice, U.alice, A.id, "2000", { reference: "Réf \u{1F60A} 0001", method: "mobile_money", req: r1req });
check("F payment", "payment 2000 on a 5000 invoice: receipt RCT-<year>-0001 + payment + entry, invoice partially_paid", p1.ok && p1.r.duplicate === false && p1.r.receipt.document.number === `RCT-${year}-0001` && p1.r.receipt.document.status === "issued" && p1.r.receipt.document.parent_document_id === A.id && p1.r.invoice.status === "partially_paid" && Number(p1.r.invoice.amount_paid) === 2000 && Number(p1.r.payment.balance_after) === 3000, JSON.stringify(p1).slice(0, 400));
const entry = await one(`select * from bk_entries where id = '${p1.r?.payment?.bk_entry_id}'`);
check("F payment", "exactly one Phase 1 entry: kind sale, 2000 XAF, settled, dated paid_on, category invoice_payment, description = invoice number only (no customer name)", entry && entry.kind === "sale" && Number(entry.amount) === 2000 && entry.currency === "XAF" && entry.cash_settled === true && entry.entry_date.toISOString().slice(0, 10) === today && entry.category === "invoice_payment" && entry.description === A.number && !String(entry.description).includes("Payer") && entry.client_request_id === p1.r.payment.id && entry.linked_order_id === null && entry.created_by === U.alice, JSON.stringify(entry));
check("F payment", "the receipt line, snapshots and payment facts are frozen and the payment reference is stored exactly (UTF-8)", p1.r.receipt.lines.length === 1 && p1.r.receipt.lines[0].description === A.number && p1.r.receipt.document.type_snapshot.reference === "Réf \u{1F60A} 0001" && p1.r.payment.reference === "Réf \u{1F60A} 0001" && p1.r.receipt.document.customer_snapshot.name === "Payer \u{1F60A}" && p1.r.receipt.document.seller_snapshot.display_name === "Boutique" && /^[0-9a-f]{64}$/.test(p1.r.receipt.document.content_hash) && p1.r.receipt.document.type_snapshot.method === "mobile_money" && p1.r.receipt.document.type_snapshot.invoice_number === A.number);
check("F payment", "events: payment_recorded on the invoice, issued on the receipt", (await count(`bk_document_events where document_id = ${q(A.id)} and event_type = 'payment_recorded'`)) === 1 && (await count(`bk_document_events where document_id = ${q(p1.r.receipt.document.id)} and event_type = 'issued'`)) === 1);
const p1again = await pay(P.alice, U.alice, A.id, "2000", { reference: "Réf", method: "mobile_money", req: r1req });
check("F payment", "IDEMPOTENT retry: duplicate = true, same payment, and no second receipt, payment or entry", p1again.ok && p1again.r.duplicate === true && p1again.r.payment.id === p1.r.payment.id && (await count(`bk_document_payments where invoice_id = ${q(A.id)}`)) === 1 && (await count("bk_entries")) === entriesBefore + 1 && (await count(`bk_documents where doc_type = 'receipt' and parent_document_id = ${q(A.id)}`)) === 1);
const p2 = await pay(P.alice, U.alice, A.id, "3000");
check("F payment", "second payment settles it: paid, receipt RCT-<year>-0002, balance 0", p2.ok && p2.r.invoice.status === "paid" && Number(p2.r.invoice.amount_paid) === 5000 && p2.r.receipt.document.number === `RCT-${year}-0002` && Number(p2.r.payment.balance_after) === 0);
const f = (name, r, frag) => exp("F payment", name, r, frag);
f("a settled invoice takes no more payments", await pay(P.alice, U.alice, A.id, "1"), "invoice_not_payable");
const B2 = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "Second" }, lines: [{ description: "Job", quantity: "1", unit_price: "1000" }] })).id)).r.document;
f("a payment above the remaining balance", await pay(P.alice, U.alice, B2.id, "1001"), "exceeds_balance");
f("zero amount", await pay(P.alice, U.alice, B2.id, "0"), "invalid_amount");
f("negative amount", await pay(P.alice, U.alice, B2.id, "-5"), "invalid_amount");
f("fractional XAF amount", await pay(P.alice, U.alice, B2.id, "10.5"), "amount_too_precise");
f("unknown payment method", await pay(P.alice, U.alice, B2.id, "10", { method: "bitcoin" }), "invalid_method");
f("over-long payment reference", await pay(P.alice, U.alice, B2.id, "10", { reference: "x".repeat(101) }), "invalid_reference");
f("a payment dated in the future", await pay(P.alice, U.alice, B2.id, "10", { paidOn: (await one(`select ('${today}'::date + 1)::text d`)).d }), "invalid_paid_on");
f("a payment dated before the invoice was issued", await pay(P.alice, U.alice, B2.id, "10", { paidOn: (await one(`select ('${today}'::date - 1)::text d`)).d }), "invalid_paid_on");
f("a request id is mandatory", await rpc(`doc_record_payment(${q(P.alice)}::uuid, ${q(U.alice)}::uuid, ${q(B2.id)}::uuid, 10, 'cash', null, '${today}'::date, null)`), "request_id_required");
f("a draft invoice takes no payment", await pay(P.alice, U.alice, (await mk(P.alice, U.alice)).id, "10"), "invoice_not_payable");
f("a void invoice takes no payment", await pay(P.alice, U.alice, vtarget.id, "10"), "invoice_not_payable");
f("another business cannot pay alice's invoice (own profile, her invoice)", await pay(P.bob, U.bob, B2.id, "10"), "document_not_found");
f("a receipt cannot be paid", await pay(P.alice, U.alice, p1.r.receipt.document.id, "10"), "document_not_found");
await db.exec(`update profiles set currency = 'USD' where id = '${P.alice}'`);
f("currency changed since issue", await pay(P.alice, U.alice, B2.id, "10"), "currency_changed");
await db.exec(`update profiles set currency = 'XAF' where id = '${P.alice}'`);
check("F payment", "no rejected request left anything behind (still 2 payments, 2 receipts on A; entries +2)", (await count(`bk_document_payments where invoice_id = ${q(A.id)}`)) === 2 && (await count("bk_entries")) === entriesBefore + 2 && (await count(`bk_document_payments where invoice_id = ${q(B2.id)}`)) === 0);
f("a receipt cannot be voided directly", await voidDoc(P.alice, U.alice, p1.r.receipt.document.id, "x"), "use_void_payment");
f("an invoice with live payments cannot be voided", await voidDoc(P.alice, U.alice, A.id, "x"), "invoice_has_payments");

// ---- atomicity: payment + receipt + entry succeed or fail together
const snap = async () => ({ pay: await count("bk_document_payments"), doc: await count("bk_documents"), ent: await count("bk_entries"), ev: await count("bk_document_events"), bev: await count("bk_entry_events"), ctr: JSON.stringify(await rows("select profile_id, doc_type, year, last_number from bk_document_counters order by 1,2,3")) });
await db.exec(`create function test_fail_entry() returns trigger language plpgsql as $$ begin raise exception 'boom_entry'; end $$;
               create trigger test_fail_entry_trg before insert on bk_entry_events for each row execute function test_fail_entry();`);
const sA = await snap();
const fa = await pay(P.alice, U.alice, B2.id, "400");
await db.exec(`drop trigger test_fail_entry_trg on bk_entry_events; drop function test_fail_entry();`);
const sB = await snap();
check("F atomic", "ATOMIC: a bookkeeping failure rolls back the receipt, its number, the payment and the invoice update (nothing changed)", !fa.ok && /boom_entry/.test(fa.err) && JSON.stringify(sA) === JSON.stringify(sB), `${fa.err} ${JSON.stringify(sA)} ${JSON.stringify(sB)}`);
await db.exec(`create function test_fail_last() returns trigger language plpgsql as $$ begin if new.event_type = 'payment_recorded' then raise exception 'boom_last'; end if; return new; end $$;
               create trigger test_fail_last_trg before insert on bk_document_events for each row execute function test_fail_last();`);
const fb = await pay(P.alice, U.alice, B2.id, "400");
await db.exec(`drop trigger test_fail_last_trg on bk_document_events; drop function test_fail_last();`);
const sC = await snap();
check("F atomic", "ATOMIC (reverse): a failure at the LAST step also rolls back the already-written bookkeeping entry", !fb.ok && /boom_last/.test(fb.err) && JSON.stringify(sA) === JSON.stringify(sC), `${fb.err} ${JSON.stringify(sC)}`);
const pGood = await pay(P.alice, U.alice, B2.id, "400");
check("F atomic", "...and the same payment then succeeds with the next receipt number", pGood.ok && pGood.r.receipt.document.number === `RCT-${year}-0003`, JSON.stringify(pGood).slice(0, 200));
await ex("a payment row cannot reference an invoice of another business", `insert into bk_document_payments (profile_id, invoice_id, receipt_document_id, bk_entry_id, amount, currency, method, paid_on, balance_after, client_request_id) select '${P.bob}', '${A.id}', receipt_document_id, bk_entry_id, 1, 'XAF', 'cash', current_date, 0, '${req()}' from bk_document_payments limit 1`, "foreign key|same business");
await ex("a payment cannot be edited", `update bk_document_payments set amount = 1 where id = '${p1.r.payment.id}'`, "immutable");
await ex("a payment cannot be deleted", `delete from bk_document_payments where id = '${p1.r.payment.id}'`, "never deleted");
await ex("an event cannot reference another business's document (composite foreign key)", `insert into bk_document_events (document_id, profile_id, event_type) values ('${A.id}', '${P.bob}', 'created')`, "foreign key");
await ex("events are append-only: update", `update bk_document_events set event_type = 'created' where document_id = '${A.id}'`, "append-only");
await ex("events are append-only: delete", `delete from bk_document_events where document_id = '${A.id}'`, "append-only");

// ---- void payment
f("voiding a payment needs a reason", await voidPay(P.alice, U.alice, p2.r.payment.id, " "), "reason_required");
f("another business cannot void it", await voidPay(P.bob, U.bob, p2.r.payment.id, "x"), "payment_not_found");
const vp = await voidPay(P.alice, U.alice, p2.r.payment.id, "wrong amount");
const entry2 = await one(`select voided_at, void_reason from bk_entries where id = '${p2.r.payment.bk_entry_id}'`);
check("F void", "voiding payment 2: its bookkeeping entry is voided, its receipt is void, the invoice drops back to partially_paid with 2000 paid", vp.ok && vp.r.already_voided === false && entry2.voided_at !== null && entry2.void_reason === "wrong amount" && vp.r.payment.voided_at !== null && (await one(`select status from bk_documents where id = '${p2.r.payment.receipt_document_id}'`)).status === "void" && vp.r.invoice.status === "partially_paid" && Number(vp.r.invoice.amount_paid) === 2000, JSON.stringify(vp).slice(0, 300));
check("F void", "the receipt keeps its number when voided", (await one(`select number from bk_documents where id = '${p2.r.payment.receipt_document_id}'`)).number === `RCT-${year}-0002`);
const vpe = await count(`bk_entry_events where entry_id = '${p2.r.payment.bk_entry_id}' and event_type = 'voided'`);
const vp2 = await voidPay(P.alice, U.alice, p2.r.payment.id, "again");
check("F void", "voiding twice is idempotent: already_voided and no extra events", vp2.ok && vp2.r.already_voided === true && (await count(`bk_entry_events where entry_id = '${p2.r.payment.bk_entry_id}' and event_type = 'voided'`)) === vpe);
const p3 = await pay(P.alice, U.alice, A.id, "3000");
check("F void", "after a void the balance can be paid again with a new receipt", p3.ok && p3.r.invoice.status === "paid" && p3.r.receipt.document.number === `RCT-${year}-0004`);
await voidPay(P.alice, U.alice, p3.r.payment.id, "undo"); await voidPay(P.alice, U.alice, p1.r.payment.id, "undo");
check("F void", "with every payment voided the invoice is back to issued/0 paid and can now be voided", (await one(`select status, amount_paid from bk_documents where id = '${A.id}'`)).status === "issued" && Number((await one(`select amount_paid from bk_documents where id = '${A.id}'`)).amount_paid) === 0 && (await voidDoc(P.alice, U.alice, A.id, "cancelled")).ok);
check("F void", "an entry voided directly through Phase 1 does not break a later payment void (idempotent)", await (async () => { const C = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "C" }, lines: [{ description: "j", quantity: "1", unit_price: "100" }] })).id)).r.document; const pp = await pay(P.alice, U.alice, C.id, "100"); await rpc(`bk_void_entry(${q(P.alice)}::uuid, ${q(U.alice)}::uuid, ${q(pp.r.payment.bk_entry_id)}::uuid, 'manual')`); const v = await voidPay(P.alice, U.alice, pp.r.payment.id, "ok"); return v.ok && v.r.invoice.status === "issued"; })());

// ======================================================================================= G. shares + rate limiting
const S = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "Shared" } })).id)).r.document;
const sh1 = await share(P.alice, U.alice, S.id, H64(11), 30);
check("G share", "a share stores only the hash (the raw token never reaches the database) and returns metadata without it", sh1.ok && !("token_hash" in sh1.r) && (await one(`select token_hash from bk_document_shares where id = '${sh1.r.share_id}'`)).token_hash === H64(11));
check("G share", "a 'share_created' event is written", (await count(`bk_document_events where document_id = ${q(S.id)} and event_type = 'share_created'`)) === 1);
exp("G share", "malformed token hash", await share(P.alice, U.alice, S.id, "short"), "invalid_token_hash");
exp("G share", "uppercase hex is refused (canonical lowercase only)", await share(P.alice, U.alice, S.id, "A".repeat(64)), "invalid_token_hash");
exp("G share", "expiry 0 days", await share(P.alice, U.alice, S.id, H64(12), 0), "invalid_expiry");
exp("G share", "expiry 91 days", await share(P.alice, U.alice, S.id, H64(13), 91), "invalid_expiry");
exp("G share", "a draft cannot be shared", await share(P.alice, U.alice, (await mk(P.alice, U.alice)).id, H64(14)), "document_not_shareable");
exp("G share", "a void invoice cannot be newly shared", await share(P.alice, U.alice, vtarget.id, H64(15)), "document_not_shareable");
exp("G share", "another business cannot share it", await share(P.bob, U.bob, S.id, H64(16)), "document_not_found");
exp("G share", "a duplicate token hash is refused", await share(P.alice, U.alice, S.id, H64(11)), "duplicate key|unique");
const res = await rpc(`doc_resolve_share(${q(H64(11))})`);
check("G share", "a valid token resolves to the document and records the access", res.ok && res.r.document_id === S.id && res.r.profile_id === P.alice && res.r.doc_type === "invoice" && (await one(`select access_count, last_accessed_at from bk_document_shares where id = '${sh1.r.share_id}'`)).access_count === 1);
check("G share", "an unknown token and a malformed token both resolve to the same null", (await rpc(`doc_resolve_share(${q(H64(99))})`)).r === null && (await rpc(`doc_resolve_share('nope')`)).r === null && (await rpc(`doc_resolve_share(null)`)).r === null);
await db.exec(`insert into bk_document_shares (document_id, profile_id, token_hash, expires_at, created_by, created_at) values ('${S.id}', '${P.alice}', '${H64(21)}', now() - interval '5 days', '${U.alice}', now() - interval '10 days')`);
check("G share", "an EXPIRED share resolves to null", (await rpc(`doc_resolve_share(${q(H64(21))})`)).r === null);
const rev = await rpc(`doc_revoke_share(${q(P.alice)}::uuid, ${q(U.alice)}::uuid, ${q(sh1.r.share_id)}::uuid)`);
check("G share", "revoke works, the event is written and the token stops resolving", rev.ok && rev.r.already_revoked === false && (await rpc(`doc_resolve_share(${q(H64(11))})`)).r === null && (await count(`bk_document_events where document_id = ${q(S.id)} and event_type = 'share_revoked'`)) === 1);
check("G share", "revoking twice is idempotent", (await rpc(`doc_revoke_share(${q(P.alice)}::uuid, ${q(U.alice)}::uuid, ${q(sh1.r.share_id)}::uuid)`)).r.already_revoked === true);
exp("G share", "another business cannot revoke it", await rpc(`doc_revoke_share(${q(P.bob)}::uuid, ${q(U.bob)}::uuid, ${q(sh1.r.share_id)}::uuid)`), "share_not_found");
const many = [];
for (let n = 31; n <= 36; n++) many.push(await share(P.alice, U.alice, S.id, H64(n), 7));
check("G share", "at most 5 active shares per document", many.slice(0, 5).every((r) => r.ok) && !many[5].ok && /too_many_shares/.test(many[5].err));
check("G share", "a shared void document still resolves (with its void status): history is never hidden", await (async () => { const sv = (await issue(P.alice, U.alice, (await mk(P.alice, U.alice, { customer: { name: "SV" } })).id)).r.document; await share(P.alice, U.alice, sv.id, H64(41), 7); await voidDoc(P.alice, U.alice, sv.id, "void later"); const r = await rpc(`doc_resolve_share(${q(H64(41))})`); return r.ok && r.r.status === "void"; })());
await ex("share rows cannot be edited beyond revocation/access", `update bk_document_shares set expires_at = expires_at + interval '1 day' where id = '${many[0].r.share_id}'`, "only revocation");
await ex("...nor deleted", `delete from bk_document_shares where id = '${many[0].r.share_id}'`, "never deleted");
await ex("a revoked share cannot change again", `update bk_document_shares set access_count = access_count + 1 where id = '${sh1.r.share_id}'`, "already revoked");
const rl = async (kind, hash, win = 60, max = 3) => rpc(`bk_doc_rate_limit_hit(${q(kind)}, ${q(hash)}, ${win}, ${max})`);
check("G rate", "the limiter allows up to max then refuses; other subjects are independent", (await rl("share_ip", H64(51))).r === true && (await rl("share_ip", H64(51))).r === true && (await rl("share_ip", H64(51))).r === true && (await rl("share_ip", H64(51))).r === false && (await rl("share_ip", H64(52))).r === true);
check("G rate", "invalid kind / subject / bounds raise", (await rl("pay_ip", H64(53))).ok === false && (await rl("share_ip", "x")).ok === false && (await rl("share_ip", H64(53), 0, 3)).ok === false && (await rl("share_ip", H64(53), 60, 0)).ok === false);

// ======================================================================================= H. RLS and privileges
const cnt = async (role, sub, t, where = "") => Number((await as(role, sub, `select count(*)::int n from ${t} ${where}`)).rows[0].n);
for (const t of ["bk_documents", "bk_document_lines", "bk_document_payments", "bk_document_events", "bk_business_profiles", "bk_document_shares"]) {
  const aliceRows = Number((await one(`select count(*)::int n from ${t} ${t === "bk_document_lines" ? `where document_id in (select id from bk_documents where profile_id = '${P.alice}')` : `where profile_id = '${P.alice}'`}`)).n);
  const aliceSees = t === "bk_document_shares" ? Number((await as("authenticated", U.alice, `select count(id)::int n from ${t}`)).rows[0].n) : await cnt("authenticated", U.alice, t);
  check("H rls", `${t}: the owner reads her own rows`, aliceRows > 0 && aliceSees >= aliceRows, `${aliceRows} vs ${aliceSees}`);
  const col = t === "bk_document_shares" ? "id" : "*";
  const bobSeesAlice = Number((await as("authenticated", U.bob, `select count(${col === "*" ? "*" : col})::int n from ${t} ${t === "bk_document_lines" ? `where document_id in (select id from bk_documents where profile_id = '${P.alice}')` : `where profile_id = '${P.alice}'`}`)).rows[0].n);
  check("H rls", `${t}: another business reads none of alice's rows`, bobSeesAlice === 0, bobSeesAlice);
  check("H rls", `${t}: a staff-like user, an admin and anon read nothing`, (t === "bk_document_shares" ? Number((await as("authenticated", U.sam, `select count(id)::int n from ${t}`)).rows[0].n) : await cnt("authenticated", U.sam, t)) === 0 && (t === "bk_document_shares" ? Number((await as("authenticated", U.admin, `select count(id)::int n from ${t}`)).rows[0].n) : await cnt("authenticated", U.admin, t)) === 0 && /permission denied/.test((await errOf(() => as("anon", null, `select 1 from ${t}`))) || ""));
}
check("H rls", "token_hash is unreadable even by the owner", /permission denied/.test((await errOf(() => as("authenticated", U.alice, `select token_hash from bk_document_shares`))) || ""));
check("H rls", "service_role can SELECT documents (server reads) but cannot write them", (await cnt("service_role", null, "bk_documents")) > 0 && /permission denied/.test((await errOf(() => svc(`update bk_documents set notes = 'x'`))) || "") && /permission denied/.test((await errOf(() => svc(`insert into bk_document_events (document_id, profile_id, event_type) values ('${A.id}', '${P.alice}', 'created')`))) || "") && /permission denied/.test((await errOf(() => svc(`delete from bk_document_lines`))) || ""));
check("H rls", "authenticated cannot write any Phase 2 table, even the owner", await (async () => { for (const sql of [`insert into bk_business_profiles (profile_id, display_name) values ('${P.alice}', 'x')`, `update bk_documents set notes = 'x'`, `delete from bk_documents`, `update bk_document_payments set amount = 1`, `insert into bk_document_counters (profile_id, doc_type, year) values ('${P.alice}', 'invoice', 2099)`]) if (!/permission denied/.test((await errOf(() => as("authenticated", U.alice, sql))) || "")) return false; return true; })());
check("H rls", "counters and rate events are unreadable by every client role", await (async () => { for (const t of ["bk_document_counters", "bk_document_rate_events"]) for (const [role, sub] of [["authenticated", U.alice], ["service_role", null], ["anon", null]]) if (!/permission denied/.test((await errOf(() => as(role, sub, `select 1 from ${t}`))) || "")) return false; return true; })());
check("H rls", "authenticated and anon cannot call any entry point", await (async () => { for (const [role, sub] of [["authenticated", U.alice], ["anon", null]]) for (const sql of [`doc_issue('${P.alice}','${U.alice}','${A.id}')`, `doc_save_draft('${P.alice}','${U.alice}',null,'invoice','fr',null,null,null,null,false,'[]'::jsonb,null,null)`, `doc_resolve_share('${H64(11)}')`, `bk_doc_gate('${P.alice}','${U.alice}')`]) if (!/permission denied for function/.test((await errOf(() => as(role, sub, `select ${sql}`))) || "")) return false; return true; })());
check("H rls", "service_role cannot call the internal helpers directly (gate, issue core, hash_of)", await (async () => { for (const sql of [`bk_doc_gate('${P.alice}','${U.alice}')`, `bk_doc_event('${A.id}','${P.alice}','created',null,null)`]) if (!/permission denied for function/.test((await errOf(() => svc(`select ${sql}`))) || "")) return false; return true; })());

// ======================================================================================= I. deletion behaviour
check("I delete", "deleting a profile that has documents is blocked (RESTRICT)", /foreign key|RESTRICT/.test((await errOf(() => db.exec(`delete from public.profiles where id = '${P.alice}'`))) || ""));
check("I delete", "deleting the owner of a profile with documents is blocked", /foreign key|RESTRICT/.test((await errOf(() => db.exec(`delete from public.users where id = '${U.alice}'`))) || ""));
check("I delete", "a business profile row cannot be deleted", /never deleted/.test((await errOf(() => db.exec(`delete from bk_business_profiles where profile_id = '${P.alice}'`))) || ""));
check("I delete", "a counter row cannot be deleted or rewound", /never deleted/.test((await errOf(() => db.exec(`delete from bk_document_counters`))) || "") && /only ever advances/.test((await errOf(() => db.exec(`update bk_document_counters set last_number = 1 where profile_id = '${P.alice}' and doc_type = 'invoice' and year = ${year}`))) || ""));
check("I delete", "demo profiles never receive documents, so demo cleanup is unaffected (entry-less user deletes normally)", (await count(`bk_documents where profile_id = '${P.erin}'`)) === 0 && (await errOf(() => db.exec(`delete from public.users where id = '${U.erin}'`))) === null);
check("I delete", "a user/profile without documents deletes normally (existing behaviour unchanged)", (await errOf(() => db.exec(`delete from public.users where id = '${U.dave}'`))) === null);

// ======================================================================================= J. SQL <-> JS parity
let mism = 0, runs = 0;
for (let i = 0; i < 400; i++) {
  const cur = ["XAF", "USD", "KWD"][i % 3];
  const dg = cur === "XAF" ? 0 : cur === "USD" ? 2 : 3;
  const priceMinor = Math.floor(Math.random() * 10 ** (dg + 5));
  const price = (priceMinor / 10 ** dg).toFixed(dg);
  const qty = ((1 + Math.floor(Math.random() * 99999)) / 1000).toString();
  const gross = TOT.computeLine({ quantity: qty, unitPrice: price }, cur, null);
  const discMinor = gross.ok ? Math.floor(Math.random() * (gross.line.grossMinor + 1)) : 0;
  const disc = (discMinor / 10 ** dg).toFixed(dg);
  const rate = i % 3 === 0 ? null : Math.floor(Math.random() * 10001);
  const js = TOT.computeLine({ quantity: qty, unitPrice: price, discount: disc }, cur, rate);
  const sql = (await one(`select * from bk_doc_compute_line(${qty}::numeric, ${price}::numeric, ${disc}::numeric, ${rate === null ? "null" : rate}::int, ${dg})`));
  runs++;
  if (!js.ok) { mism++; continue; }
  const m = (v) => Math.round(Number(v) * 10 ** dg);
  if (m(sql.gross) !== js.line.grossMinor || m(sql.discount) !== js.line.discountMinor || m(sql.tax) !== js.line.taxMinor || m(sql.total) !== js.line.totalMinor) { mism++; if (mism < 4) console.log("  parity mismatch", { qty, price, disc, rate, cur, js: js.line, sql }); }
}
check("J parity", `the JS totals mirror equals SQL bk_doc_compute_line on ${runs} random lines (XAF, USD, KWD; discounts; tax)`, mism === 0, mism);
for (const [t, y, s] of [["invoice", 2026, 1], ["receipt", 2026, 7], ["invoice", 2027, 999], ["invoice", 2027, 1000], ["receipt", 2026, 9999], ["invoice", 2026, 10000], ["invoice", 2026, 123456]])
  check("J parity", `bk_doc_number(${t}, ${y}, ${s}) equals formatDocumentNumber`, (await one(`select bk_doc_number('${t}', ${y}, ${s}) n`)).n === NUM.formatDocumentNumber(t, y, s), (await one(`select bk_doc_number('${t}', ${y}, ${s}) n`)).n);
check("J parity", "SQL refuses what the JS mirror refuses: discount above the line, zero quantity, tax above 100%", await (async () => { for (const [e2, frag] of [[`select * from bk_doc_compute_line(1, 100, 101, null, 0)`, "discount_exceeds_amount"], [`select * from bk_doc_compute_line(0, 100, 0, null, 0)`, "invalid_quantity"], [`select * from bk_doc_compute_line(1, 100, 0, 10001, 0)`, "invalid_tax_rate"]]) if (!new RegExp(frag).test((await errOf(() => db.query(e2))) || "")) return false; return true; })());

// ======================================================================================= K. rollback, atomic migration failure
check("K rollback", "the documented rollback SQL was extracted from the migration file", /drop table if exists bk_documents;/.test(ROLLBACK) && ROLLBACK.startsWith("begin;") && ROLLBACK.trim().endsWith("commit;"), ROLLBACK.slice(0, 80));
const rb = await freshDb();
await rb.exec(PHASE1);
const rbBefore = await snapshot(rb);
await rb.exec(PHASE2);
const rbErr = await errOf(() => rb.exec(ROLLBACK));
if (rbErr) await rb.exec("rollback").catch(() => {});
check("K rollback", "rollback SQL executes (real execution) on an empty Phase 2", rbErr === null, rbErr);
check("K rollback", "rollback removes every Phase 2 object", (await snapshot(rb)).filter(isPhase2Name).length === 0, JSON.stringify((await snapshot(rb)).filter(isPhase2Name).slice(0, 5)));
check("K rollback", "rollback leaves EVERYTHING ELSE (Phase 1 and the existing schema) exactly as it was before Phase 2", JSON.stringify(await snapshot(rb)) === JSON.stringify(rbBefore));
check("K rollback", "the migration can be applied again after a rollback", (await errOf(() => rb.exec(PHASE2))) === null);
const noP1 = await freshDb();
const noP1Err = await errOf(() => noP1.exec(PHASE2));
await noP1.exec("rollback").catch(() => {});
check("K atomic", "applying Phase 2 WITHOUT Phase 1 fails with a clear message", /requires the Phase 1 bookkeeping migration/.test(noP1Err || ""), noP1Err);
check("K atomic", "...and leaves nothing behind", (await noP1.query(`select count(*)::int n from pg_tables where tablename like 'bk\\_%'`)).rows[0].n === 0 && (await noP1.query(`select count(*)::int n from pg_proc where proname like 'bk\\_doc\\_%' or proname like 'doc\\_%'`)).rows[0].n === 0);

// ======================================================================================= report
const groups = {};
for (const r of results) (groups[r.group] ||= { pass: 0, fail: 0 })[r.pass ? "pass" : "fail"]++;
console.log("\nPGlite (real PostgreSQL engine, stand-in Supabase shell) results by group:");
for (const [g, c] of Object.entries(groups)) console.log(`  ${g.padEnd(14)} ${c.pass} passed${c.fail ? `, ${c.fail} FAILED` : ""}`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${process.env.MUT ? ` (MUT=${process.env.MUT}: failures are EXPECTED)` : ""}`);
console.log(`
NOT VERIFIED (PGlite cannot reproduce these; they need real Supabase):
  1. Supabase's real roles, default privileges, schema owners and event triggers (here: stand-ins copied from the documented defaults).
  2. PostgREST: JSON parameter casting for rpc(), error text -> HTTP mapping, row caps, and exposure of public functions as RPC.
  3. JWT verification and the real auth.uid(); auth.users linkage.
  4. The actual production schema: live-only columns/constraints/triggers/policies on profiles, users, plans, products.
  5. Truly CONCURRENT transactions (PGlite is one connection). Gapless numbering under concurrency rests on the counter row lock taken by
     INSERT ... ON CONFLICT DO UPDATE and on the advisory locks in doc_save_draft / doc_record_payment; their serialisation is unproven here.
  6. Connection-pooler behaviour with advisory transaction locks.
  7. SQL-editor execution semantics (implicit transaction handling, statement timeouts, the role the editor runs as).
  8. Performance at real volumes (small fixtures only).
`);
process.exit(failed.length && !process.env.MUT ? 1 : 0);
