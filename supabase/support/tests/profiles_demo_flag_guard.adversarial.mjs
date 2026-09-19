// Adversarial test for supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql
//
// Runs entirely on a scratch, in-memory PostgreSQL (PGlite). It never connects to Supabase or any real database.
// It applies the ACTUAL migration file from this repository and then attacks it from every role the API exposes.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json)
//   Run:    node supabase/support/tests/profiles_demo_flag_guard.adversarial.mjs
//           (optional: PGLITE_ENTRY=<path or file URL of the pglite entry point> to use another install)
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION = fs.readFileSync(REPO + "supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql", "utf8").replace(/\r\n/g, "\n");
const VERIFY = fs.readFileSync(REPO + "supabase/support/2026-10-16_profiles_demo_flag_guard.verify.sql", "utf8").replace(/\r\n/g, "\n");
const ROLLBACK = fs.readFileSync(REPO + "supabase/support/2026-10-16_profiles_demo_flag_guard.rollback.sql", "utf8").replace(/\r\n/g, "\n");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const PROTECTED = "demo_flag_protected";

const ID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = { real: ID(1), org: ID(2), demo: ID(3), other: ID(4) };
const U = { real: UID(1), org: UID(2), demo: UID(3), other: UID(4), staff: UID(99), newuser: UID(50) };

// A Supabase-shaped scratch database. `owner` owns the tables and functions (postgres on Supabase).
async function fresh(owner = "postgres") {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;
    create role supabase_auth_admin nologin; create role supabase_admin nologin;
    ${owner === "postgres" ? "" : `create role ${owner} nologin; grant ${owner} to postgres;`}
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role, supabase_auth_admin, ${owner};
    ${owner === "postgres" ? "" : `grant create on schema public to ${owner};`}
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text, is_anonymous boolean default false);
    grant all on auth.users to service_role, ${owner};
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    set role ${owner};
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create function public.is_admin() returns boolean language sql as $$ select false $$;
    create function public.has_org_permission(p uuid, perm text) returns boolean language sql as $$ select current_setting('test.staff', true) = 'yes' $$;
    create table public.profiles (
      id uuid primary key, user_id uuid references auth.users(id) on delete cascade, username text, name text, category text, bio text,
      is_demo boolean not null default false, demo_expires_at timestamptz, verified boolean not null default false);
    alter table public.profiles enable row level security;
    -- the policies reported by the live probe (G2), plus a deliberately over-permissive anon INSERT policy so the
    -- trigger itself (not RLS) is what is being tested for anon
    create policy "profiles update by owner or admin" on public.profiles for update using (auth.uid() = user_id or is_admin());
    create policy "profiles staff settings update" on public.profiles for update using (has_org_permission(id, 'settings.manage')) with check (has_org_permission(id, 'settings.manage'));
    create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
    create policy "TEST worst-case anon insert" on public.profiles for insert to anon with check (true);
    create policy "profiles read" on public.profiles for select using (true);
    -- handle_new_auth_user stand-in: a SECURITY DEFINER signup function that inserts a profile with defaults
    create function public.handle_new_auth_user_sim(p_uid uuid, p_username text) returns void language plpgsql security definer set search_path = public as $$
      begin insert into public.profiles (id, user_id, username) values (gen_random_uuid(), p_uid, p_username); end $$;
    grant execute on function public.handle_new_auth_user_sim(uuid, text) to supabase_auth_admin;
    reset role;
  `);
  for (const [k, u] of Object.entries(U)) await db.exec(`insert into auth.users (id, is_anonymous) values ('${u}', ${k === "demo" ? "true" : "false"}) on conflict do nothing`);
  await db.exec(`set role ${owner}; insert into public.profiles (id, user_id, username, name) values
      ('${P.real}','${U.real}','realowner','Real Owner'), ('${P.org}','${U.org}','orgprofile','Org Profile'), ('${P.other}','${U.other}','other','Other');
    insert into public.profiles (id, user_id, username, name, is_demo, demo_expires_at) values ('${P.demo}','${U.demo}','demouser','Demo User', true, now() + interval '7 days'); reset role;`);
  return db;
}
const as = async (db, role, sub, sql, staff) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false); select set_config('test.staff','${staff ? "yes" : "no"}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false); select set_config('test.staff','no', false);`); }
};
const flags = async (db, id) => (await db.query(`select is_demo, demo_expires_at from profiles where id='${id}'`)).rows[0];
// A COMPLETE row copied from the existing profile with is_demo forced to true and upserted over itself: every NOT NULL
// column is present, so nothing unrelated can stop the statement before the guard is reached.
const COMPLETE_ROW_UPSERT = (id) => `insert into profiles select * from jsonb_populate_record(null::public.profiles, (select to_jsonb(p) || jsonb_build_object('is_demo', true) from public.profiles p where p.id = '${id}')) on conflict (id) do update set is_demo = excluded.is_demo`;
const errFull = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const refused = async (fn) => (await errOf(fn)) === PROTECTED;

