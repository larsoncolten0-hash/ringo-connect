// Adversarial test for the Phase 1 security migrations:
//   2026-10-06a_users_privileged_column_guard.sql      2026-10-06b_profiles_privileged_column_guard.sql
//   2026-10-06c_security_definer_search_path.sql       2026-10-06d_payment_transactions_idempotency.sql
//   2026-10-06e_unsafe_url_scheme_guard.sql           (+ 2026-10-06a_security_phase1.verify.sql, read-only)
//
// Runs entirely on a scratch, in-memory PostgreSQL (PGlite). It never connects to Supabase or any real database. It applies the
// ACTUAL migration files from this repository and attacks them from every role the API exposes. A CONTROL run first proves that
// each attack really works against the unguarded database, so the checks that follow are meaningful.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (already present in this repository's node_modules; nothing is added to package.json)
//   Run:    node supabase/support/tests/security_phase1.adversarial.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sql = (rel) => fs.readFileSync(REPO + rel, "utf8").replace(/\r\n/g, "\n");
const M_USERS = sql("supabase/migrations/2026-10-06a_users_privileged_column_guard.sql");
const M_PROFILES = sql("supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql");
const M_DEFINER = sql("supabase/migrations/2026-10-06c_security_definer_search_path.sql");
const M_PAYMENTS = sql("supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql");
const M_URLS = sql("supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql");
const M_DEMO = sql("supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql");
const VERIFY = sql("supabase/support/2026-10-06a_security_phase1.verify.sql");
const RB = {
  users: sql("supabase/support/2026-10-06a_users_privileged_column_guard.rollback.sql"),
  profiles: sql("supabase/support/2026-10-06b_profiles_privileged_column_guard.rollback.sql"),
  definer: sql("supabase/support/2026-10-06c_security_definer_search_path.rollback.sql"),
  payments: sql("supabase/support/2026-10-06d_payment_transactions_idempotency.rollback.sql"),
  urls: sql("supabase/support/2026-10-06e_unsafe_url_scheme_guard.rollback.sql"),
};

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const U_ERR = "users_privileged_column_protected";
const P_ERR = "profile_privileged_column_protected";
const URL_ERR = "unsafe_url_scheme";

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), admin: UID(3), staff: UID(4) };
const P = { alice: PID(1), bob: PID(2) };

// A Supabase-shaped scratch database. postgres owns tables and functions, exactly like the real project.
async function fresh({ withOldTriggers = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;
    create role supabase_auth_admin nologin; create role supabase_admin nologin;
    create schema auth; create schema extensions; create schema storage;
    grant usage on schema auth, public, extensions to anon, authenticated, service_role, supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    grant all on auth.users to service_role, supabase_auth_admin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    -- pgcrypto stand-in living in the "extensions" schema, like on Supabase
    create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(repeat('ab', n), 'hex') $$;
    grant execute on function extensions.gen_random_bytes(int) to anon, authenticated, service_role, supabase_auth_admin;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;

    -- the REAL users table shape: schema.sql columns + migration columns + the columns that exist only in production
    create table public.users (
      id uuid primary key references auth.users(id) on delete cascade, email text not null,
      role text not null default 'creator' check (role in ('creator', 'admin')), plan_id uuid, status text not null default 'active' check (status in ('active', 'suspended')),
      created_at timestamptz not null default now(),
      affiliate_code text unique, referred_by uuid, affiliate_suspended boolean not null default false, affiliate_payout_method text, affiliate_payout_details jsonb,
      can_approve_requests boolean not null default false, onboarding_completed_at timestamptz, onboarding_dismissed_at timestamptz,
      last_active_at timestamptz, last_active_standalone boolean not null default false, pwa_installed_at timestamptz,
      payment_provider text, billing_interval text, stripe_customer_id text, stripe_subscription_id text, plan_expires_at timestamptz);
    alter table public.users enable row level security;
    create function public.is_admin() returns boolean as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$ language sql security definer;
    -- the REAL policies from schema.sql
    create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
    create policy "users update own row" on public.users for update using (auth.uid() = id or is_admin());
    -- the REAL fail-open trigger from 2026-09-09_affiliate_trigger_hardening.sql
    ${withOldTriggers ? `
    create or replace function public.protect_affiliate_fields() returns trigger as $$
    begin
      begin
        if auth.uid() is not null and not is_admin() then
          new.affiliate_code := old.affiliate_code; new.referred_by := old.referred_by; new.affiliate_suspended := old.affiliate_suspended;
        end if;
      exception when others then null;
      end;
      return new;
    end; $$ language plpgsql security definer;
    create trigger trg_protect_affiliate_fields before update on public.users for each row execute function public.protect_affiliate_fields();` : ""}

    create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text unique, name text, bio text,
      published boolean not null default true, ordering_enabled boolean not null default true, verified boolean not null default false,
      is_demo boolean not null default false, demo_expires_at timestamptz, created_at timestamptz not null default now(),
      -- the owner-editable settings of the real table (2026-09 .. 2026-10 migrations)
      bookings_enabled boolean not null default false, community_enabled boolean not null default false, hub_support_enabled boolean not null default true, team_badges_enabled boolean not null default true,
      dine_in_enabled boolean not null default true, takeaway_enabled boolean not null default true, delivery_enabled boolean not null default false, delivery_fee numeric(10,2) not null default 0,
      category text, categories text[] not null default '{}', theme_color text, whatsapp_number text, facebook_pixel_id text, avatar_url text, opening_hours jsonb not null default '{}'::jsonb, about_email text);
    alter table public.profiles enable row level security;
    create table public.organization_members (profile_id uuid, user_id uuid, status text default 'active');
    grant all on public.organization_members to anon, authenticated, service_role;
    -- unqualified table name on purpose: this is the shape of the repository's has_org_permission
    create function public.has_org_permission(p_profile_id uuid, p_permission text) returns boolean language sql security definer stable as $$
      select exists (select 1 from organization_members m where m.profile_id = p_profile_id and m.user_id = auth.uid() and m.status = 'active') $$;
    create policy "profiles update by owner or admin" on public.profiles for update using (auth.uid() = user_id or is_admin());
    create policy "profiles staff settings update" on public.profiles for update using (has_org_permission(id, 'settings.manage')) with check (has_org_permission(id, 'settings.manage'));
    create policy "profiles insert by owner" on public.profiles for insert with check (auth.uid() = user_id);
    create policy "profiles read" on public.profiles for select using (true);

    create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid, name text, price numeric, landing_url text);
    create table public.tracks (id uuid primary key default gen_random_uuid(), profile_id uuid, title text, buy_url text, external_url text);
    create table public.events (id uuid primary key default gen_random_uuid(), profile_id uuid, title text, ticket_url text);
    create table public.links (id uuid primary key default gen_random_uuid(), profile_id uuid, url text not null);
    create table public.social_links (id uuid primary key default gen_random_uuid(), profile_id uuid, url text not null);
    create table public.community_announcements (id uuid primary key default gen_random_uuid(), profile_id uuid, title text, link_url text);
    create table public.payment_transactions (id uuid primary key default gen_random_uuid(), user_id uuid, provider text not null, provider_transaction_id text, status text default 'pending');
  `);
  for (const [n, id] of Object.entries(U)) await db.exec(`insert into auth.users (id, email) values ('${id}', '${n}@example.com')`);
  await db.exec(`
    insert into public.users (id, email, role) values ('${U.alice}', 'alice@example.com', 'creator'), ('${U.bob}', 'bob@example.com', 'creator'),
      ('${U.admin}', 'admin@example.com', 'admin'), ('${U.staff}', 'staff@example.com', 'creator');
    insert into public.profiles (id, user_id, username, name) values ('${P.alice}', '${U.alice}', 'alice', 'Alice'), ('${P.bob}', '${U.bob}', 'bob', 'Bob');
    insert into public.organization_members (profile_id, user_id) values ('${P.alice}', '${U.staff}');`);
  return db;
}
// Run SQL as an API role with a JWT subject (like PostgREST does).
const as = async (db, role, sub, query, searchPath) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);${searchPath ? ` set search_path = ${searchPath};` : ""}`);
  try { return await db.query(query); } finally { await db.exec(`reset role; reset search_path; select set_config('request.jwt.claim.sub','', false);`); }
};
const user = async (db, id) => (await db.query(`select * from public.users where id='${id}'`)).rows[0];
const prof = async (db, id) => (await db.query(`select * from public.profiles where id='${id}'`)).rows[0];
const refusedBy = async (fn, text) => ((await errOf(fn)) || "").includes(text);

