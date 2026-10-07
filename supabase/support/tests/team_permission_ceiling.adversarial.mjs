// Adversarial test for supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql (Phase 2 security).
//
// Runs entirely on a scratch, in-memory PostgreSQL (PGlite). It never connects to Supabase or any real database. It builds the team tables with the
// repository's own RLS policies and the ORIGINAL bodies of is_admin / has_org_permission / is_org_member / org_team_enabled (read from the repository's
// migrations at run time), proves the escalations work BEFORE the guard (control), then applies the REAL migration, rollback and verify files and attacks it.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json)
//   Run:    node supabase/support/tests/team_permission_ceiling.adversarial.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sql = (rel) => fs.readFileSync(REPO + rel, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = sql("supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql");
const ROLLBACK = sql("supabase/support/2026-10-07a_team_permission_ceiling_guard.rollback.sql");
const VERIFY = sql("supabase/support/2026-10-07a_team_permission_ceiling_guard.verify.sql");
const ORIG_FILES = ["supabase/schema.sql", ...fs.readdirSync(REPO + "supabase/migrations").filter((f) => /\.sql$/.test(f) && !f.startsWith("2026-10-06") && !f.startsWith("2026-10-07a")).sort().map((f) => "supabase/migrations/" + f)];
const originalFn = (name) => {
  let last = null;
  const re = new RegExp(`create (?:or replace )?function\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$[^;]*;`, "gi");
  for (const f of ORIG_FILES) for (const m of sql(f).replace(/--[^\n]*/g, "").matchAll(re)) last = m[0];
  if (!last) throw new Error("original function not found: " + name);
  return last;
};

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const CEIL = "team_permission_ceiling";
const refused = async (fn) => ((await errOf(fn))?.message || "").includes(CEIL);