// ------------------------------------------------------------------------------------------------ control
console.log("### 0. CONTROL: before the guard exists the weakness is real (proves the tests below are meaningful)");
let db = await fresh();
await as(db, "authenticated", U.real, `update profiles set is_demo = true where id='${P.real}'`);
check("control: without the guard an ordinary owner CAN set is_demo", (await flags(db, P.real)).is_demo === true);
await as(db, "authenticated", U.demo, `update profiles set demo_expires_at = null where id='${P.demo}'`);
check("control: without the guard a demo user CAN clear demo_expires_at", (await flags(db, P.demo)).demo_expires_at === null);
await db.query(`update profiles set is_demo = false where id='${P.real}'`);
await as(db, "authenticated", U.real, COMPLETE_ROW_UPSERT(P.real));
check("control: the corrected COMPLETE-ROW upsert reaches the write and flips is_demo when there is no guard (so it is a valid attack)", (await flags(db, P.real)).is_demo === true);
await db.query(`update profiles set is_demo = false where id='${P.real}'`);
const st0 = (await db.query(VERIFY.slice(0, VERIFY.indexOf("-- PART 2")))).rows;
check("control: verification PART 1 reports NOT INSTALLED on the unguarded database", st0.some((r) => r.grp === "ZZ" && r.value.startsWith("NOT INSTALLED") && r.status === "FAIL"), JSON.stringify(st0.find((r) => r.grp === "ZZ")));
check("control: PART 2 of the verification script reports FAIL on the unguarded database", ((await errFull(() => db.exec(VERIFY.slice(VERIFY.indexOf("-- PART 2"))))) || "").includes("FAIL - an ordinary owner could set is_demo"));

// ------------------------------------------------------------------------------------------------ migration
console.log("### 1. apply the REAL migration file (with its built-in adversarial self-test)");
db = await fresh();
check("migration applies and commits (preconditions, guard, self-test, postconditions)", (await errOf(() => db.exec(MIGRATION))) === null);
const snapshot = async () => JSON.stringify((await db.query(`select id, is_demo, demo_expires_at, name, username, verified from profiles order by id`)).rows);
const before = await snapshot();
check("the migration's self-test left no trace on any existing row (all rows equal to their pre-migration values)", before.includes("realowner") && (await flags(db, P.real)).is_demo === false && (await flags(db, P.demo)).is_demo === true && (await flags(db, P.demo)).demo_expires_at !== null);
check("guard function is SECURITY INVOKER with a pinned search_path", (await db.query(`select not prosecdef s, proconfig::text c from pg_proc where proname='protect_demo_flags'`)).rows.every((r) => r.s && r.c.includes("pg_catalog")));
check("no API role can EXECUTE the guard function", (await db.query(`select bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) x from pg_proc p, (values ('anon'),('authenticated'),('service_role')) v(r) where p.proname='protect_demo_flags'`)).rows[0].x === false);