// ====================================================================================================================
console.log("### 0. CONTROL: before the guards exist, every attack really works (proves the checks below are meaningful)");
let db = await fresh();
await as(db, "authenticated", U.alice, `update public.users set role = 'admin' where id='${U.alice}'`);
check("control: an ordinary user CAN make themselves admin", (await user(db, U.alice)).role === "admin");
await db.exec(`update public.users set role = 'creator' where id='${U.alice}'`);
await as(db, "authenticated", U.alice, `update public.users set plan_id = '${PID(77)}', status = 'active', can_approve_requests = true, plan_expires_at = now() + interval '9999 days', payment_provider = 'stripe', stripe_customer_id = 'cus_x' where id='${U.alice}'`);
const a0 = await user(db, U.alice);
check("control: they CAN set plan_id, can_approve_requests, plan_expires_at and billing columns", a0.plan_id === PID(77) && a0.can_approve_requests === true && a0.payment_provider === "stripe");
await db.exec(`update public.users set status = 'suspended' where id='${U.bob}'`);
await as(db, "authenticated", U.bob, `update public.users set status = 'active' where id='${U.bob}'`);
check("control: a suspended user CAN un-suspend themselves", (await user(db, U.bob)).status === "active");
await as(db, "authenticated", U.alice, `update public.profiles set verified = true where id='${P.alice}'`);
check("control: an owner CAN set verified on their own profile", (await prof(db, P.alice)).verified === true);
await db.exec(`update public.profiles set verified = false where id='${P.alice}'`);
await as(db, "authenticated", U.staff, `update public.profiles set user_id = '${U.staff}' where id='${P.alice}'`);
check("control: staff with settings.manage CAN take over the profile (user_id)", (await prof(db, P.alice)).user_id === U.staff);
await db.exec(`update public.profiles set user_id = '${U.alice}' where id='${P.alice}'`);
await db.exec(`insert into public.products (id, profile_id, name, landing_url) values ('${PID(90)}', '${P.alice}', 'P', 'javascript:alert(1)')`);
check("control: a javascript: link CAN be stored", (await db.query(`select landing_url from public.products where id='${PID(90)}'`)).rows[0].landing_url.startsWith("javascript:"));
await db.exec(`insert into public.payment_transactions (user_id, provider, provider_transaction_id, status) values ('${U.alice}', 'stripe', 'cs_dup', 'success'), ('${U.alice}', 'stripe', 'cs_dup', 'success')`);
check("control: a duplicate (provider, transaction) payment row CAN be stored", (await db.query(`select count(*)::int c from public.payment_transactions where provider_transaction_id='cs_dup'`)).rows[0].c === 2);
const st0 = (await db.query(VERIFY)).rows;
check("control: the read-only verification reports FAIL on the unguarded database", st0.some((r) => r.grp === "ZZ" && r.status === "FAIL"), JSON.stringify(st0.filter((r) => r.grp === "ZZ")));
check("control: the verification script ran as a single read-only SELECT", !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(VERIFY.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "")));

// ====================================================================================================================
console.log("### 1. users guard: apply the REAL migration (with its built-in self-test)");
db = await fresh();
check("the users migration applies and commits (preconditions, trigger, self-test, postconditions)", (await errOf(() => db.exec(M_USERS))) === null);
const snap = JSON.stringify((await db.query(`select * from public.users order by id`)).rows);
check("the migration's self-test left no trace on any existing row", snap.includes("alice@example.com") && (await user(db, U.alice)).role === "creator");
check("guard function is SECURITY INVOKER with a pinned search_path", (await db.query(`select not prosecdef s, proconfig::text c from pg_proc where proname='protect_users_privileged_columns'`)).rows.every((r) => r.s && r.c.includes("search_path=pg_catalog, public, pg_temp")));
check("no API role can EXECUTE the guard function", !(await db.query(`select bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) x from pg_proc p, (values ('anon'),('authenticated'),('service_role')) v(r) where p.proname='protect_users_privileged_columns'`)).rows[0].x);

console.log("### 2. users: attacks by an ordinary signed-in user");
const attacks = {
  "role -> admin": `update public.users set role = 'admin' where id='${U.alice}'`,
  "plan_id": `update public.users set plan_id = '${PID(77)}' where id='${U.alice}'`,
  "status (change)": `update public.users set status = 'suspended' where id='${U.alice}'`,
  "can_approve_requests": `update public.users set can_approve_requests = true where id='${U.alice}'`,
  "email": `update public.users set email = 'admin@example.com' where id='${U.alice}'`,
  "plan_expires_at (production-only column)": `update public.users set plan_expires_at = now() + interval '9999 days' where id='${U.alice}'`,
  "payment_provider (production-only column)": `update public.users set payment_provider = 'stripe' where id='${U.alice}'`,
  "stripe_subscription_id (production-only column)": `update public.users set stripe_subscription_id = 'sub_x' where id='${U.alice}'`,
  "billing_interval (production-only column)": `update public.users set billing_interval = 'yearly' where id='${U.alice}'`,
  "affiliate_code (now refused loudly)": `update public.users set affiliate_code = 'HACKED' where id='${U.alice}'`,
  "referred_by": `update public.users set referred_by = '${U.bob}' where id='${U.alice}'`,
  "affiliate_payout_details": `update public.users set affiliate_payout_details = '{"phone":"1"}' where id='${U.alice}'`,
  "id (primary key)": `update public.users set id = '${UID(55)}' where id='${U.alice}'`,
  "allowed + forbidden in ONE statement": `update public.users set last_active_at = now(), role = 'admin' where id='${U.alice}'`,
  "UPDATE ... FROM": `update public.users u set role = s.v from (select 'admin'::text v) s where u.id='${U.alice}'`,
  "multi-row UPDATE touching a protected column": `update public.users set plan_id = '${PID(77)}' where id in ('${U.alice}', '${U.bob}')`,
};
for (const [name, q] of Object.entries(attacks)) check(`refused: ${name}`, await refusedBy(() => as(db, "authenticated", U.alice, q), U_ERR));
await db.exec(`update public.users set status = 'suspended' where id='${U.bob}'`);
check("refused: a SUSPENDED user cannot un-suspend themselves", await refusedBy(() => as(db, "authenticated", U.bob, `update public.users set status = 'active' where id='${U.bob}'`), U_ERR) && (await user(db, U.bob)).status === "suspended");
await db.exec(`update public.users set status = 'active' where id='${U.bob}'`);
check("refused: an ADMIN's own browser session cannot change roles either (admin writes go through the service-role routes)", await refusedBy(() => as(db, "authenticated", U.admin, `update public.users set role = 'admin', plan_id = '${PID(77)}' where id='${U.bob}'`), U_ERR));
await db.exec(`create policy "TEST worst-case insert for upsert" on public.users for insert with check (true)`);
check("refused: upsert with ON CONFLICT DO UPDATE cannot bypass it (worst case: an insert policy exists)", await refusedBy(() => as(db, "authenticated", U.alice, `insert into public.users (id, email) values ('${U.alice}', 'alice@example.com') on conflict (id) do update set role = 'admin'`), U_ERR));
await db.exec(`drop policy "TEST worst-case insert for upsert" on public.users`);
check("refused: an INSERT of a privileged row (worst case: a permissive insert policy exists)", await (async () => {
  await db.exec(`create policy "TEST worst-case insert" on public.users for insert with check (true)`);
  await db.exec(`insert into auth.users (id, email) values ('${UID(60)}', 'new@example.com')`);
  const a = await refusedBy(() => as(db, "authenticated", UID(60), `insert into public.users (id, email, role) values ('${UID(60)}', 'new@example.com', 'admin')`), U_ERR);
  const b = await refusedBy(() => as(db, "authenticated", UID(60), `insert into public.users (id, email, can_approve_requests) values ('${UID(60)}', 'new@example.com', true)`), U_ERR);
  const c = (await errOf(() => as(db, "authenticated", UID(60), `insert into public.users (id, email) values ('${UID(60)}', 'new@example.com')`))) === null;
  await db.exec(`drop policy "TEST worst-case insert" on public.users; delete from public.users where id = '${UID(60)}'`);
  return a && b && c;
})());
const after = await user(db, U.alice);
check("no attack left any trace", after.role === "creator" && after.plan_id === null && after.status === "active" && after.can_approve_requests === false && after.payment_provider === null && after.affiliate_code === null);
check("anon cannot update anything (no policy) and cannot change a role", (await as(db, "anon", null, `update public.users set role = 'admin' where id='${U.alice}' returning id`)).rows.length === 0);
check("another user's row is untouched and still protected", (await user(db, U.bob)).role === "creator");