const ID = (k, n) => `${k}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { owner: ID("a", 1), mgr: ID("a", 2), inv: ID("a", 3), cash: ID("a", 4), fullstaff: ID("a", 5), admin: ID("a", 6), ownerB: ID("a", 7), alt: ID("a", 8), newbie: ID("a", 9) };
const P = { A: ID("b", 1), B: ID("b", 2) };
const R = { full: ID("c", 1), mgr: ID("c", 2), inv: ID("c", 3), cash: ID("c", 4), kitchen: ID("c", 5), B_full: ID("c", 6) };
const ALL = ["orders.view", "orders.create", "orders.update", "kitchen.view", "kitchen.update", "sales.view", "payments.view", "settings.manage", "staff.view", "staff.invite", "staff.manage"];
const arr = (a) => `array[${a.map((x) => `'${x}'`).join(",")}]::text[]`;

async function build() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_auth_admin nologin;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.plans (id uuid primary key, team_enabled boolean not null default false);
    create table public.users (id uuid primary key, email text, role text not null default 'creator', plan_id uuid);
    create table public.profiles (id uuid primary key, user_id uuid not null);
    create table public.organization_roles (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, key text not null, name text not null,
      permissions text[] not null default '{}', is_system boolean not null default false, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (profile_id, key));
    create table public.organization_members (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, user_id uuid not null references public.users(id) on delete cascade,
      role_id uuid not null references public.organization_roles(id), status text not null default 'active' check (status in ('active','inactive','removed')), invited_by uuid, joined_at timestamptz not null default now(),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (profile_id, user_id));
    create table public.organization_invitations (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, role_id uuid not null references public.organization_roles(id),
      invited_by uuid not null references public.users(id), method text not null check (method in ('manual','link')), invitee_name text, invitee_email text, invitee_phone text, token_hash text not null unique,
      status text not null default 'pending' check (status in ('pending','accepted','expired','revoked','cancelled')), expires_at timestamptz not null, accepted_at timestamptz, accepted_by uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    grant all on all tables in schema public to anon, authenticated, service_role, supabase_auth_admin;
    ${originalFn("is_admin")}
    ${originalFn("has_org_permission")}
    ${originalFn("is_org_member")}
    ${originalFn("org_team_enabled")}
    grant execute on all functions in schema public to anon, authenticated, service_role;
    alter table public.organization_roles enable row level security; alter table public.organization_members enable row level security; alter table public.organization_invitations enable row level security;
    alter table public.users enable row level security; alter table public.profiles enable row level security;
    create policy "u read" on public.users for select using (true); create policy "p read" on public.profiles for select using (true);
    -- the repository's FINAL policies (2026-10-01, 2026-10-03 enterprise gate, 2026-10-04 members read fix)
    create policy "organization_roles read" on public.organization_roles for select using (is_org_member(profile_id));
    create policy "organization_roles write" on public.organization_roles for all using (has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)) with check (has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id));
    create policy "organization_members read" on public.organization_members for select using (has_org_permission(profile_id, 'staff.view') or has_org_permission(profile_id, 'staff.manage') or user_id = auth.uid());
    create policy "organization_members write" on public.organization_members for update using (has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)) with check (has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id));
    create policy "organization_invitations read" on public.organization_invitations for select using (has_org_permission(profile_id, 'staff.invite'));
    create policy "organization_invitations insert" on public.organization_invitations for insert with check (has_org_permission(profile_id, 'staff.invite') and invited_by = auth.uid() and org_team_enabled(profile_id));
    create policy "organization_invitations update" on public.organization_invitations for update using (has_org_permission(profile_id, 'staff.invite'));
    insert into public.plans values ('${ID("d", 1)}', true), ('${ID("d", 2)}', false);
    insert into public.users (id, email, role, plan_id) values ('${U.owner}','o@x','creator','${ID("d", 1)}'), ('${U.mgr}','m@x','creator',null), ('${U.inv}','i@x','creator',null), ('${U.cash}','c@x','creator',null),
      ('${U.fullstaff}','f@x','creator',null), ('${U.admin}','a@x','admin',null), ('${U.ownerB}','ob@x','creator','${ID("d", 1)}'), ('${U.alt}','alt@x','creator',null), ('${U.newbie}','n@x','creator',null);
    insert into public.profiles values ('${P.A}', '${U.owner}'), ('${P.B}', '${U.ownerB}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${R.full}', '${P.A}', 'full', 'Full', ${arr(ALL)}),
      ('${R.mgr}', '${P.A}', 'mgr', 'Manager', ${arr(["staff.manage", "staff.view", "staff.invite", "orders.view"])}),
      ('${R.inv}', '${P.A}', 'inv', 'Inviter', ${arr(["staff.invite", "staff.view"])}),
      ('${R.cash}', '${P.A}', 'cash', 'Cashier', ${arr(["orders.view", "orders.create"])}),
      ('${R.kitchen}', '${P.A}', 'kitchen', 'Kitchen', ${arr(["kitchen.view", "kitchen.update"])}),
      ('${R.B_full}', '${P.B}', 'full', 'Full B', ${arr(ALL)});
    insert into public.organization_members (profile_id, user_id, role_id) values ('${P.A}','${U.mgr}','${R.mgr}'), ('${P.A}','${U.inv}','${R.inv}'), ('${P.A}','${U.cash}','${R.cash}'), ('${P.A}','${U.fullstaff}','${R.full}');
    insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.full}', '${U.owner}', 'link', 'hash-owner-invite-full', now() + interval '7 days');
  `);
  return db;
}
const as = async (db, role, sub, query) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(query); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false)`); }
};
const permsOf = async (db, id) => (await db.query(`select permissions from public.organization_roles where id='${id}'`)).rows[0].permissions;
const memberRole = async (db, user) => (await db.query(`select role_id from public.organization_members where user_id='${user}' and profile_id='${P.A}'`)).rows[0]?.role_id;

// ====================================================================================================================
console.log("### 0. CONTROL: before the guard exists, each escalation works for a member holding only a partial staff permission");
let db = await build();
await as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.mgr}'`);
check("control A: a manager (staff.manage) rewrites their OWN role to hold every permission", (await permsOf(db, R.mgr)).length === ALL.length);
await db.exec(`update public.organization_roles set permissions = ${arr(["staff.manage", "staff.view", "staff.invite", "orders.view"])} where id='${R.mgr}'`);
await as(db, "authenticated", U.mgr, `update public.organization_members set role_id = '${R.full}' where user_id = '${U.mgr}'`);
check("control B: a manager moves their own membership onto the Full role", (await memberRole(db, U.mgr)) === R.full);
await db.exec(`update public.organization_members set role_id = '${R.mgr}' where user_id = '${U.mgr}'`);
await as(db, "authenticated", U.mgr, `update public.organization_members set user_id = '${U.alt}' where user_id = '${U.fullstaff}' and profile_id = '${P.A}'`);
check("control C: a manager hands the Full-role seat to a second account of theirs (user_id swap)", (await memberRole(db, U.alt)) === R.full);
await db.exec(`update public.organization_members set user_id = '${U.fullstaff}' where user_id = '${U.alt}'`);
await as(db, "authenticated", U.inv, `insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.full}', '${U.inv}', 'link', 'hash-mine', now() + interval '7 days')`);
check("control D: an inviter (staff.invite) creates an invitation for the Full role", (await db.query(`select count(*)::int c from public.organization_invitations where token_hash='hash-mine'`)).rows[0].c === 1);
await as(db, "authenticated", U.inv, `update public.organization_invitations set token_hash = 'hash-known-to-me' where token_hash = 'hash-owner-invite-full'`);
check("control E: an inviter re-tokens the OWNER's pending Full-role invitation (what API 'resend' also does) and now knows its token", (await db.query(`select count(*)::int c from public.organization_invitations where token_hash='hash-known-to-me'`)).rows[0].c === 1);
await db.exec(`update public.organization_invitations set token_hash = 'hash-owner-invite-full' where token_hash = 'hash-known-to-me'; delete from public.organization_invitations where token_hash = 'hash-mine'`);
await as(db, "authenticated", U.mgr, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${P.A}', 'mine', 'Mine', ${arr(ALL)})`);
check("control F: a manager creates a brand-new role holding every permission", (await db.query(`select count(*)::int c from public.organization_roles where key='mine'`)).rows[0].c === 1);
await db.exec(`delete from public.organization_roles where key='mine'`);

// ====================================================================================================================
console.log("### 1. apply the REAL migration");
check("the migration applies and commits (structure checks pass)", (await errOf(() => db.exec(MIGRATION))) === null);
check("the guard functions are SECURITY DEFINER with a pinned path and no API role can execute them", (await db.query(`select bool_and(prosecdef and proconfig::text like '%search_path%') ok from pg_proc where pronamespace='public'::regnamespace and proname in ('team_permissions_not_held','organization_roles_ceiling_guard','organization_members_ceiling_guard','organization_invitations_ceiling_guard')`)).rows[0].ok
  && !(await db.query(`select bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) x from pg_proc p, (values ('anon'),('authenticated'),('service_role')) v(r) where p.pronamespace='public'::regnamespace and p.proname in ('team_permissions_not_held','organization_roles_ceiling_guard','organization_members_ceiling_guard','organization_invitations_ceiling_guard')`)).rows[0].x);

console.log("### 2. the same escalations are now refused");
const snap = async () => JSON.stringify([(await permsOf(db, R.mgr)), await memberRole(db, U.mgr), await memberRole(db, U.fullstaff), (await db.query(`select token_hash, role_id from public.organization_invitations order by token_hash`)).rows, (await db.query(`select count(*)::int c from public.organization_roles`)).rows[0].c]);
const before = await snap();
check("A refused: a manager cannot add permissions they do not hold to their own role", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.mgr}'`)));
check("A2 refused: ...nor to ANY role (e.g. the cashier role)", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = permissions || array['payments.view','sales.view'] where id = '${R.cash}'`)));
check("A3 refused: a rename plus one unheld permission is refused as a whole", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_roles set name = 'Boss', permissions = permissions || array['settings.manage'] where id = '${R.mgr}'`)));
check("B refused: a manager cannot move their own membership onto a stronger role", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_members set role_id = '${R.full}' where user_id = '${U.mgr}'`)));
check("C refused: a manager cannot swap the Full-role seat to another account", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_members set user_id = '${U.alt}' where user_id = '${U.fullstaff}' and profile_id = '${P.A}'`)));
check("D refused: an inviter cannot invite someone onto the Full role", await refused(() => as(db, "authenticated", U.inv, `insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.full}', '${U.inv}', 'link', 'hash-mine', now() + interval '7 days')`)));
check("E refused: an inviter cannot re-token (resend) the owner's pending Full-role invitation", await refused(() => as(db, "authenticated", U.inv, `update public.organization_invitations set token_hash = 'hash-known-to-me' where token_hash = 'hash-owner-invite-full'`)));
check("E2 refused: ...nor extend its expiry, nor switch its role", await refused(() => as(db, "authenticated", U.inv, `update public.organization_invitations set expires_at = now() + interval '365 days' where token_hash = 'hash-owner-invite-full'`)) && await refused(() => as(db, "authenticated", U.inv, `update public.organization_invitations set role_id = '${R.full}', token_hash = 'x' where token_hash = 'hash-owner-invite-full'`)));
check("E3 refused: ...nor flip a revoked Full-role invitation back to pending", await (async () => { await db.exec(`update public.organization_invitations set status = 'revoked' where token_hash = 'hash-owner-invite-full'`); const r = await refused(() => as(db, "authenticated", U.inv, `update public.organization_invitations set status = 'pending' where token_hash = 'hash-owner-invite-full'`)); await db.exec(`update public.organization_invitations set status = 'pending' where token_hash = 'hash-owner-invite-full'`); return r; })());
check("F refused: a manager cannot create a role holding permissions they lack", await refused(() => as(db, "authenticated", U.mgr, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${P.A}', 'mine', 'Mine', ${arr(ALL)})`)));
check("G refused: a role cannot be moved to another organization", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_roles set profile_id = '${P.B}' where id = '${R.cash}'`)));
check("H refused: a membership cannot point at another organization's role (cross-tenant)", await refused(() => as(db, "authenticated", U.mgr, `update public.organization_members set role_id = '${R.B_full}' where user_id = '${U.cash}' and profile_id = '${P.A}'`)));
check("H2 refused: an invitation cannot name another organization's role", await refused(() => as(db, "authenticated", U.inv, `insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.B_full}', '${U.inv}', 'link', 'h2', now() + interval '7 days')`)));
check("no attack left any trace (permissions, roles, memberships, invitations all unchanged)", (await snap()) === before);

console.log("### 3. legitimate flows are unaffected");
const ok = async (fn) => (await errOf(fn)) === null;
check("the OWNER can still give a role every permission", await ok(() => as(db, "authenticated", U.owner, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.cash}'`)) && (await permsOf(db, R.cash)).length === ALL.length);
await db.exec(`update public.organization_roles set permissions = ${arr(["orders.view", "orders.create"])} where id = '${R.cash}'`);
check("the OWNER can still move a member onto any role and invite for any role", await ok(() => as(db, "authenticated", U.owner, `update public.organization_members set role_id = '${R.full}' where user_id = '${U.cash}' and profile_id = '${P.A}'`)) && await ok(() => as(db, "authenticated", U.owner, `insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.full}', '${U.owner}', 'link', 'owner-new', now() + interval '7 days')`)));
await db.exec(`update public.organization_members set role_id = '${R.cash}' where user_id = '${U.cash}' and profile_id = '${P.A}'; delete from public.organization_invitations where token_hash = 'owner-new'`);
check("a platform ADMIN is exempt, as in the API", await ok(() => as(db, "authenticated", U.admin, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.cash}'`)));
await db.exec(`update public.organization_roles set permissions = ${arr(["orders.view", "orders.create"])} where id = '${R.cash}'`);
check("a manager CAN add permissions they hold (orders.view) to a role", await ok(() => as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(["orders.view", "orders.create", "staff.view"])} where id = '${R.cash}'`)));
await db.exec(`update public.organization_roles set permissions = ${arr(["orders.view", "orders.create"])} where id = '${R.cash}'`);
check("a manager CAN remove permissions, including ones they do not hold (taking access away is never an escalation)", await ok(() => as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(["orders.view"])} where id = '${R.full}'`)) && (await permsOf(db, R.full)).length === 1);
await db.exec(`update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.full}'`);
check("a manager CAN rename a role and edit it without adding permissions", await ok(() => as(db, "authenticated", U.mgr, `update public.organization_roles set name = 'Cashiers' where id = '${R.cash}'`)));
check("a manager CAN create a role from permissions they hold", await ok(() => as(db, "authenticated", U.mgr, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${P.A}', 'viewer', 'Viewer', ${arr(["orders.view", "staff.view"])})`)));
check("a manager CAN move a member onto a role whose permissions they hold", await ok(() => as(db, "authenticated", U.mgr, `update public.organization_members set role_id = '${R.inv}' where user_id = '${U.cash}' and profile_id = '${P.A}'`)));
await db.exec(`update public.organization_members set role_id = '${R.cash}' where user_id = '${U.cash}' and profile_id = '${P.A}'`);
check("a manager CAN deactivate, reactivate and remove any member, even one on a stronger role (status only)", await ok(() => as(db, "authenticated", U.mgr, `update public.organization_members set status = 'inactive' where user_id = '${U.fullstaff}' and profile_id = '${P.A}'`)) && await ok(() => as(db, "authenticated", U.mgr, `update public.organization_members set status = 'active' where user_id = '${U.fullstaff}' and profile_id = '${P.A}'`)));
check("an inviter CAN invite to a role whose permissions they hold", await ok(() => as(db, "authenticated", U.inv, `insert into public.organization_invitations (profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${P.A}', '${R.inv}', '${U.inv}', 'link', 'ok-invite', now() + interval '7 days')`)));
check("...and resend (re-token) that invitation", await ok(() => as(db, "authenticated", U.inv, `update public.organization_invitations set token_hash = 'ok-invite-2', expires_at = now() + interval '14 days', updated_at = now() where token_hash = 'ok-invite'`)));
check("an inviter CAN revoke ANY pending invitation, including the owner's Full-role one (taking away)", await ok(() => as(db, "authenticated", U.inv, `update public.organization_invitations set status = 'revoked', updated_at = now() where token_hash = 'hash-owner-invite-full'`)));
await db.exec(`update public.organization_invitations set status = 'pending' where token_hash = 'hash-owner-invite-full'`);
check("the SERVICE ROLE (the accept route) can still create a membership on any role", await ok(() => as(db, "service_role", null, `insert into public.organization_members (profile_id, user_id, role_id) values ('${P.A}', '${U.newbie}', '${R.full}')`)));
check("the service role can still update an invitation to accepted", await ok(() => as(db, "service_role", null, `update public.organization_invitations set status = 'accepted', accepted_at = now(), accepted_by = '${U.newbie}' where token_hash = 'hash-owner-invite-full'`)));
check("a user with NO membership still cannot touch the team tables (RLS unchanged)", (await as(db, "authenticated", U.alt, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.cash}' returning id`)).rows.length === 0);

console.log("### 4. verify script, rollback, re-apply");
let ver = (await db.query(VERIFY)).rows;
// T4 checks the OLDER Inbox guard triggers, which belong to a different migration this scratch database does not load; it is the one expected non-pass here.
const verFail = ver.filter((r) => r.status === "FAIL" && r.grp !== "ZZ");
check("verification: every check passes after the migration (T4 = Inbox guards, not loaded in this scratch DB, is the only expected miss)", verFail.length === 1 && verFail[0].grp === "T4" && ver.filter((r) => r.grp === "T1" && r.status === "PASS").length === 3 && ver.filter((r) => ["T2", "T3"].includes(r.grp)).every((r) => r.status === "PASS"), JSON.stringify(verFail));
check("the verification script is a single read-only SELECT", !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(VERIFY.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "")));
await db.exec(ROLLBACK);
check("rollback removes only this guard", (await db.query(`select count(*)::int c from pg_trigger where tgname like '%ceiling_guard_trg'`)).rows[0].c === 0 && (await db.query(`select count(*)::int c from pg_proc where proname like '%ceiling_guard' or proname = 'team_permissions_not_held'`)).rows[0].c === 0);
await as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.mgr}'`);
check("after rollback the weakness is back (so the guard is what closed it)", (await permsOf(db, R.mgr)).length === ALL.length);
await db.exec(`update public.organization_roles set permissions = ${arr(["staff.manage", "staff.view", "staff.invite", "orders.view"])} where id='${R.mgr}'`);
check("the migration re-applies cleanly after a rollback, and is idempotent", (await errOf(() => db.exec(MIGRATION))) === null && (await errOf(() => db.exec(MIGRATION))) === null && await refused(() => as(db, "authenticated", U.mgr, `update public.organization_roles set permissions = ${arr(ALL)} where id = '${R.mgr}'`)));

const failed = results.filter((r) => !r.pass);
console.log(`\nteam_permission_ceiling.adversarial: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map((f) => f.name).join("\n - ")); process.exit(1); }