console.log("### 2. UPDATE attacks by authenticated users, owners and Organization staff");
check("real owner false -> true is_demo is refused", await refused(() => as(db, "authenticated", U.real, `update profiles set is_demo = true where id='${P.real}'`)));
check("demo owner true -> false is_demo is refused", await refused(() => as(db, "authenticated", U.demo, `update profiles set is_demo = false where id='${P.demo}'`)));
check("owner SETS demo_expires_at (null -> value) is refused", await refused(() => as(db, "authenticated", U.real, `update profiles set demo_expires_at = now() + interval '7 days' where id='${P.real}'`)));
check("demo owner EXTENDS demo_expires_at is refused", await refused(() => as(db, "authenticated", U.demo, `update profiles set demo_expires_at = now() + interval '9999 days' where id='${P.demo}'`)));
check("demo owner CLEARS demo_expires_at is refused", await refused(() => as(db, "authenticated", U.demo, `update profiles set demo_expires_at = null where id='${P.demo}'`)));
check("demo owner changes both at once is refused", await refused(() => as(db, "authenticated", U.demo, `update profiles set is_demo = false, demo_expires_at = null where id='${P.demo}'`)));
check("Organization staff (settings.manage) cannot change is_demo", await refused(() => as(db, "authenticated", UID(99), `update profiles set is_demo = true where id='${P.org}'`, true)));
check("Organization staff cannot change demo_expires_at", await refused(() => as(db, "authenticated", UID(99), `update profiles set demo_expires_at = now() where id='${P.org}'`, true)));
check("UPDATE ... FROM cannot bypass the guard", await refused(() => as(db, "authenticated", U.real, `update profiles p set is_demo = s.v from (select true v) s where p.id='${P.real}'`)));
check("a multi-row UPDATE touching a protected column is refused as a whole", await refused(() => as(db, "authenticated", U.real, `update profiles set is_demo = true where user_id = '${U.real}' or id = '${P.real}'`)));
check("anon UPDATE affects nothing (no policy) and cannot change the flag", (await as(db, "anon", null, `update profiles set is_demo = true where id='${P.real}' returning id`)).rows.length === 0 && (await flags(db, P.real)).is_demo === false);

console.log("### 3. INSERT and UPSERT attacks (anon, authenticated)");
check("anon INSERT with is_demo = true is refused (even with a worst-case permissive anon INSERT policy)", await refused(() => as(db, "anon", null, `insert into profiles (id, user_id, username, is_demo) values ('${ID(70)}','${U.newuser}','x', true)`)));
check("anon INSERT with a demo_expires_at is refused", await refused(() => as(db, "anon", null, `insert into profiles (id, user_id, username, demo_expires_at) values ('${ID(71)}','${U.newuser}','x', now() + interval '7 days')`)));
check("authenticated INSERT with is_demo = true is refused", await refused(() => as(db, "authenticated", U.newuser, `insert into profiles (id, user_id, username, is_demo) values ('${ID(72)}','${U.newuser}','x', true)`)));
check("authenticated INSERT with demo_expires_at is refused", await refused(() => as(db, "authenticated", U.newuser, `insert into profiles (id, user_id, username, demo_expires_at) values ('${ID(73)}','${U.newuser}','x', now())`)));
check("UPSERT cannot bypass: on conflict do update set is_demo = true", await refused(() => as(db, "authenticated", U.real, `insert into profiles (id, user_id, username) values ('${P.real}','${U.real}','realowner') on conflict (id) do update set is_demo = true`)));
check("UPSERT cannot bypass: on conflict do update set demo_expires_at", await refused(() => as(db, "authenticated", U.real, `insert into profiles (id, user_id, username) values ('${P.real}','${U.real}','realowner') on conflict (id) do update set demo_expires_at = now()`)));
check("CORRECTED upsert (complete valid row) is refused BY demo_flag_protected, not by an unrelated constraint", await refused(() => as(db, "authenticated", U.real, COMPLETE_ROW_UPSERT(P.real))));
check("CORRECTED upsert against the demo owner's row is refused by the guard too", await refused(() => as(db, "authenticated", U.demo, COMPLETE_ROW_UPSERT(P.demo))));
check("UPSERT of a NEW row carrying is_demo = true is refused", await refused(() => as(db, "authenticated", U.newuser, `insert into profiles (id, user_id, username, is_demo) values ('${ID(74)}','${U.newuser}','x', true) on conflict (id) do update set name = 'y'`)));
check("no attack left any trace (flags unchanged)", (await flags(db, P.real)).is_demo === false && (await flags(db, P.real)).demo_expires_at === null && (await flags(db, P.demo)).is_demo === true && (await flags(db, P.demo)).demo_expires_at !== null);