console.log("### 2b. users: mixed-update atomicity, future columns, anon with a permissive policy");
{
  const beforeMixed = JSON.stringify(await user(db, U.alice));
  let mixedErr = null;
  try {
    await as(db, "authenticated", U.alice, `update public.users set last_active_at = now(), onboarding_completed_at = now(), pwa_installed_at = now(), role = 'admin', plan_id = '${PID(77)}', status = 'suspended', can_approve_requests = true where id='${U.alice}'`);
  } catch (e) { mixedErr = e; }
  check("MIXED UPDATE (3 legitimate columns + role + plan_id + status + can_approve_requests) is refused as a whole", !!mixedErr && mixedErr.message.includes(U_ERR));
  check("...and the refusal names exactly the privileged columns (never the legitimate ones)", !!mixedErr && String(mixedErr.detail || "") === "can_approve_requests, plan_id, role, status", String(mixedErr && mixedErr.detail));
  check("...and NOTHING partially succeeded: not even the legitimate columns were written (one statement, one outcome)", JSON.stringify(await user(db, U.alice)) === beforeMixed);
  // a column that does not exist today but is added later (privileged by default under an allowlist)
  await db.exec(`alter table public.users add column future_admin_flag boolean not null default false, add column internal_notes text, add column credit_balance numeric not null default 0`);
  for (const q of [`future_admin_flag = true`, `internal_notes = 'x'`, `credit_balance = 1000000`])
    check(`a column ADDED LATER is protected automatically (allowlist): ${q.split(" =")[0]}`, await refusedBy(() => as(db, "authenticated", U.alice, `update public.users set ${q} where id='${U.alice}'`), U_ERR));
  await db.exec(`alter table public.users drop column future_admin_flag, drop column internal_notes, drop column credit_balance`);
  // anon: even with a deliberately over-permissive UPDATE policy, the TRIGGER refuses
  await db.exec(`create policy "TEST worst-case anon update" on public.users for update to anon using (true); create policy "TEST worst-case anon select" on public.users for select to anon using (true)`);
  check("anon cannot bypass it even if a policy let anon UPDATE every row (the trigger, not RLS, is what refuses)", await refusedBy(() => as(db, "anon", null, `update public.users set role = 'admin' where id='${U.alice}'`), U_ERR));
  check("...nor change plan_id / status / can_approve_requests", await refusedBy(() => as(db, "anon", null, `update public.users set plan_id = '${PID(77)}', status = 'active', can_approve_requests = true where id='${U.alice}'`), U_ERR));
  await db.exec(`drop policy "TEST worst-case anon update" on public.users; drop policy "TEST worst-case anon select" on public.users`);
  check("no trace from any of those attacks", (await user(db, U.alice)).role === "creator" && (await user(db, U.alice)).plan_id === null);
}

console.log("### 3. users: legitimate behaviour is unchanged");
await as(db, "authenticated", U.alice, `update public.users set last_active_at = now(), last_active_standalone = true, pwa_installed_at = now(), onboarding_completed_at = now(), onboarding_dismissed_at = now() where id='${U.alice}'`);
check("self-service telemetry / onboarding columns can still be written by the user", (await user(db, U.alice)).pwa_installed_at !== null && (await user(db, U.alice)).onboarding_completed_at !== null);
check("a full-row style update that re-sends the protected columns UNCHANGED is allowed", (await errOf(() => as(db, "authenticated", U.alice, `update public.users set role = role, plan_id = plan_id, status = status, can_approve_requests = can_approve_requests, email = email, last_active_at = now() where id='${U.alice}'`))) === null);
await as(db, "service_role", null, `update public.users set role = 'admin', plan_id = '${PID(78)}', status = 'suspended', can_approve_requests = true, plan_expires_at = now(), payment_provider = 'fapshi' where id='${U.bob}'`);
const b1 = await user(db, U.bob);
check("service_role (the admin / billing / webhook routes) can still change every privileged column", b1.role === "admin" && b1.plan_id === PID(78) && b1.status === "suspended" && b1.can_approve_requests === true && b1.payment_provider === "fapshi");
await db.exec(`update public.users set role = 'creator', status = 'active', can_approve_requests = false where id='${U.bob}'`);
check("the table owner (migrations, SQL editor) is unaffected", (await user(db, U.bob)).role === "creator");
await db.exec(`grant all on public.users to supabase_auth_admin; alter role supabase_auth_admin bypassrls`);
check("the internal supabase_auth_admin role (GoTrue) is not blocked", (await errOf(() => as(db, "supabase_auth_admin", null, `update public.users set email = 'bob2@example.com' where id='${U.bob}'`))) === null && (await user(db, U.bob)).email === "bob2@example.com");
await db.exec(`create function public.signup_sim(p_id uuid, p_email text) returns void language plpgsql security definer set search_path = public as $$ begin insert into public.users (id, email) values (p_id, p_email); end $$`);
await db.exec(`insert into auth.users (id, email) values ('${UID(61)}', 'signup@example.com')`);
await db.query(`select public.signup_sim('${UID(61)}', 'signup@example.com')`);
check("signup through a SECURITY DEFINER function (the real signup path) still creates the account", (await user(db, UID(61))).role === "creator");
await as(db, "service_role", null, `update public.users set affiliate_code = 'ABC123' where id='${U.alice}'`);
check("service_role can still assign an affiliate code (set_affiliate_code / admin flows)", (await user(db, U.alice)).affiliate_code === "ABC123");

console.log("### 3b. users: every legitimate application writer still works (exact column sets used by the code)");
{
  await db.exec(`grant all on public.users to supabase_admin; alter role supabase_admin bypassrls`);
  check("the internal supabase_admin role is not blocked", (await errOf(() => as(db, "supabase_admin", null, `update public.users set role = 'creator', plan_id = '${PID(70)}' where id='${U.bob}'`))) === null);
  // each: [who in the code, the SQL that writer issues through the service-role client]
  const WRITERS = [
    ["middleware activity ping (src/middleware.ts)", `update public.users set last_active_at = now() where id='${U.alice}'`],
    ["/api/activity/session", `update public.users set last_active_at = now(), last_active_standalone = true where id='${U.alice}'`],
    ["/api/onboarding/complete", `update public.users set onboarding_completed_at = now() where id='${U.alice}'`],
    ["/api/pwa/install", `update public.users set pwa_installed_at = now() where id='${U.alice}'`],
    ["Stripe webhook: checkout.session.completed", `update public.users set plan_id = '${PID(78)}', payment_provider = 'stripe', billing_interval = 'monthly', stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1', plan_expires_at = null where id='${U.alice}'`],
    ["Fapshi: applySuccessfulPayment", `update public.users set plan_id = '${PID(78)}', payment_provider = 'fapshi', billing_interval = 'yearly', plan_expires_at = now() + interval '365 days' where id='${U.alice}'`],
    ["card bundle grant (cardBundle.ts)", `update public.users set plan_id = '${PID(79)}', payment_provider = 'fapshi', plan_expires_at = now() + interval '30 days' where id='${U.alice}'`],
    ["downgrade-expired cron", `update public.users set plan_id = '${PID(70)}', payment_provider = null, plan_expires_at = null where id='${U.alice}'`],
    ["/api/billing/cancel", `update public.users set plan_id = '${PID(70)}', payment_provider = null, stripe_subscription_id = null where id='${U.alice}'`],
    ["admin: suspend / un-suspend (admin/users/[id])", `update public.users set status = 'suspended' where id='${U.alice}'`],
    ["admin: grant super-creator (admin/users/[id])", `update public.users set can_approve_requests = true where id='${U.alice}'`],
    ["admin: affiliate suspend (admin/affiliate/users/[id])", `update public.users set affiliate_suspended = true where id='${U.alice}'`],
    ["affiliate payout settings (lib/affiliate.ts)", `update public.users set affiliate_payout_method = 'mobile_money', affiliate_payout_details = '{"phone":"1"}' where id='${U.alice}'`],
    ["affiliate code assignment (lib/affiliate.ts)", `update public.users set affiliate_code = 'SVC001' where id='${U.alice}'`],
    ["demo account creation (demo/create)", `update public.users set plan_id = '${PID(78)}' where id='${U.bob}'`],
    ["signup approval (admin/requests/[id]/approve)", `update public.users set plan_id = '${PID(78)}', plan_expires_at = now() + interval '30 days', payment_provider = 'manual', billing_interval = 'monthly' where id='${U.bob}'`],
  ];
  for (const [who, q] of WRITERS) check(`service_role writer still works: ${who}`, (await errOf(() => as(db, "service_role", null, q))) === null);
  await db.exec(`update public.users set role = 'creator', status = 'active', can_approve_requests = false, affiliate_suspended = false where id in ('${U.alice}', '${U.bob}')`);
  // promoting someone is a service-role operation (the admin routes use the admin client), not the admin's own browser session
  check("an admin changes another user's role through the service-role route (admin/users/[id] uses the admin client)", (await errOf(() => as(db, "service_role", null, `update public.users set role = 'admin' where id='${U.bob}'`))) === null && (await user(db, U.bob)).role === "admin");
  await db.exec(`update public.users set role = 'creator' where id='${U.bob}'`);
  // the table owner running a SECURITY DEFINER function on behalf of a signed-in caller is still the owner (the signup-trigger shape)
  await db.exec(`create function public.owner_op_sim(p_id uuid) returns void language plpgsql security definer set search_path = public as $$ begin update public.users set plan_id = null, status = 'active' where id = p_id; end $$; grant execute on function public.owner_op_sim(uuid) to authenticated`);
  await db.exec(`update public.users set status = 'suspended' where id='${U.alice}'`);
  check("a SECURITY DEFINER function owned by the table owner can still perform a privileged update", (await errOf(() => as(db, "authenticated", U.alice, `select public.owner_op_sim('${U.alice}')`))) === null && (await user(db, U.alice)).status === "active");
}

