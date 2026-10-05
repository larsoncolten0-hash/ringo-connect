// Security foundation for staff Inbox roles: only an organization's OWNER may grant or revoke `inbox.*` permissions, enforced IN THE DATABASE.
// Loads the REAL Team migrations (2026-10-01 / 03 / 04: tables, helper functions and RLS policies as written) and the new guard migration
// (2026-12-13_whatsapp_inbox_team_permission_guard.sql) into scratch in-memory PostgreSQL (PGlite) and attacks them the way a logged-in manager could:
// DIRECT table writes under the `authenticated` role (what the Supabase client / PostgREST runs), with RLS on. No Supabase, no network, no production data.
//   Run:  node scripts/tests/whatsappInboxTeamGuard.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner1 = U(1), mgr1 = U(2), staff1 = U(3), owner2 = U(4), mgr2 = U(5), member1b = U(6), stranger = U(7), admin = U(8), noTeamOwner = U(9), adminOwner = U(10);
const prof1 = P(1), prof2 = P(2), profNoTeam = P(3), profAdminOwned = P(4);

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key default gen_random_uuid(), name text, team_enabled boolean not null default false);
  create table public.users (id uuid primary key, role text not null default 'user', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id));
  create function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
`);
// the real Team objects: tables + helper functions + RLS policies (01, lines 28..261), the plan gate (03) and the members read fix (04)
const team01 = read("supabase/migrations/2026-10-01_team_management.sql").split("\n").slice(27, 261).join("\n");
await db.exec(team01);
await db.exec(read("supabase/migrations/2026-10-03_team_rls_enterprise_gate.sql"));
await db.exec(read("supabase/migrations/2026-10-04_team_members_read_fix.sql"));
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);

const planBiz = "d0000000-0000-4000-8000-000000000001", planFree = "d0000000-0000-4000-8000-000000000002";
await db.exec(`
  insert into public.plans (id, name, team_enabled) values ('${planBiz}', 'business', true), ('${planFree}', 'free', false);
  insert into public.users (id, role, plan_id) values ('${owner1}','user','${planBiz}'), ('${mgr1}','user','${planFree}'), ('${staff1}','user','${planFree}'), ('${owner2}','user','${planBiz}'),
    ('${mgr2}','user','${planFree}'), ('${member1b}','user','${planFree}'), ('${stranger}','user','${planFree}'), ('${admin}','admin','${planFree}'), ('${noTeamOwner}','user','${planFree}'), ('${adminOwner}','admin','${planBiz}');
  insert into public.profiles values ('${prof1}','${owner1}'), ('${prof2}','${owner2}'), ('${profNoTeam}','${noTeamOwner}'), ('${profAdminOwned}','${adminOwner}');
`);
// guard migration under test (applied AFTER the Team objects, as it would be in production)
await db.exec(read("supabase/migrations/2026-12-13_whatsapp_inbox_team_permission_guard.sql"));

// roles. R_MGR: staff.view + staff.manage (no inbox). R_PLAIN: no inbox. R_INBOX: inbox.view + inbox.reply. R_INBOX2: inbox.view only. P2_INBOX: org 2's inbox role.
const R_MGR = RID(1), R_PLAIN = RID(2), R_INBOX = RID(3), R_INBOX2 = RID(4), P2_MGR = RID(5), P2_INBOX = RID(6), R_PLAIN2 = RID(7);
const svc = async (sql) => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } };
await db.exec(`
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R_MGR}','${prof1}','mgr','Manager','{staff.view,staff.manage,staff.invite}'), ('${R_PLAIN}','${prof1}','plain','Plain','{orders.view}'), ('${R_PLAIN2}','${prof1}','plain2','Plain2','{orders.view,orders.update}'),
    ('${R_INBOX}','${prof1}','agent','Agent','{inbox.view,inbox.reply}'), ('${R_INBOX2}','${prof1}','viewer','Viewer','{inbox.view}'),
    ('${P2_MGR}','${prof2}','mgr','Manager','{staff.view,staff.manage}'), ('${P2_INBOX}','${prof2}','agent','Agent','{inbox.view,inbox.ai}');
  insert into public.organization_members (id, profile_id, user_id, role_id) values
    ('e0000000-0000-4000-8000-000000000001','${prof1}','${mgr1}','${R_MGR}'),
    ('e0000000-0000-4000-8000-000000000002','${prof1}','${staff1}','${R_INBOX}'),
    ('e0000000-0000-4000-8000-000000000003','${prof1}','${member1b}','${R_PLAIN}'),
    ('e0000000-0000-4000-8000-000000000004','${prof2}','${mgr2}','${P2_MGR}');