console.log("### 4. normal behavior is unchanged");
await as(db, "authenticated", U.real, `update profiles set name = 'Renamed', username = 'realowner2', category = 'music', bio = 'hello' where id='${P.real}'`);
check("normal profile edits (name, username, category, bio) still work", (await db.query(`select name, category from profiles where id='${P.real}'`)).rows[0].name === "Renamed");
await as(db, "authenticated", U.real, `update profiles set name = 'R2', is_demo = false, demo_expires_at = null where id='${P.real}'`);
check("a full-row style edit that sends the protected columns UNCHANGED is allowed", (await db.query(`select name from profiles where id='${P.real}'`)).rows[0].name === "R2");
await as(db, "authenticated", U.demo, `update profiles set is_demo = true where id='${P.demo}'`);
check("re-sending the same is_demo value (no change) is allowed for a demo user", (await flags(db, P.demo)).is_demo === true);
await as(db, "authenticated", U.newuser, `insert into profiles (id, user_id, username) values ('${ID(80)}','${U.newuser}','fresh-user')`);
check("normal profile creation using defaults (authenticated, own row) still works", (await db.query(`select is_demo from profiles where id='${ID(80)}'`)).rows[0].is_demo === false);
await as(db, "supabase_auth_admin", null, `select public.handle_new_auth_user_sim('${U.newuser}', 'signup-user')`);
check("signup through a SECURITY DEFINER function with defaults still works", (await db.query(`select count(*)::int c from profiles where username='signup-user'`)).rows[0].c === 1);
check("(scope record) profiles.verified is NOT covered by this guard and remains a separate hardening item", (await errOf(() => as(db, "authenticated", U.real, `update profiles set verified = true where id='${P.real}'`))) === null);

console.log("### 5. trusted server behavior (service_role) is unaffected");
await as(db, "service_role", null, `insert into profiles (id, user_id, username) values ('${ID(90)}','${U.newuser}','demo-created')`);
await as(db, "service_role", null, `update profiles set category = 'restaurant_food', is_demo = true, demo_expires_at = now() + interval '7 days', name = 'Utilisateur Test' where id='${ID(90)}'`);
check("service-role DEMO CREATION (update is_demo = true + valid expiry, as /api/demo/create does) works", (await flags(db, ID(90))).is_demo === true && (await flags(db, ID(90))).demo_expires_at !== null);
await as(db, "service_role", null, `update profiles set name = 'Chez Marie', category = 'restaurant_food', is_demo = true, demo_expires_at = now() + interval '7 days' where id='${P.other}'`);
check("service-role demo PARTNER SEEDING (name, category, is_demo, expiry) works", (await flags(db, P.other)).is_demo === true);
await as(db, "service_role", null, `insert into profiles (id, user_id, username, is_demo, demo_expires_at) values ('${ID(91)}','${U.newuser}','direct-demo', true, now() + interval '7 days')`);
check("service-role INSERT that sets the flags directly works", (await flags(db, ID(91))).is_demo === true);
const expired = (await as(db, "service_role", null, `select user_id from profiles where is_demo = true and demo_expires_at < now() + interval '30 days'`)).rows;
check("service-role cleanup READS demo flags and expiry as before", expired.length >= 3);
await as(db, "service_role", null, `delete from profiles where id='${ID(91)}'`);
check("service-role cleanup DELETE of a demo profile is unaffected (the trigger has no DELETE event)", (await db.query(`select count(*)::int c from profiles where id='${ID(91)}'`)).rows[0].c === 0);
await as(db, "service_role", null, `delete from auth.users where id='${U.demo}'`);
check("cleanup by deleting the auth user (profile removed by ON DELETE CASCADE) is unaffected", (await db.query(`select count(*)::int c from profiles where id='${P.demo}'`)).rows[0].c === 0);
await db.query(`update profiles set is_demo = false where id='${ID(90)}'`);
check("the SQL editor / migrations (table owner) can still correct a flag", (await flags(db, ID(90))).is_demo === false);