console.log("### 4. users guard: verification script, rollback and re-apply");
let ver = (await db.query(VERIFY)).rows;
check("verification: users group A1 all PASS", ver.filter((r) => r.grp === "A1").every((r) => r.status === "PASS") && ver.filter((r) => r.grp === "A1").length === 3, JSON.stringify(ver.filter((r) => r.grp === "A1")));
await db.exec(RB.users);
check("rollback removes only the trigger and function", (await db.query(`select count(*)::int c from pg_trigger where tgname='trg_a_protect_users_privileged'`)).rows[0].c === 0);
await as(db, "authenticated", U.alice, `update public.users set role = 'admin' where id='${U.alice}'`);
check("after rollback the weakness is back (so the guard is what closed it)", (await user(db, U.alice)).role === "admin");
await db.exec(`update public.users set role = 'creator' where id='${U.alice}'`);
check("the migration re-applies cleanly after a rollback", (await errOf(() => db.exec(M_USERS))) === null && await refusedBy(() => as(db, "authenticated", U.alice, `update public.users set role = 'admin' where id='${U.alice}'`), U_ERR));
check("applying it a second time is harmless (idempotent)", (await errOf(() => db.exec(M_USERS))) === null);

// ====================================================================================================================
console.log("### 5. profiles guard");
db = await fresh();
check("the profiles migration applies and commits", (await errOf(() => db.exec(M_PROFILES))) === null);
check("its self-test left no trace", (await prof(db, P.alice)).verified === false && (await prof(db, P.alice)).user_id === U.alice);
check("refused: an owner sets verified on their own profile", await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set verified = true where id='${P.alice}'`), P_ERR));
check("refused: staff with settings.manage sets verified", await refusedBy(() => as(db, "authenticated", U.staff, `update public.profiles set verified = true where id='${P.alice}'`), P_ERR));
check("refused: staff TAKES OVER the business by changing user_id", await refusedBy(() => as(db, "authenticated", U.staff, `update public.profiles set user_id = '${U.staff}' where id='${P.alice}'`), P_ERR));
check("refused: an owner hands their profile to another user (user_id)", await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set user_id = '${U.bob}' where id='${P.alice}'`), P_ERR));
check("refused: changing the primary key", await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set id = '${PID(50)}' where id='${P.alice}'`), P_ERR));
check("refused: a legitimate edit and verified in the same statement", await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set bio = 'x', verified = true where id='${P.alice}'`), P_ERR));
check("refused: an INSERT of an already-verified profile", await refusedBy(() => as(db, "authenticated", U.alice, `insert into public.profiles (id, user_id, username, verified) values ('${PID(51)}', '${U.alice}', 'second', true)`), P_ERR));
check("refused: UPSERT ON CONFLICT DO UPDATE verified", await refusedBy(() => as(db, "authenticated", U.alice, `insert into public.profiles (id, user_id, username) values ('${P.alice}', '${U.alice}', 'alice') on conflict (id) do update set verified = true`), P_ERR));
check("no attack left any trace", (await prof(db, P.alice)).verified === false && (await prof(db, P.alice)).user_id === U.alice);
await as(db, "authenticated", U.alice, `update public.profiles set name = 'Alice 2', bio = 'hello', published = false, ordering_enabled = false, bookings_enabled = true, community_enabled = true, hub_support_enabled = false, team_badges_enabled = false, dine_in_enabled = false, takeaway_enabled = false, delivery_enabled = true, delivery_fee = 500, category = 'restaurant_food', categories = array['restaurant_food','music_entertainment'], theme_color = '#112233', whatsapp_number = '+237600000000', facebook_pixel_id = '123456789', avatar_url = 'https://x/y.png', opening_hours = '{"mon":"9-5"}', about_email = 'a@b.com', username = 'alice-renamed' where id='${P.alice}'`);
const edited = await prof(db, P.alice);
check("legitimate profile editing still works: name, bio, published, ordering_enabled, bookings, community, hub support, restaurant service toggles, delivery fee, categories, theme, WhatsApp, pixel, avatar, hours, contact, username", edited.name === "Alice 2" && edited.ordering_enabled === false && edited.published === false && edited.bookings_enabled === true && edited.community_enabled === true && edited.delivery_enabled === true && Number(edited.delivery_fee) === 500 && edited.category === "restaurant_food" && edited.categories.length === 2 && edited.theme_color === "#112233" && edited.username === "alice-renamed", JSON.stringify(edited));
await as(db, "authenticated", U.alice, `update public.profiles set ordering_enabled = true, published = true where id='${P.alice}'`);
check("ordering_enabled and published can be switched back on (they are owner settings, never protected)", (await prof(db, P.alice)).ordering_enabled === true && (await prof(db, P.alice)).published === true);
await as(db, "authenticated", U.staff, `update public.profiles set bio = 'staff edit' where id='${P.alice}'`);
check("staff with settings.manage can still edit ordinary profile settings", (await prof(db, P.alice)).bio === "staff edit");
check("re-sending the protected columns unchanged is allowed", (await errOf(() => as(db, "authenticated", U.alice, `update public.profiles set verified = verified, user_id = user_id, name = 'resent' where id='${P.alice}'`))) === null);
await as(db, "authenticated", U.alice, `insert into public.profiles (id, user_id, username) values ('${PID(52)}', '${U.alice}', 'another')`);
check("normal profile creation (own row, defaults) still works", (await prof(db, PID(52))).verified === false);
await as(db, "service_role", null, `update public.profiles set verified = true where id='${P.alice}'`);
check("service_role (the admin verification routes) can still grant verified", (await prof(db, P.alice)).verified === true);
await db.exec(`update public.profiles set verified = false, user_id = '${U.alice}' where id='${P.alice}'`);
check("the table owner is unaffected", (await prof(db, P.alice)).verified === false);
ver = (await db.query(VERIFY)).rows;
check("verification: profiles trigger B1 PASS", ver.some((r) => r.grp === "B1" && r.item.startsWith("profiles guard trigger") && r.status === "PASS"));
await db.exec(RB.profiles);
check("profiles rollback removes only this guard", (await db.query(`select count(*)::int c from pg_trigger where tgname='trg_a_protect_profile_privileged'`)).rows[0].c === 0);