`);
const MGRP = "staff.view,staff.manage,staff.invite";
const M_MGR1 = "e0000000-0000-4000-8000-000000000001", M_STAFF1 = "e0000000-0000-4000-8000-000000000002", M_PLAIN1 = "e0000000-0000-4000-8000-000000000003", M_MGR2 = "e0000000-0000-4000-8000-000000000004";

// ---- helpers: run SQL exactly as a signed-in browser user would (role authenticated, RLS on, auth.uid() = the user) ----
const as = async (user, sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, code: e.code, msg: String(e.message) }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)"); }
};
const denied = (r) => r.ok === false && r.code === "42501" && /inbox_permission_owner_only/.test(r.msg);
// "blocked" = either the trigger refused (42501) or RLS filtered the row so nothing changed
const blocked = (r) => denied(r) || (r.ok && r.count === 0);
const perms = async (id) => (await db.query(`select permissions from public.organization_roles where id = '${id}'`)).rows[0].permissions.join(",");
const roleOf = async (id) => (await db.query(`select role_id, status from public.organization_members where id = '${id}'`)).rows[0];
const invite = (id, role, by = mgr1, prof = prof1, token = id) => `insert into public.organization_invitations (id, profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${id}','${prof}','${role}','${by}','link','${token}', now() + interval '7 days')`;

// ============================================================ the escalation the audit found, now blocked (manager = staff.view + staff.manage only)
check("setup: the manager holds only the Team permissions (staff.view, staff.manage, staff.invite — invite is needed to even try the invitation attacks) and is not the owner", (await perms(R_MGR)) === MGRP);
let r = await as(mgr1, `update public.organization_roles set permissions = '{staff.view,staff.manage,staff.invite,inbox.view}' where id = '${R_MGR}'`);
check("manager: cannot add inbox.view to their OWN role (direct write)", denied(r) && (await perms(R_MGR)) === MGRP, JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set permissions = permissions || '{inbox.reply}' where id = '${R_MGR}'`);
check("manager: cannot add inbox.reply", denied(r) && (await perms(R_MGR)) === MGRP, JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set permissions = permissions || '{inbox.ai}' where id = '${R_MGR}'`);
check("manager: cannot add inbox.ai", denied(r) && (await perms(R_MGR)) === MGRP, JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set permissions = '{inbox.VIEW}' where id = '${R_PLAIN}'`);
check("manager: case/spacing tricks (inbox.VIEW, ' inbox.reply ') are treated as inbox permissions too", denied(r) && blocked(await as(mgr1, `update public.organization_roles set permissions = array[' inbox.reply '] where id = '${R_PLAIN}'`)) && (await perms(R_PLAIN)) === "orders.view");
r = await as(mgr1, `update public.organization_roles set permissions = '{inbox.view}' where id = '${R_INBOX}'`);
check("manager: cannot REMOVE inbox.reply from another role / replace one Inbox set with another", denied(r) && (await perms(R_INBOX)) === "inbox.view,inbox.reply", JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_INBOX}'`);
check("manager: cannot strip every inbox permission from a role", denied(r) && (await perms(R_INBOX)) === "inbox.view,inbox.reply");
r = await as(mgr1, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','sneaky','Sneaky','{inbox.view}')`);
check("manager: cannot INSERT a new role containing inbox.*", denied(r) && (await db.query(`select 1 from public.organization_roles where key = 'sneaky'`)).rows.length === 0, JSON.stringify(r));
r = await as(mgr1, `update public.organization_members set role_id = '${R_INBOX}' where id = '${M_MGR1}'`);
check("manager: cannot move THEMSELVES onto an Inbox-enabled role", denied(r) && (await roleOf(M_MGR1)).role_id === R_MGR, JSON.stringify(r));
r = await as(mgr1, `update public.organization_members set role_id = '${R_INBOX}' where id = '${M_PLAIN1}'`);
check("manager: cannot move ANOTHER member onto an Inbox-enabled role", denied(r) && (await roleOf(M_PLAIN1)).role_id === R_PLAIN, JSON.stringify(r));
r = await as(mgr1, `update public.organization_members set role_id = '${R_PLAIN}' where id = '${M_STAFF1}'`);
check("manager: cannot move a member AWAY from an Inbox-enabled role (that revokes Inbox access)", denied(r) && (await roleOf(M_STAFF1)).role_id === R_INBOX, JSON.stringify(r));

// reactivation: the owner deactivates the Inbox member; the manager may not bring them back
await as(owner1, `update public.organization_members set status = 'inactive' where id = '${M_STAFF1}'`);
r = await as(mgr1, `update public.organization_members set status = 'active' where id = '${M_STAFF1}'`);
check("manager: cannot REACTIVATE a member whose role holds inbox.*", denied(r) && (await roleOf(M_STAFF1)).status === "inactive", JSON.stringify(r));
r = await as(owner1, `update public.organization_members set status = 'active' where id = '${M_STAFF1}'`);
check("owner: can reactivate it", r.ok && r.count === 1 && (await roleOf(M_STAFF1)).status === "active", JSON.stringify(r));

r = await as(mgr1, invite("f0000000-0000-4000-8000-000000000001", R_INBOX));
check("manager: cannot CREATE an invitation for an Inbox-enabled role", denied(r) && (await db.query(`select 1 from public.organization_invitations`)).rows.length === 0, JSON.stringify(r));
r = await as(mgr1, invite("f0000000-0000-4000-8000-000000000002", R_PLAIN));
check("manager: CAN still create an invitation for an ordinary role (existing behaviour)", r.ok, JSON.stringify(r));
r = await as(mgr1, `update public.organization_invitations set role_id = '${R_INBOX}' where id = 'f0000000-0000-4000-8000-000000000002'`);
check("manager: cannot MODIFY an invitation to use an Inbox-enabled role", denied(r), JSON.stringify(r));

// owner creates an Inbox invitation; the manager can revoke it but not otherwise modify it
r = await as(owner1, invite("f0000000-0000-4000-8000-000000000003", R_INBOX, owner1));
check("owner: can create an Inbox-enabled invitation", r.ok, JSON.stringify(r));
r = await as(mgr1, `update public.organization_invitations set expires_at = now() + interval '30 days' where id = 'f0000000-0000-4000-8000-000000000003'`);
check("manager: cannot modify (extend) an Inbox invitation", denied(r), JSON.stringify(r));
r = await as(mgr1, `update public.organization_invitations set role_id = '${R_PLAIN}' where id = 'f0000000-0000-4000-8000-000000000003'`);
check("manager: cannot move an Inbox invitation to an ordinary role", denied(r), JSON.stringify(r));
r = await as(mgr1, `update public.organization_invitations set status = 'accepted' where id = 'f0000000-0000-4000-8000-000000000003'`);
check("manager: cannot mark an Inbox invitation accepted", denied(r), JSON.stringify(r));
r = await as(mgr1, `update public.organization_invitations set status = 'revoked' where id = 'f0000000-0000-4000-8000-000000000003'`);
check("manager: CAN still revoke an Inbox invitation (taking access away)", r.ok && r.count === 1, JSON.stringify(r));
r = await as(owner1, `update public.organization_invitations set status = 'pending', expires_at = now() + interval '30 days' where id = 'f0000000-0000-4000-8000-000000000003'`);
check("owner: can modify an Inbox invitation", r.ok && r.count === 1, JSON.stringify(r));

// ============================================================ owner: full control
r = await as(owner1, `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${RID(20)}','${prof1}','owner_made','Owner made','{inbox.view,inbox.reply,inbox.media}')`);
check("owner: can create an Inbox-enabled role", r.ok, JSON.stringify(r));
r = await as(owner1, `update public.organization_roles set permissions = '{inbox.view,inbox.reply,inbox.media,inbox.ai,inbox.close}' where id = '${RID(20)}'`);
check("owner: can add Inbox permissions", r.ok && r.count === 1 && (await perms(RID(20))) === "inbox.view,inbox.reply,inbox.media,inbox.ai,inbox.close", JSON.stringify(r));
r = await as(owner1, `update public.organization_roles set permissions = '{inbox.view}' where id = '${RID(20)}'`);
check("owner: can remove Inbox permissions", r.ok && (await perms(RID(20))) === "inbox.view", JSON.stringify(r));
r = await as(owner1, `update public.organization_members set role_id = '${RID(20)}' where id = '${M_PLAIN1}'`);
check("owner: can assign an Inbox-enabled role", r.ok && r.count === 1 && (await roleOf(M_PLAIN1)).role_id === RID(20), JSON.stringify(r));
r = await as(owner1, `update public.organization_members set role_id = '${R_PLAIN}' where id = '${M_PLAIN1}'`);
check("owner: can revoke / change an Inbox-enabled role assignment", r.ok && (await roleOf(M_PLAIN1)).role_id === R_PLAIN, JSON.stringify(r));

// ============================================================ cross-organization isolation
const before2 = await perms(P2_INBOX);
r = await as(mgr1, `update public.organization_roles set permissions = '{inbox.view,inbox.reply,inbox.media}' where id = '${P2_INBOX}'`);
check("cross-org: a manager of org 1 cannot touch org 2's Inbox role", blocked(r) && (await perms(P2_INBOX)) === before2, JSON.stringify(r));
r = await as(mgr2, `update public.organization_members set role_id = '${R_INBOX}' where id = '${M_MGR2}'`);
check("cross-org: a manager of org 2 cannot move themselves onto org 1's Inbox role", denied(r) && (await roleOf(M_MGR2)).role_id === P2_MGR, JSON.stringify(r));
r = await as(mgr2, `update public.organization_members set role_id = '${P2_INBOX}' where id = '${M_MGR2}'`);
check("cross-org: nor onto their own organization's Inbox role", denied(r) && (await roleOf(M_MGR2)).role_id === P2_MGR, JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set profile_id = '${prof1}' where id = '${P2_INBOX}'`);
check("cross-org: a manager cannot move org 2's Inbox role into org 1", blocked(r) && (await db.query(`select profile_id from public.organization_roles where id = '${P2_INBOX}'`)).rows[0].profile_id === prof2, JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set profile_id = '${prof2}' where id = '${R_INBOX}'`);
check("cross-org: nor push org 1's Inbox role into org 2", blocked(r) && (await db.query(`select profile_id from public.organization_roles where id = '${R_INBOX}'`)).rows[0].profile_id === prof1, JSON.stringify(r));
r = await as(owner1, `update public.organization_roles set permissions = '{inbox.view,inbox.ai}' where id = '${P2_INBOX}'`);
check("cross-org: the owner of org 1 cannot change org 2's Inbox role either (owner of THAT organization only)", blocked(r) && (await perms(P2_INBOX)) === before2, JSON.stringify(r));
r = await as(stranger, `update public.organization_roles set permissions = '{inbox.view}' where id = '${R_PLAIN}'`);
check("a user with no membership cannot change anything", blocked(r) && (await perms(R_PLAIN)) === "orders.view", JSON.stringify(r));
r = await as(owner2, `update public.organization_roles set permissions = '{inbox.view,inbox.ai,inbox.close}' where id = '${P2_INBOX}'`);
check("owner of org 2 CAN change org 2's Inbox role", r.ok && r.count === 1, JSON.stringify(r));

// ============================================================ trusted callers and admins
r = await svc(`insert into public.organization_members (profile_id, user_id, role_id) values ('${prof1}','${stranger}','${R_INBOX2}') returning id`);
check("service role (e.g. the invitation-accept route) can still create a membership on an Inbox role", r.rows.length === 1);
r = await svc(`update public.organization_roles set permissions = '{inbox.view,inbox.media}' where id = '${R_INBOX2}' returning id`);
check("service role can write Inbox permissions (trusted server-side convention preserved)", r.rows.length === 1);
// ============================================================ platform admins are NOT owners: Inbox permissions are owner-only, whoever else holds power
// (RLS still lets a platform admin write the Team tables — has_org_permission is true for admins — so every refusal below comes from the guard trigger)
const R_ADMIN_OWNED = RID(30), M_ADMIN_MEMBER = "e0000000-0000-4000-8000-000000000030";
await db.exec(`insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${R_ADMIN_OWNED}','${profAdminOwned}','x','x','{orders.view}')`);
await db.exec(`insert into public.organization_members (id, profile_id, user_id, role_id) values ('${M_ADMIN_MEMBER}','${profAdminOwned}','${stranger}','${R_ADMIN_OWNED}')`);
check("platform admin: the admin's RLS access is real (a non-Inbox write by an admin on a foreign organization is allowed by RLS), so the Inbox refusals below are the guard's doing", (await as(admin, `update public.organization_roles set name = 'admin renamed' where id = '${R_PLAIN}'`)).count === 1);
r = await as(admin, `update public.organization_roles set permissions = permissions || '{inbox.view}' where id = '${R_PLAIN}'`);
check("platform admin who is NOT the owner: cannot GRANT inbox.view to a role", denied(r) && (await perms(R_PLAIN)) === "orders.view", JSON.stringify(r));
r = await as(admin, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_INBOX2}'`);
check("platform admin who is NOT the owner: cannot REVOKE inbox permissions from a role", denied(r) && (await perms(R_INBOX2)) === "inbox.view,inbox.media", JSON.stringify(r));
r = await as(admin, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','adm','adm','{inbox.view}')`);
check("platform admin who is NOT the owner: cannot create an Inbox-enabled role", denied(r), JSON.stringify(r));
r = await as(admin, `update public.organization_members set role_id = '${R_INBOX}' where id = '${M_PLAIN1}'`);
check("platform admin who is NOT the owner: cannot move a member onto an Inbox-enabled role", denied(r) && (await roleOf(M_PLAIN1)).role_id === R_PLAIN, JSON.stringify(r));
r = await as(admin, `update public.organization_members set role_id = '${R_PLAIN}' where id = '${M_STAFF1}'`);
check("platform admin who is NOT the owner: cannot move a member away from an Inbox-enabled role", denied(r) && (await roleOf(M_STAFF1)).role_id === R_INBOX, JSON.stringify(r));
await svc(`update public.organization_members set status = 'inactive' where id = '${M_STAFF1}'`);
r = await as(admin, `update public.organization_members set status = 'active' where id = '${M_STAFF1}'`);
check("platform admin who is NOT the owner: cannot reactivate a member into an Inbox-enabled role", denied(r) && (await roleOf(M_STAFF1)).status === "inactive", JSON.stringify(r));
await svc(`update public.organization_members set status = 'removed' where id = '${M_STAFF1}'`);
r = await as(admin, invite("f0000000-0000-4000-8000-000000000040", R_INBOX, admin));
check("platform admin who is NOT the owner: cannot create an Inbox-enabled invitation", denied(r), JSON.stringify(r));
await svc(invite("f0000000-0000-4000-8000-000000000041", R_INBOX, owner1));
r = await as(admin, `update public.organization_invitations set expires_at = now() + interval '90 days' where id = 'f0000000-0000-4000-8000-000000000041'`);
check("platform admin who is NOT the owner: cannot modify an Inbox-enabled invitation", denied(r), JSON.stringify(r));
r = await as(admin, `update public.organization_invitations set role_id = '${R_PLAIN}' where id = 'f0000000-0000-4000-8000-000000000041'`);
check("platform admin who is NOT the owner: cannot move an Inbox invitation to another role either", denied(r), JSON.stringify(r));
const p2now = await perms(P2_INBOX);
r = await as(admin, `update public.organization_roles set permissions = '{inbox.view,inbox.reply,inbox.media}' where id = '${P2_INBOX}'`);
check("platform admin, cross-organization: cannot touch ANOTHER organization's Inbox role (org 2) either", denied(r) && (await perms(P2_INBOX)) === p2now, JSON.stringify(r));
r = await as(admin, `update public.organization_members set role_id = '${P2_INBOX}' where id = '${M_MGR2}'`);
check("platform admin, cross-organization: cannot move org 2's manager onto org 2's Inbox role", denied(r) && (await roleOf(M_MGR2)).role_id === P2_MGR, JSON.stringify(r));
r = await as(admin, `update public.organization_roles set profile_id = '${prof1}' where id = '${P2_INBOX}'`);
check("platform admin, cross-organization: cannot move an Inbox role between organizations", denied(r) && (await db.query(`select profile_id from public.organization_roles where id = '${P2_INBOX}'`)).rows[0].profile_id === prof2, JSON.stringify(r));
r = await as(admin, `update public.organization_roles set permissions = permissions || '{payments.view}' where id = '${R_PLAIN}'`);
check("scope: the guard is limited to inbox.* — a platform admin's non-Inbox edits are unchanged (allowed, exactly as before)", r.ok && r.count === 1, JSON.stringify(r));
// a platform admin who IS the organization's owner keeps the owner's rights (ownership, not admin status, is the test)
r = await as(adminOwner, `update public.organization_roles set permissions = '{orders.view,inbox.view}' where id = '${R_ADMIN_OWNED}'`);
check("a user who is both platform admin AND the organization owner can grant inbox.view (as OWNER)", r.ok && r.count === 1 && (await perms(R_ADMIN_OWNED)) === "orders.view,inbox.view", JSON.stringify(r));
r = await as(adminOwner, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_ADMIN_OWNED}'`);
check("…and revoke it", r.ok && r.count === 1 && (await perms(R_ADMIN_OWNED)) === "orders.view", JSON.stringify(r));
r = await as(adminOwner, `update public.organization_roles set permissions = '{inbox.view}' where id = '${R_INBOX2}'`);
check("…but being an owner of ONE organization grants nothing in ANOTHER (org 1's Inbox role)", blocked(r) && (await perms(R_INBOX2)) === "inbox.view,inbox.media", JSON.stringify(r));
check("the guard function itself: owner true, admin non-owner false, manager false, stranger false, unknown profile false, internal (no identity) true", await (async () => { const f = async (u, prof) => { await db.exec(`select set_config('request.jwt.claim.sub', '${u}', false)`); try { return (await db.query(`select public.team_inbox_grant_allowed('${prof}') as a`)).rows[0].a; } finally { await db.exec("select set_config('request.jwt.claim.sub', '', false)"); } }; return (await f(owner1, prof1)) === true && (await f(admin, prof1)) === false && (await f(mgr1, prof1)) === false && (await f(stranger, prof1)) === false && (await f(owner1, prof2)) === false && (await f(owner1, "00000000-0000-4000-8000-00000000ffff")) === false && (await db.query(`select public.team_inbox_grant_allowed('${prof1}') as a`)).rows[0].a === true; })());
r = await db.query(`select public.team_inbox_grant_allowed('${prof1}') as a`);
check("direct database access (no end-user identity) is treated as trusted", r.rows[0].a === true);

// ============================================================ ordinary Team management is unchanged
r = await as(mgr1, `update public.organization_roles set name = 'Renamed', permissions = '{orders.view,orders.update}' where id = '${R_PLAIN}'`);
check("existing behaviour: a manager can still edit a role that has no Inbox permissions", r.ok && r.count === 1 && (await perms(R_PLAIN)) === "orders.view,orders.update", JSON.stringify(r));
r = await as(mgr1, `update public.organization_members set role_id = '${R_PLAIN2}' where id = '${M_PLAIN1}'`);
check("existing behaviour: a manager can still move a member between ordinary roles", r.ok && r.count === 1 && (await roleOf(M_PLAIN1)).role_id === R_PLAIN2, JSON.stringify(r));
r = await as(mgr1, `update public.organization_members set status = 'inactive' where id = '${M_PLAIN1}'`);
const r2 = await as(mgr1, `update public.organization_members set status = 'active' where id = '${M_PLAIN1}'`);
check("existing behaviour: a manager can still deactivate / reactivate an ordinary member", r.ok && r2.ok && (await roleOf(M_PLAIN1)).status === "active");
r = await as(mgr1, `update public.organization_members set status = 'removed' where id = '${M_STAFF1}'`);
check("a manager can still remove a member who holds an Inbox role (that only takes access away)", r.ok && r.count === 1 && (await roleOf(M_STAFF1)).status === "removed", JSON.stringify(r));
r = await as(mgr1, `update public.organization_roles set permissions = '{staff.view,staff.manage,staff.invite,payments.view}' where id = '${R_MGR}'`);
check("scope: the guard does NOT change how other permissions are handled (the pre-existing non-inbox escalation is untouched and reported separately)", r.ok && r.count === 1);

// ============================================================ migration hygiene
const sqlText = read("supabase/migrations/2026-12-13_whatsapp_inbox_team_permission_guard.sql").replace(/--.*$/gm, "");
check("migration: only functions and triggers (no table, column, policy or data change)", !/create table|alter table|create policy|drop policy|insert into|delete from|\bupdate public\./i.test(sqlText) && (sqlText.match(/create trigger/g) || []).length === 3);
check("migration: every function pins search_path (definers) and execute is service_role only", (sqlText.match(/security definer\s+set search_path = public, pg_temp/g) || []).length === 5 && /revoke all on function %s from public, anon, authenticated, service_role/.test(sqlText) && /grant execute on function %s to service_role'/.test(sqlText));
const rb = read("supabase/support/2026-12-13_whatsapp_inbox_team_permission_guard.rollback.sql").replace(/--.*$/gm, "");
check("rollback: drops only the three triggers and the seven functions (no table/data)", (rb.match(/drop trigger/g) || []).length === 3 && (rb.match(/drop function/g) || []).length === 7 && !/drop table|delete from|truncate/i.test(rb));
await db.exec(rb);
r = await as(mgr1, `update public.organization_roles set permissions = '{staff.view,staff.manage,staff.invite,inbox.view}' where id = '${R_MGR}'`);
check("negative control: with the guard rolled back the original hole is back (so the tests above are not vacuous)", r.ok && r.count === 1);

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