console.log("### 6. bypass attempts (own database; session_user = authenticator, like PostgREST)");
const dbB = await fresh();
await dbB.exec(MIGRATION);
await dbB.exec(`set session authorization authenticator`); // from here every statement runs as authenticator or a role it can SET ROLE to
const pgrest = async (sub, ...stmts) => {
  await dbB.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${sub}', false);`);
  try { for (const st of stmts) await dbB.query(st); return null; } catch (e) { return e.message.split("\n")[0]; }
  finally { await dbB.exec(`reset role`); }
};
const flagsB = async (id) => { await dbB.exec(`set role service_role`); try { return (await dbB.query(`select is_demo, demo_expires_at from profiles where id='${id}'`)).rows[0]; } finally { await dbB.exec(`reset role`); } };
check("spoofing request.jwt.claim.role / claims to service_role does not help (the guard reads the real role)", (await pgrest(U.real, `select set_config('request.jwt.claim.role','service_role',false)`, `select set_config('request.jwt.claims','{"role":"service_role"}',false)`, `update profiles set is_demo = true where id='${P.real}'`)) === PROTECTED);
check("an API session cannot become the table owner (SET ROLE postgres is refused)", (await pgrest(U.real, `set role postgres`)) !== null);
check("SET session_replication_role = replica (would disable triggers) is refused", (await pgrest(U.real, `set session_replication_role = replica`)) !== null);
check("ALTER TABLE ... DISABLE TRIGGER is refused", (await pgrest(U.real, `alter table profiles disable trigger trg_protect_demo_flags`)) !== null);
check("DROP TRIGGER and DROP FUNCTION are refused", (await pgrest(U.real, `drop trigger trg_protect_demo_flags on profiles`)) !== null && (await pgrest(U.real, `drop function public.protect_demo_flags() cascade`)) !== null);
check("CREATE OR REPLACE of the guard function by an API role is refused", (await pgrest(U.real, `create or replace function public.protect_demo_flags() returns trigger language plpgsql as $$ begin return new; end $$`)) !== null);
check("(documented limit) authenticator can SET ROLE service_role: reachable only with arbitrary SQL execution, which the REST API does not expose", (await pgrest(U.real, `set role service_role`)) === null);
check("after every bypass attempt the flags are unchanged", (await flagsB(P.real)).is_demo === false && (await flagsB(P.real)).demo_expires_at === null);

console.log("### 7. the trust rule: service_role + the DERIVED table owner, nothing else");
await db.exec(`alter role supabase_admin bypassrls; grant all on public.profiles to supabase_admin`);
check("supabase_admin (a role that is neither the owner nor service_role) is NOT trusted", await refused(() => as(db, "supabase_admin", null, `update profiles set is_demo = true where id='${P.real}'`)));
const db2 = await fresh("app_owner");
check("with a table owner that is NOT called postgres, the migration applies (owner derived, not hard-coded)", (await errOf(async () => { await db2.exec(`set role app_owner`); try { await db2.exec(MIGRATION); } finally { await db2.exec(`reset role`); } })) === null);
check("...the derived owner may change the flags", (await errOf(async () => { await db2.exec(`set role app_owner`); try { await db2.query(`update profiles set is_demo = true where id='${P.real}'`); } finally { await db2.exec(`reset role`); } })) === null);
check("...service_role may still change the flags", (await errOf(() => as(db2, "service_role", null, `update profiles set demo_expires_at = now() + interval '7 days' where id='${P.real}'`))) === null);
check("...and a different superuser session (postgres, not the owner) is NOT trusted", await refused(() => db2.query(`update profiles set is_demo = false where id='${P.real}'`)));
check("...authenticated still cannot", await refused(() => as(db2, "authenticated", U.other, `update profiles set is_demo = true where id='${P.other}'`)));