// ====================================================================================================================
console.log("### 6. SECURITY DEFINER hardening");
db = await fresh();
// The control: has_org_permission (no search_path) can be fooled by a temp table; protect_affiliate_fields fails OPEN.
await db.exec(`grant temp on database template1 to public`).catch(() => null);
const hijack = async () => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.bob}', false);`);
  try {
    await db.exec(`create temp table organization_members (profile_id uuid, user_id uuid, status text)`);
    await db.exec(`insert into pg_temp.organization_members values ('${P.alice}', '${U.bob}', 'active')`);
    return (await db.query(`select public.has_org_permission('${P.alice}', 'settings.manage') ok`)).rows[0].ok;
  } finally { await db.exec(`drop table if exists pg_temp.organization_members; reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
check("control: before the migration a caller-created temp table makes has_org_permission() trust a fake membership", (await hijack().catch((e) => e.message)) === true);
// fail-open control: is_admin() breaks -> the old guard lets the attack through
await db.exec(`create or replace function public.is_admin() returns boolean language plpgsql security definer as $$ begin raise exception 'boom'; end $$`);
await as(db, "authenticated", U.alice, `update public.users set affiliate_code = 'STOLEN', referred_by = '${U.bob}' where id='${U.alice}'`).catch(() => null);
check("control: the OLD protect_affiliate_fields fails OPEN (a failure inside it lets the protected columns change)", (await user(db, U.alice)).affiliate_code === "STOLEN");
await db.exec(`update public.users set affiliate_code = null, referred_by = null where id='${U.alice}'`);
await db.exec(`create or replace function public.is_admin() returns boolean as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$ language sql security definer`);
// representative trigger functions that call pgcrypto from the "extensions" schema, with NO search_path (as in the repo)
await db.exec(`
  create table public.restaurant_tables (id uuid primary key default gen_random_uuid(), public_code text);
  create function public.set_table_public_code() returns trigger as $$ begin new.public_code := replace(encode(gen_random_bytes(6), 'hex'), '/', ''); return new; end; $$ language plpgsql security definer;
  create trigger trg_table_code before insert on public.restaurant_tables for each row execute function public.set_table_public_code();
  grant all on public.restaurant_tables to authenticated, service_role;`);
check("control: with a session path that lacks 'extensions', the unpinned code generator FAILS (why the path must be pinned WITH extensions)", (await errOf(() => as(db, "authenticated", U.alice, `insert into public.restaurant_tables default values`, "public"))) !== null);
const before = (await db.query(`select proname, prosecdef, proowner::regrole::text o, proacl::text acl from pg_proc where proname in ('has_org_permission','is_admin','set_table_public_code') order by 1`)).rows;
check("the definer migration applies and commits (missing functions are skipped, not fatal)", (await errOf(() => db.exec(M_DEFINER))) === null);
const aft = (await db.query(`select proname, prosecdef, proowner::regrole::text o, proacl::text acl, proconfig::text cfg from pg_proc where proname in ('has_org_permission','is_admin','set_table_public_code','protect_affiliate_fields') order by 1`)).rows;
check("every function present now has a pinned search_path ending in pg_temp", aft.every((r) => r.cfg && r.cfg.includes("pg_temp")), JSON.stringify(aft.map((r) => [r.proname, r.cfg])));
check("the pgcrypto-based code generator's path includes 'extensions' (and ends with pg_temp)", /extensions.*pg_temp/.test(aft.find((r) => r.proname === "set_table_public_code").cfg));
check("the plain helpers' path is pg_catalog, public, pg_temp only", aft.find((r) => r.proname === "is_admin").cfg.includes("extensions") === false && aft.find((r) => r.proname === "has_org_permission").cfg.includes("extensions") === false);
check("ownership, SECURITY DEFINER flag and grants are unchanged by the migration", before.every((b) => { const a = aft.find((x) => x.proname === b.proname); return a && a.prosecdef === b.prosecdef && a.o === b.o && a.acl === b.acl; }));
check("the temp-table hijack no longer works after the migration", (await hijack().catch((e) => e.message)) === false);
// protect_affiliate_fields fail closed
await db.exec(`create or replace function public.is_admin() returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$ begin raise exception 'boom'; end $$`);
check("protect_affiliate_fields now fails CLOSED: a failure inside it refuses the update", (await errOf(() => as(db, "authenticated", U.alice, `update public.users set affiliate_code = 'STOLEN' where id='${U.alice}'`))) !== null && (await user(db, U.alice)).affiliate_code === null);
await db.exec(`create or replace function public.is_admin() returns boolean as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$ language sql security definer set search_path = pg_catalog, public, pg_temp`);
await as(db, "authenticated", U.alice, `update public.users set affiliate_code = 'STOLEN', referred_by = '${U.bob}' where id='${U.alice}'`);
check("a normal non-admin attempt is still silently reverted (behaviour preserved)", (await user(db, U.alice)).affiliate_code === null && (await user(db, U.alice)).referred_by === null);
check("service_role (auth.uid() is null) is not blocked: it short-circuits before is_admin()", (await errOf(() => as(db, "service_role", null, `update public.users set affiliate_code = 'GOOD1' where id='${U.alice}'`))) === null && (await user(db, U.alice)).affiliate_code === "GOOD1");
await db.exec(`create or replace function public.is_admin() returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$ begin raise exception 'boom'; end $$`);
check("...even when is_admin() is broken (signup / admin API / webhooks cannot be blocked by this guard)", (await errOf(() => as(db, "service_role", null, `update public.users set affiliate_code = 'GOOD2' where id='${U.alice}'`))) === null);
await db.exec(`create or replace function public.is_admin() returns boolean as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$ language sql security definer set search_path = pg_catalog, public, pg_temp`);
check("the code generator works with a session path that lacks 'extensions' after the migration", (await errOf(() => as(db, "authenticated", U.alice, `insert into public.restaurant_tables default values`, "public"))) === null);
check("the migration is idempotent (applies a second time)", (await errOf(() => db.exec(M_DEFINER))) === null);
ver = (await db.query(VERIFY)).rows;
check("verification: C1 rows PASS (every listed function pinned, no exception handler)", ver.filter((r) => r.grp === "C1" && r.status !== "INFO").every((r) => r.status === "PASS"), JSON.stringify(ver.filter((r) => r.grp === "C1")));
await db.exec(RB.definer);
check("rollback removes the pinned paths again", (await db.query(`select count(*)::int c from pg_proc where proname in ('has_org_permission','is_admin','set_table_public_code') and proconfig is not null`)).rows[0].c === 0);

// ====================================================================================================================
console.log("### 7. payment idempotency index");
db = await fresh();
await db.exec(`insert into public.payment_transactions (user_id, provider, provider_transaction_id) values ('${U.alice}', 'stripe', 'cs_dup'), ('${U.alice}', 'stripe', 'cs_dup')`);
const dupErr = await errOf(() => db.exec(M_PAYMENTS));
check("with duplicates already present the migration STOPS and says why", !!dupErr && dupErr.includes("cannot create the unique index") && dupErr.includes("Nothing was changed"), dupErr);
check("...and changes no row and creates no index", (await db.query(`select count(*)::int c from public.payment_transactions`)).rows[0].c === 2 && (await db.query(`select count(*)::int c from pg_indexes where indexname = 'payment_transactions_provider_txn_uidx'`)).rows[0].c === 0);
await db.exec(`delete from public.payment_transactions where provider_transaction_id = 'cs_dup'`);
check("without duplicates the migration applies", (await errOf(() => db.exec(M_PAYMENTS))) === null);
check("a second delivery of the same Stripe session is refused by the database (23505)", await refusedBy(() => db.exec(`insert into public.payment_transactions (user_id, provider, provider_transaction_id, status) values ('${U.alice}', 'stripe', 'cs_1', 'success'), ('${U.alice}', 'stripe', 'cs_1', 'success')`), "duplicate key"));
await db.exec(`insert into public.payment_transactions (user_id, provider, provider_transaction_id) values ('${U.alice}', 'fapshi', 'cs_1'), ('${U.alice}', 'manual', null), ('${U.bob}', 'manual', null)`);
check("the same id under a different provider, and several rows without a provider id, remain allowed", (await db.query(`select count(*)::int c from public.payment_transactions where provider_transaction_id is null`)).rows[0].c === 2);
check("applying it again is a no-op", (await errOf(() => db.exec(M_PAYMENTS))) === null);
ver = (await db.query(VERIFY)).rows;
check("verification: D1 PASS", ver.some((r) => r.grp === "D1" && r.status === "PASS"));
await db.exec(RB.payments);
check("rollback drops only the index", (await db.query(`select count(*)::int c from pg_indexes where indexname = 'payment_transactions_provider_txn_uidx'`)).rows[0].c === 0 && (await db.query(`select count(*)::int c from public.payment_transactions`)).rows[0].c >= 3);
const db2 = new PGlite();
check("on a database without the table the migration does nothing and does not fail", (await errOf(() => db2.exec(M_PAYMENTS))) === null);

// ====================================================================================================================
console.log("### 8. unsafe URL scheme guard");
db = await fresh();
// legacy rows that predate the rule
await db.exec(`insert into public.products (id, profile_id, name, price, landing_url) values ('${PID(91)}', '${P.alice}', 'Legacy', 5, 'javascript:legacy()'), ('${PID(92)}', '${P.alice}', 'Plain', 5, 'example.com')`);
check("the URL guard migration applies and commits", (await errOf(() => db.exec(M_URLS))) === null);
const bad = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)", "jav\r\nascript:alert(1)",
  "data:text/html,<script>alert(1)</script>", "DATA:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://example.com/x", "blob:https://example.com/uuid", "about:blank", "chrome://settings", "livescript:x", "mocha:x"];
const good = ["https://example.com", "http://example.com/a?b=c#d", "HTTPS://EXAMPLE.COM", "mailto:me@example.com", "tel:+237677123456", "sms:+237677123456", "whatsapp://send?phone=237677123456", "example.com", "wa.me/237677123456", "instagram.com/name", "/relative/path", "", "   "];
const cols = [["products", "landing_url", (v) => `insert into public.products (profile_id, name, landing_url) values ('${P.alice}', 'n', $1)`],
  ["tracks", "buy_url", () => `insert into public.tracks (profile_id, title, buy_url) values ('${P.alice}', 't', $1)`],
  ["tracks", "external_url", () => `insert into public.tracks (profile_id, title, external_url) values ('${P.alice}', 't', $1)`],
  ["events", "ticket_url", () => `insert into public.events (profile_id, title, ticket_url) values ('${P.alice}', 'e', $1)`],
  ["links", "url", () => `insert into public.links (profile_id, url) values ('${P.alice}', $1)`],
  ["social_links", "url", () => `insert into public.social_links (profile_id, url) values ('${P.alice}', $1)`],
  ["community_announcements", "link_url", () => `insert into public.community_announcements (profile_id, title, link_url) values ('${P.alice}', 't', $1)`]];
for (const [tbl, col, ins] of cols) {
  let refusedAll = true, acceptedAll = true; const why = [];
  for (const v of bad) { const e = await errOf(() => db.query(ins(), [v])); if (!e || !e.includes(URL_ERR)) { refusedAll = false; why.push(JSON.stringify(v)); } }
  for (const v of good) { const e = await errOf(() => db.query(ins(), [v])); if (e && !(col === "url" && v.trim() === "")) { acceptedAll = false; why.push("rejected good " + JSON.stringify(v) + ": " + e.slice(0, 60)); } }
  check(`${tbl}.${col}: every executable / unknown scheme is refused on INSERT (${bad.length} variants)`, refusedAll, why.join(" | "));
  check(`${tbl}.${col}: every legitimate value is accepted (https, http, mailto, tel, sms, whatsapp, bare domains)`, acceptedAll, why.join(" | "));
}
const fresh1 = (await db.query(`insert into public.products (profile_id, name, landing_url) values ('${P.alice}', 'ok', 'https://ok.example') returning id`)).rows[0].id;
check("UPDATE to a javascript: value is refused", await refusedBy(() => db.query(`update public.products set landing_url = 'javascript:alert(1)' where id = $1`, [fresh1]), URL_ERR));
check("UPDATE to an obfuscated value is refused", await refusedBy(() => db.query(`update public.products set landing_url = E'java\\tscript:alert(1)' where id = $1`, [fresh1]), URL_ERR));
check("refused for the service role too (it is not exempt)", await refusedBy(() => as(db, "service_role", null, `update public.products set landing_url = 'javascript:alert(1)' where id = '${fresh1}'`), URL_ERR));
check("refused for an ordinary authenticated user calling the API", await refusedBy(() => as(db, "authenticated", U.alice, `update public.products set landing_url = 'data:text/html,x' where id = '${fresh1}'`), URL_ERR));
await db.exec(`update public.products set name = 'Legacy renamed', price = 9 where id = '${PID(91)}'`);
check("a LEGACY row holding a bad value can still be edited (price / name): existing data is never made unwritable", (await db.query(`select name from public.products where id='${PID(91)}'`)).rows[0].name === "Legacy renamed");
check("...and re-saving the SAME legacy value is allowed (not re-judged)", (await errOf(() => db.exec(`update public.products set landing_url = landing_url, price = 11 where id = '${PID(91)}'`))) === null);
check("...but CHANGING it to another unsafe value is refused", await refusedBy(() => db.exec(`update public.products set landing_url = 'vbscript:x' where id = '${PID(91)}'`), URL_ERR));
await db.exec(`update public.products set landing_url = 'https://fixed.example' where id = '${PID(91)}'`);
check("...and replacing it with a safe value works", (await db.query(`select landing_url from public.products where id='${PID(91)}'`)).rows[0].landing_url === "https://fixed.example");
ver = (await db.query(VERIFY)).rows;
check("verification: E1 PASS for all six tables", ver.filter((r) => r.grp === "E1").length === 6 && ver.filter((r) => r.grp === "E1").every((r) => r.status === "PASS"), JSON.stringify(ver.filter((r) => r.grp === "E1")));
const dbMissing = new PGlite();
await dbMissing.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create table public.products (id uuid primary key default gen_random_uuid(), name text, landing_url text)`);
check("on a database where some tables / columns are absent the migration skips them without failing", (await errOf(() => dbMissing.exec(M_URLS))) === null);
check("...and the tables that are present are still guarded", await refusedBy(() => dbMissing.exec(`insert into public.products (name, landing_url) values ('x', 'javascript:1')`), URL_ERR));
await db.exec(RB.urls);
check("rollback removes only the triggers and the function", (await db.query(`select count(*)::int c from pg_trigger where tgname like 'trg_a_unsafe_url_%'`)).rows[0].c === 0 && (await db.query(`select count(*)::int c from pg_proc where proname='reject_unsafe_url_columns'`)).rows[0].c === 0);

// ====================================================================================================================
console.log("### 9. all migrations together, in order, on one database");
db = await fresh();
check("applies in sequence: the EXISTING demo-flag guard (2026-10-16), untouched", (await errOf(() => db.exec(M_DEMO))) === null);
for (const [n, m] of [["users", M_USERS], ["profiles", M_PROFILES], ["definer", M_DEFINER], ["payments", M_PAYMENTS], ["urls", M_URLS]]) check(`applies in sequence: ${n}`, (await errOf(() => db.exec(m))) === null);
ver = (await db.query(VERIFY)).rows;
check("verification: every check passes after all five are applied (overall PASS)", ver.some((r) => r.grp === "ZZ" && r.status === "PASS"), JSON.stringify(ver.filter((r) => r.status === "FAIL")));
check("both profile guards coexist: demo flags and verified / user_id are each refused", await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set is_demo = true where id='${P.alice}'`), "demo_flag_protected") && await refusedBy(() => as(db, "authenticated", U.alice, `update public.profiles set verified = true where id='${P.alice}'`), P_ERR));
check("the privilege-escalation chain from the audit is closed end to end", await refusedBy(() => as(db, "authenticated", U.alice, `update public.users set role = 'admin', plan_id = '${PID(77)}', can_approve_requests = true where id='${U.alice}'`), U_ERR));

// ====================================================================================================================
// the ORIGINAL function definitions, read from the repository's own (unmodified) migrations at run time
const ORIG_FILES = ["supabase/schema.sql", ...fs.readdirSync(REPO + "supabase/migrations").filter((f) => /\.sql$/.test(f) && !f.startsWith("2026-10-06")).sort().map((f) => "supabase/migrations/" + f)];
const originalFn = (name) => {
  let last = null;
  const re = new RegExp(`create (?:or replace )?function\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$[^;]*;`, "gi");
  for (const f of ORIG_FILES) for (const m of sql(f).replace(/--[^\n]*/g, "").matchAll(re)) last = m[0];
  if (!last) throw new Error("original function not found: " + name);
  return last;
};

console.log("### 7b. duplicate Stripe delivery vs the REAL affiliate-commission trigger");
{
  const mk = async () => {
    const d = await fresh();
    await d.exec(`
      create table public.platform_settings (id uuid primary key default gen_random_uuid(), affiliate_enabled boolean not null default true, affiliate_commission_rate numeric(5,4) not null default 0.2000, affiliate_hold_days int not null default 14);
      insert into public.platform_settings default values;
      create table public.affiliate_commissions (id uuid primary key default gen_random_uuid(), affiliate_user_id uuid not null references public.users(id) on delete cascade, referred_user_id uuid not null references public.users(id) on delete cascade,
        payment_transaction_id uuid not null unique references public.payment_transactions(id) on delete cascade, amount numeric(10,2) not null, currency text not null, commission_rate numeric(5,4) not null,
        status text not null default 'pending', available_at timestamptz not null, payout_id uuid, created_at timestamptz not null default now());
      alter table public.payment_transactions add column plan_name text, add column billing_interval text, add column amount numeric(12,2), add column currency text;
      ${originalFn("handle_payment_transaction_commission")}
      create trigger trg_payment_transaction_commission after insert or update of status on public.payment_transactions for each row execute function public.handle_payment_transaction_commission();
      update public.users set referred_by = '${U.bob}' where id = '${U.alice}';`);
    return d;
  };
  const pay = (id, amount = 20) => `insert into public.payment_transactions (user_id, provider, provider_transaction_id, plan_name, billing_interval, amount, currency, status) values ('${U.alice}', 'stripe', '${id}', 'pro', 'monthly', ${amount}, 'USD', 'success')`;
  const commissions = async (d) => (await d.query(`select count(*)::int c, coalesce(sum(amount),0)::float s from public.affiliate_commissions`)).rows[0];
  let d = await mk();
  await d.exec(pay("cs_1")); await d.exec(pay("cs_1"));
  const ctl = await commissions(d);
  check("control: WITHOUT the index a redelivered session makes a second payment row AND a second affiliate commission (the bug)", ctl.c === 2 && ctl.s === 8, JSON.stringify(ctl));
  d = await mk();
  check("the idempotency migration applies on the commission-bearing database", (await errOf(() => d.exec(M_PAYMENTS))) === null);
  await d.exec(pay("cs_1"));
  check("first delivery: one payment, one commission (20 USD x 20% = 4)", (await commissions(d)).c === 1 && (await commissions(d)).s === 4);
  check("redelivery of the same session is refused by the database", await refusedBy(() => d.exec(pay("cs_1")), "duplicate key"));
  check("...so NO second commission exists and the first is untouched", (await commissions(d)).c === 1 && (await commissions(d)).s === 4);
  await d.exec(`update public.payment_transactions set status = 'success' where provider_transaction_id = 'cs_1'`);
  check("re-marking the same payment as success (a replay of the status update) does not duplicate the commission either", (await commissions(d)).c === 1);
  await d.exec(pay("cs_2", 50));
  check("a genuinely different payment still works and earns its own commission (50 USD x 20% = 10)", (await commissions(d)).c === 2 && (await commissions(d)).s === 14);
  await d.exec(`insert into public.payment_transactions (user_id, provider, provider_transaction_id, plan_name, amount, currency, status) values ('${U.alice}', 'manual', null, 'pro', 5, 'USD', 'success'), ('${U.alice}', 'manual', null, 'pro', 5, 'USD', 'success')`);
  check("NULL provider_transaction_id is not constrained (manual / signup rows without a provider id keep working): two NULL rows coexist", (await d.query(`select count(*)::int c from public.payment_transactions where provider_transaction_id is null`)).rows[0].c === 2);
}

console.log("### 10. the REAL original function bodies, before and after the hardening migration");
{
  const FUNCS = ["is_admin", "has_org_permission", "is_org_member", "org_team_enabled", "set_table_public_code", "set_digital_ticket_code", "set_scanner_session_token", "set_affiliate_code", "reserve_event_ticket_type", "release_event_ticket_type", "protect_affiliate_fields"];
  const ID10 = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const T = { owner: ID10(1), staff: ID10(2), noperm: ID10(3), stranger: ID10(4), admin: ID10(5), planOn: ID10(21), planOff: ID10(22), pOn: ID10(31), pOff: ID10(32), roleX: ID10(41), roleNone: ID10(42), tt: ID10(51) };
  async function build() {
    const d = new PGlite();
    await d.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_auth_admin nologin;
      create schema auth; create schema extensions; create schema evil;
      grant usage on schema auth, public, extensions, evil to anon, authenticated, service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      -- pgcrypto stand-in in the "extensions" schema, like Supabase; a look-alike in a schema an attacker controls
      create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
      create function evil.gen_random_bytes(n int) returns bytea language sql as $$ select decode(repeat('cd', n), 'hex') $$;
      grant execute on function extensions.gen_random_bytes(int), evil.gen_random_bytes(int) to anon, authenticated, service_role;
      create table public.plans (id uuid primary key, team_enabled boolean not null default false);
      create table public.users (id uuid primary key, email text, role text not null default 'creator', plan_id uuid, affiliate_code text unique, referred_by uuid, affiliate_suspended boolean not null default false);
      create table public.profiles (id uuid primary key, user_id uuid not null);
      create table public.organization_roles (id uuid primary key, profile_id uuid, permissions text[] not null default '{}');
      create table public.organization_members (id uuid primary key default gen_random_uuid(), profile_id uuid, user_id uuid, role_id uuid, status text default 'active');
      create table public.restaurant_tables (id uuid primary key default gen_random_uuid(), public_code text);
      create table public.digital_tickets (id uuid primary key default gen_random_uuid(), ticket_code text);
      create table public.scanner_sessions (id uuid primary key default gen_random_uuid(), token text);
      create table public.event_ticket_types (id uuid primary key, sold_quantity int not null default 0, total_quantity int, is_active boolean not null default true, sales_start_at timestamptz, sales_end_at timestamptz, updated_at timestamptz);
      grant all on all tables in schema public to anon, authenticated, service_role;`);
    for (const n of FUNCS) await d.exec(originalFn(n));
    await d.exec(`
      create trigger trg_table_code before insert on public.restaurant_tables for each row execute function set_table_public_code();
      create trigger trg_ticket_code before insert on public.digital_tickets for each row execute function set_digital_ticket_code();
      create trigger trg_scanner_token before insert on public.scanner_sessions for each row execute function set_scanner_session_token();
      create trigger trg_set_affiliate_code before insert on public.users for each row execute function set_affiliate_code();
      create trigger trg_protect_affiliate_fields before update on public.users for each row execute function protect_affiliate_fields();
      grant execute on all functions in schema public to anon, authenticated, service_role;
      insert into public.plans values ('${T.planOn}', true), ('${T.planOff}', false);
      insert into public.users (id, email, role, plan_id) values ('${T.owner}', 'o@x', 'creator', '${T.planOn}'), ('${T.staff}', 's@x', 'creator', null), ('${T.noperm}', 'n@x', 'creator', null), ('${T.stranger}', 'z@x', 'creator', null), ('${T.admin}', 'a@x', 'admin', null);
      insert into public.profiles values ('${T.pOn}', '${T.owner}'), ('${T.pOff}', '${T.stranger}');
      update public.users set plan_id = '${T.planOff}' where id = '${T.stranger}';
      insert into public.organization_roles values ('${T.roleX}', '${T.pOn}', array['x']), ('${T.roleNone}', '${T.pOn}', array['y']);
      insert into public.organization_members (profile_id, user_id, role_id) values ('${T.pOn}', '${T.staff}', '${T.roleX}'), ('${T.pOn}', '${T.noperm}', '${T.roleNone}');
      insert into public.event_ticket_types (id, total_quantity) values ('${T.tt}', 5);`);
    return d;
  }
  const exercise = async (d, path) => {
    const q = async (role, sub, query) => { await d.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false); set search_path = ${path};`); try { return (await d.query(query)).rows; } finally { await d.exec(`reset role; reset search_path; select set_config('request.jwt.claim.sub','', false)`); } };
    const one = async (role, sub, query) => Object.values((await q(role, sub, query))[0])[0];
    const out = {};
    out.isAdmin = [await one("authenticated", T.admin, "select public.is_admin()"), await one("authenticated", T.owner, "select public.is_admin()")];
    out.hasPerm = [await one("authenticated", T.owner, `select public.has_org_permission('${T.pOn}', 'x')`), await one("authenticated", T.staff, `select public.has_org_permission('${T.pOn}', 'x')`),
      await one("authenticated", T.noperm, `select public.has_org_permission('${T.pOn}', 'x')`), await one("authenticated", T.stranger, `select public.has_org_permission('${T.pOn}', 'x')`), await one("authenticated", T.admin, `select public.has_org_permission('${T.pOn}', 'x')`)];
    out.isMember = [await one("authenticated", T.staff, `select public.is_org_member('${T.pOn}')`), await one("authenticated", T.stranger, `select public.is_org_member('${T.pOn}')`)];
    out.teamEnabled = [await one("authenticated", T.owner, `select public.org_team_enabled('${T.pOn}')`), await one("authenticated", T.owner, `select public.org_team_enabled('${T.pOff}')`), await one("authenticated", T.owner, `select public.org_team_enabled('${ID10(99)}')`)];
    await d.exec(`truncate public.restaurant_tables, public.digital_tickets, public.scanner_sessions; update public.event_ticket_types set sold_quantity = 0; delete from public.users where email = 'new@x'`);
    out.tableCode = (await q("authenticated", T.owner, `insert into public.restaurant_tables default values returning public_code`))[0].public_code;
    out.ticketCode = (await q("authenticated", T.owner, `insert into public.digital_tickets default values returning ticket_code`))[0].ticket_code;
    out.token = (await q("service_role", null, `insert into public.scanner_sessions default values returning token`))[0].token;
    out.affiliateCode = (await q("service_role", null, `insert into public.users (id, email) values ('${ID10(77)}', 'new@x') returning affiliate_code`))[0].affiliate_code;
    out.reserve = [(await q("service_role", null, `select (public.reserve_event_ticket_type('${T.tt}', 2)).sold_quantity s`))[0].s, (await q("service_role", null, `select (public.reserve_event_ticket_type('${T.tt}', 4)).id is null over_limit`))[0].over_limit];
    await q("service_role", null, `select public.release_event_ticket_type('${T.tt}', 1)`);
    out.afterRelease = (await q("service_role", null, `select sold_quantity s from public.event_ticket_types where id = '${T.tt}'`))[0].s;
    return out;
  };
  const shapeOf = (o) => JSON.stringify({ ...o, tableCode: o.tableCode.length, ticketCode: o.ticketCode.length, token: o.token.length, affiliateCode: o.affiliateCode.length });
  const EXPECT = JSON.stringify({ isAdmin: [true, false], hasPerm: [true, true, false, false, true], isMember: [true, false], teamEnabled: [true, false, false], tableCode: 10, ticketCode: 12, token: 64, affiliateCode: 8, reserve: [2, true], afterRelease: 1 });
  let d = await build();
  const before = await exercise(d, "public, extensions");
  check("the ORIGINAL bodies behave as designed under Supabase's default path BEFORE the migration (baseline)", shapeOf(before) === EXPECT, shapeOf(before));
  const hijackBefore = await (async () => { await d.exec(`truncate public.restaurant_tables`); await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${T.owner}', false); set search_path = evil, public`); try { return (await d.query(`insert into public.restaurant_tables default values returning public_code`)).rows[0].public_code; } finally { await d.exec(`reset role; reset search_path`); } })();
  check("control: BEFORE the migration a schema the caller controls can substitute gen_random_bytes inside the definer function (the code becomes attacker-predictable)", /^CDCD/.test(hijackBefore), hijackBefore);
  const brokenBefore = await errOf(() => exercise(d, "public"));
  check("control: BEFORE the migration the pgcrypto-based triggers fail when the caller's path lacks 'extensions' (this is why the migration must put it in their pinned path)", !!brokenBefore && /gen_random_bytes/.test(brokenBefore), brokenBefore || "no error");
  await d.exec(`truncate public.restaurant_tables, public.digital_tickets, public.scanner_sessions; delete from public.users where email = 'new@x'`);
  const snapshotBefore = (await d.query(`select proname, prosecdef, proowner::regrole::text o, proacl::text acl, proconfig::text cfg from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by proname`, [FUNCS])).rows;
  check("the hardening migration applies to a database holding the ORIGINAL definitions", (await errOf(() => d.exec(M_DEFINER))) === null);
  const snapshotAfter = (await d.query(`select proname, prosecdef, proowner::regrole::text o, proacl::text acl, proconfig::text cfg from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by proname`, [FUNCS])).rows;
  check("every one of the 11 original functions now has a pinned path ending in pg_temp", snapshotAfter.every((r) => r.cfg && /pg_temp/.test(r.cfg)), JSON.stringify(snapshotAfter.map((r) => [r.proname, r.cfg])));
  check("owner, SECURITY DEFINER flag and every grant are identical before and after", snapshotBefore.every((b) => { const a = snapshotAfter.find((x) => x.proname === b.proname); return a && a.o === b.o && a.acl === b.acl && a.prosecdef === b.prosecdef; }));
  for (const path of ["public, extensions", "public", "pg_temp, public"]) {
    const a = await exercise(d, path);
    check(`AFTER the migration every function behaves exactly as before under the caller path "${path}" (the pinned path is used, not the caller's)`, shapeOf(a) === EXPECT, shapeOf(a));
  }
  await d.exec(`truncate public.restaurant_tables`);
  const hijackAfter = await (async () => { await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${T.owner}', false); set search_path = evil, public`); try { return (await d.query(`insert into public.restaurant_tables default values returning public_code`)).rows[0].public_code; } finally { await d.exec(`reset role; reset search_path`); } })();
  check("AFTER the migration the same hostile path can no longer substitute the function (the real pgcrypto stand-in is used)", !/^CDCD/.test(hijackAfter) && hijackAfter.length === 10, hijackAfter);
  // protect_affiliate_fields on the REAL schema shape: every scenario the review asked for
  await d.exec(`create function public.signup_sim(p_id uuid, p_email text) returns void language plpgsql security definer set search_path = public as $$ begin insert into public.users (id, email) values (p_id, p_email); end $$; grant execute on function public.signup_sim(uuid, text) to supabase_auth_admin`);
  await d.exec(`grant all on public.users to supabase_auth_admin`);
  await d.exec(`select public.signup_sim('${ID10(80)}', 'signup@x')`);
  check("protect_affiliate_fields / signup: a normal signup (INSERT) gets its affiliate code and is not affected", (await d.query(`select length(affiliate_code) l from public.users where id = '${ID10(80)}'`)).rows[0].l === 8);
  await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${T.owner}', false)`);
  await d.exec(`update public.users set affiliate_code = 'STOLEN', referred_by = '${T.stranger}', affiliate_suspended = true, email = 'o2@x' where id = '${T.owner}'`);
  await d.exec(`reset role; select set_config('request.jwt.claim.sub','', false)`);
  const own = (await d.query(`select affiliate_code, referred_by, affiliate_suspended, email from public.users where id = '${T.owner}'`)).rows[0];
  check("normal user update: the three affiliate columns are silently kept, other columns still change (behaviour preserved)", own.affiliate_code !== "STOLEN" && own.referred_by === null && own.affiliate_suspended === false && own.email === "o2@x", JSON.stringify(own));
  await as(d, "service_role", null, `update public.users set affiliate_code = 'SVC123', affiliate_suspended = true where id = '${T.owner}'`);
  check("service-role / webhook operation (auth.uid() is null): the protected columns can be written", (await d.query(`select affiliate_code c, affiliate_suspended s from public.users where id = '${T.owner}'`)).rows[0].c === "SVC123");
  await as(d, "authenticated", T.admin, `update public.users set affiliate_suspended = false where id = '${T.owner}'`);
  check("admin operation (an admin session): allowed", (await d.query(`select affiliate_suspended s from public.users where id = '${T.owner}'`)).rows[0].s === false);
  await d.exec(`create function public.server_op_sim(p_id uuid) returns void language plpgsql security definer set search_path = public as $$ begin update public.users set affiliate_code = 'DEFINER1' where id = p_id; end $$; grant execute on function public.server_op_sim(uuid) to authenticated`);
  await as(d, "authenticated", T.owner, `select public.server_op_sim('${T.owner}')`);
  check("a SECURITY DEFINER server function run by a signed-in user is treated like the user (the existing behaviour: still reverted)", (await d.query(`select affiliate_code c from public.users where id = '${T.owner}'`)).rows[0].c !== "DEFINER1");
  // an actual unexpected exception inside the guard
  await d.exec(`alter function public.is_admin() rename to is_admin_real; create function public.is_admin() returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$ begin raise exception 'unexpected failure'; end $$; grant execute on function public.is_admin() to authenticated, service_role`);
  const failClosed = await errOf(() => as(d, "authenticated", T.owner, `update public.users set affiliate_code = 'SNEAK' where id = '${T.owner}'`));
  check("UNEXPECTED FAILURE inside the guard: the update is refused (fail closed), the protected column is NOT silently changed", !!failClosed && /unexpected failure/.test(failClosed) && (await d.query(`select affiliate_code c from public.users where id = '${T.owner}'`)).rows[0].c !== "SNEAK", failClosed);
  check("...while the service role is unaffected by that same failure (it never reaches is_admin())", (await errOf(() => as(d, "service_role", null, `update public.users set affiliate_code = 'SVC456' where id = '${T.owner}'`))) === null);
  await d.exec(`drop function public.is_admin(); alter function public.is_admin_real() rename to is_admin`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nsecurity_phase1.adversarial: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map((f) => f.name).join("\n - ")); process.exit(1); }