console.log("### 8. migration preconditions abort safely");
let d = await fresh(); await d.exec(`grant postgres to authenticated`);
let e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("an API role that is a member of the table owner => migration ABORTS", e && e.includes("can become, the table owner") || (e && e.includes("are, or can become")), e);
d = await fresh(); await d.exec(`grant service_role to anon`);
e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("anon able to become service_role => migration ABORTS", e && e.includes("can become service_role"), e);
d = await fresh(); await d.exec(`grant postgres to authenticator`);
e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("authenticator able to become the table owner => migration ABORTS", e && e.includes("authenticator"), e);
d = await fresh(); await d.exec(MIGRATION);
e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("running the migration twice => second run ABORTS", e && e.includes("already exists"), e);
d = await fresh(); await d.exec(`alter table profiles drop column demo_expires_at`);
e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("missing column => migration ABORTS and nothing is created", e && e.includes("missing or have unexpected types") && (await d.query(`select count(*)::int c from pg_proc where proname='protect_demo_flags'`)).rows[0].c === 0, e);
d = await fresh("app_owner"); e = await errOf(() => d.exec(MIGRATION)); await d.exec("rollback").catch(() => {});
check("running as a role that does not own profiles => migration ABORTS", e && e.includes("run as the table owner"), e);

console.log("### 9. verification scripts and rollback");
const p1 = (await db.query(VERIFY.slice(0, VERIFY.indexOf("-- PART 2")))).rows;
const zz = p1.find((r) => r.grp === "ZZ");
check("verification PART 1 (read-only) reports INSTALLED AND CORRECT on the guarded database", zz && zz.value.startsWith("INSTALLED AND CORRECT") && zz.status === "PASS", JSON.stringify(zz));
check("...with every trigger / function / ownership / ACL / owner-derivation row PASS and none MISSING or FAIL", p1.every((r) => r.status !== "MISSING" && r.status !== "FAIL"), JSON.stringify(p1.filter((r) => r.status === "MISSING" || r.status === "FAIL")));
await db.exec(`alter table profiles disable trigger trg_protect_demo_flags`);
const zzOff = (await db.query(VERIFY.slice(0, VERIFY.indexOf("-- PART 2")))).rows.find((r) => r.grp === "ZZ");
await db.exec(`alter table profiles enable trigger trg_protect_demo_flags`);
check("...and PART 1 flags a DISABLED trigger as misconfigured", zzOff.value.startsWith("INSTALLED BUT MISCONFIGURED"), zzOff.value);
const rep = (await errFull(() => db.exec(VERIFY.slice(VERIFY.indexOf("-- PART 2"))))) || "";
check("verification PART 2 (adversarial) reports PASS for ADV1..ADV5 and CTL1..CTL2 and no FAIL", rep.includes("ADVERSARIAL RESULT") && !rep.includes("FAIL") && (rep.match(/PASS/g) || []).length >= 6, rep);
check("PART 2 changed nothing", (await flags(db, P.real)).is_demo === false);
await db.exec(ROLLBACK);
check("rollback removes the trigger and the function and nothing else", (await db.query(`select (select count(*) from pg_trigger where tgname='trg_protect_demo_flags')::int t, (select count(*) from pg_proc where proname='protect_demo_flags')::int f`)).rows[0].t === 0);
check("after rollback the behavior returns exactly to the previous state", (await errOf(() => as(db, "authenticated", U.real, `update profiles set is_demo = true where id='${P.real}'`))) === null);
await db.query(`update profiles set is_demo = false where id='${P.real}'`);
check("the migration re-applies after a rollback", (await errOf(() => db.exec(MIGRATION))) === null && await refused(() => as(db, "authenticated", U.real, `update profiles set is_demo = true where id='${P.real}'`)));

const passed = results.filter((r) => r.pass).length;
console.log(`\n=========== ${passed}/${results.length} checks passed ===========`);
if (passed !== results.length) { console.log("FAILURES:"); results.filter((r) => !r.pass).forEach((r) => console.log(" -", r.name, "|", r.detail)); process.exit(1); }
