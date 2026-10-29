// Churches & Ministries Phase 2A: people, groups and leadership (database foundation), tested OFFLINE.
// Loads the REAL Team migrations (2026-10-01 / 03 / 04), the real ceiling guard (2026-10-07a) and the real Inbox guard (2026-12-13) into scratch in-memory PostgreSQL (PGlite),
// applies the new migration on top, and attacks it the way a signed-in user could: direct table access under the `authenticated` / `anon` roles, RLS on, auth.uid() = that user.
// All data is synthetic. No Supabase, no network, no production data, no SQL against any real database.
//   Run:  node scripts/tests/churchPeopleGroups.test.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
let suite = "";
const check = (name, cond, detail = "") => { results.push({ name: `${suite}${name}`, pass: !!cond }); if (!cond) console.log("  FAIL:", `${suite}${name}`, "|", String(detail).slice(0, 600)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s) => s.replace(/--[^\n]*/g, "");

const MIG_PATH = "supabase/migrations/2026-12-27_church_people_groups.sql";
const SUP = "supabase/support/2026-12-27_church_people_groups";
const MIG = read(MIG_PATH);
const PRE = read(`${SUP}.preflight.sql`);
const VER = read(`${SUP}.verify.sql`);
const ROLL = read(`${SUP}.rollback.sql`);
const POLICY_DOC = read(`${SUP}.retention-policy.md`);
const TEAM01 = read("supabase/migrations/2026-10-01_team_management.sql").split("\n").slice(27, 261).join("\n");
const TEAM03 = read("supabase/migrations/2026-10-03_team_rls_enterprise_gate.sql");
const TEAM04 = read("supabase/migrations/2026-10-04_team_members_read_fix.sql");
const CEILING = read("supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql");
const INBOX = read("supabase/migrations/2026-12-13_whatsapp_inbox_team_permission_guard.sql");

const id = (kind, n) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = (n) => id("c", n), P = (n) => id("a", n), R = (n) => id("b", n), M = (n) => id("e", n), G = (n) => id("f", n), GM = (n) => id("d", n);

// ---- personas -------------------------------------------------------------------------------------------------------------------------------------------------------
const owner1 = U(1), mgr1 = U(2), viewer1 = U(3), kids1 = U(4), kidsMgr1 = U(5), del1 = U(6), leader1 = U(7), vol1 = U(8), plain1 = U(9), stranger = U(10), owner2 = U(11), leader2 = U(12),
  admin = U(13), adminOwner = U(14), adminMember = U(15), ownerNC = U(16), mgrNoChurch = U(17), staffPlain = U(18), mgrKids = U(19), mgrInbox = U(20), kvm = U(21), kgv = U(22), kg = U(23), kd = U(24), kdn = U(25), delUser = U(30), owner5 = U(40), owner6 = U(41), owner7 = U(42);
const prof1 = P(1), prof2 = P(2), prof3 = P(3), profNC = P(4), prof4 = P(5);
const planBiz = "d0000000-0000-4000-8000-000000000001", planFree = "d0000000-0000-4000-8000-000000000002";
// roles of church 1 (created by the service role, i.e. on the owner's behalf)
const R_MGR = R(1), R_VIEW = R(2), R_KIDS = R(3), R_KIDSMGR = R(4), R_DEL = R(5), R_PLAIN = R(6), R_LEADMGR = R(7), R_NOCH = R(8), R_MGRK = R(9), R_MGRI = R(10), R_KVM = R(11), R_KGV = R(12), R_KG = R(13), R_KD = R(14), R_KDN = R(15), P2_MGR = R(20);
const MGR_PERMS = "staff.view,staff.manage,staff.invite,church.members.view,church.members.manage,church.groups.view,church.groups.manage,church.leadership.view";
// church data
const MA = M(1), ML = M(2), MV = M(3), MO = M(4), MG = M(5), MC1 = M(6), MC2 = M(7), MP = M(8), MY = M(9), M2A = M(20), M2B = M(21);
const G1 = G(1), G2 = G(2), G3 = G(3), G4 = G(4);
const GM_L = GM(1), GM_V = GM(2), GM_P = GM(3), GM_C2 = GM(4), GM_O = GM(5), GM_A = GM(6);
const LD1 = id("9", 1), LD2 = id("9", 2);

const BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key default gen_random_uuid(), name text, team_enabled boolean not null default false);
  create table public.users (id uuid primary key, role text not null default 'user', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, category text, categories text[] not null default '{}', published boolean not null default true,
    constraint profiles_category_check check (category is null or category in ('music_entertainment', 'other', 'church_ministries')));
  create table public.ringo_customers (id uuid primary key default gen_random_uuid());
  create function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (published = true or auth.uid() = user_id or public.is_admin());
  create policy "profiles insert by owner" on public.profiles for insert with check (auth.uid() = user_id);
  create policy "profiles update by owner or admin" on public.profiles for update using (auth.uid() = user_id or public.is_admin());
  create policy "profiles delete by owner or admin" on public.profiles for delete using (auth.uid() = user_id or public.is_admin());
`;

async function newDb({ ceiling = true, inbox = true, team = true } = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  if (team) {
    await db.exec(TEAM01); await db.exec(TEAM03); await db.exec(TEAM04);
    await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);
    if (ceiling) await db.exec(CEILING);
    if (inbox) await db.exec(INBOX);
  }
  return db;
}
const svc = async (db, sql) => { await db.exec("set role service_role"); try { const out = await db.exec(sql); return out[out.length - 1]; } finally { await db.exec("reset role"); } };
const svcErr = async (db, sql) => { await db.exec("set role service_role"); try { await db.exec(sql); return null; } catch (e) { return { code: e.code, msg: String(e.message) }; } finally { await db.exec("reset role"); } };
const asRole = async (db, role, user, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user || ""}', false)`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, code: e.code, msg: String(e.message), detail: String(e.detail || "") }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)"); }
};
const as = (db, user, sql) => asRole(db, "authenticated", user, sql);
const txn = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { await db.exec("rollback").catch(() => {}); return String(e.message || e); } };

// a structural fingerprint of everything the migration promises NOT to change
const sig = async (db) => {
  const q = async (s) => JSON.stringify((await db.query(s)).rows);
  return [
    await q(`select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and proname in ('is_admin','has_org_permission','is_org_member','org_team_enabled') order by 1`),
    await q(`select polrelid::regclass::text as t, polname, polcmd, polpermissive from pg_policy where polrelid in ('public.organization_roles'::regclass,'public.organization_members'::regclass,'public.organization_invitations'::regclass,'public.profiles'::regclass,'public.organization_activity_log'::regclass) order by 1,2`),
    await q(`select tgrelid::regclass::text as t, tgname, tgenabled from pg_trigger where not tgisinternal and tgname not like 'church\\_%' and tgname not like '%\\_church\\_guard\\_trg' order by 1,2`),
    await q(`select count(*)::int as n from public.organization_roles`),
    await q(`select count(*)::int as n from public.organization_members`),
  ].join("|");
};

async function seedBase(db) {
  await svc(db, `
    insert into public.plans (id, name, team_enabled) values ('${planBiz}','business',true), ('${planFree}','free',false);
    insert into public.users (id, role, plan_id) values
      ('${owner1}','user','${planBiz}'), ('${mgr1}','user','${planFree}'), ('${viewer1}','user','${planFree}'), ('${kids1}','user','${planFree}'), ('${kidsMgr1}','user','${planFree}'),
      ('${del1}','user','${planFree}'), ('${leader1}','user','${planFree}'), ('${vol1}','user','${planFree}'), ('${plain1}','user','${planFree}'), ('${stranger}','user','${planFree}'),
      ('${owner2}','user','${planBiz}'), ('${leader2}','user','${planFree}'), ('${admin}','admin','${planFree}'), ('${adminOwner}','admin','${planBiz}'), ('${adminMember}','admin','${planFree}'),
      ('${ownerNC}','user','${planBiz}'), ('${mgrNoChurch}','user','${planFree}'), ('${staffPlain}','user','${planFree}'), ('${mgrKids}','user','${planFree}'), ('${mgrInbox}','user','${planFree}'), ('${kvm}','user','${planFree}'), ('${kgv}','user','${planFree}'), ('${kg}','user','${planFree}'), ('${kd}','user','${planFree}'), ('${kdn}','user','${planFree}'), ('${delUser}','user','${planFree}'),
      ('${owner5}','user','${planBiz}'), ('${owner6}','user','${planBiz}'), ('${owner7}','user','${planBiz}');
    insert into public.profiles (id, user_id, category, categories) values
      ('${prof1}','${owner1}','church_ministries','{church_ministries}'), ('${prof2}','${owner2}','other','{church_ministries}'),
      ('${prof3}','${adminOwner}','church_ministries','{}'), ('${profNC}','${ownerNC}','music_entertainment','{}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${R_MGR}','${prof1}','mgr','Church admin','{${MGR_PERMS}}'),
      ('${R_VIEW}','${prof1}','view','Viewer','{church.members.view}'),
      ('${R_KIDS}','${prof1}','kids','Kids viewer','{church.children.view,church.members.view}'),
      ('${R_KIDSMGR}','${prof1}','kidsmgr','Kids manager','{church.children.manage,church.children.view,church.members.manage,church.members.view}'),
      ('${R_DEL}','${prof1}','del','Deleter','{church.members.view,church.members.delete}'),
      ('${R_PLAIN}','${prof1}','plain','Plain','{orders.view}'),
      ('${R_LEADMGR}','${prof1}','leadmgr','Leadership manager','{church.leadership.manage,church.leadership.view}'),
      ('${R_NOCH}','${prof1}','noch','Team manager, no church','{staff.view,staff.manage,staff.invite}'),
      ('${R_MGRK}','${prof1}','mgrk','Team manager with children view','{staff.view,staff.manage,staff.invite,church.children.view,church.members.view}'),
      ('${R_KVM}','${prof1}','kvm','Children viewer who can manage members','{church.children.view,church.members.view,church.members.manage}'),
      ('${R_KGV}','${prof1}','kgv','Children viewer who can manage groups','{church.children.view,church.members.view,church.groups.view,church.groups.manage}'),
      ('${R_KG}','${prof1}','kg','Children, members and groups manager','{church.children.manage,church.children.view,church.members.view,church.members.manage,church.groups.view,church.groups.manage}'),
      ('${R_KD}','${prof1}','kd','Can hard-delete a child (members.delete + children.manage + children.view)','{church.members.view,church.members.delete,church.children.view,church.children.manage}'),
      ('${R_KDN}','${prof1}','kdn','members.delete + children.manage but NO children.view','{church.members.view,church.members.delete,church.children.manage}'),
      ('${R_MGRI}','${prof1}','mgri','Team manager with inbox','{staff.view,staff.manage,staff.invite,inbox.view}'),
      ('${P2_MGR}','${prof2}','mgr','Church admin 2','{staff.view,staff.manage,church.members.view,church.members.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values
      ('${prof1}','${mgr1}','${R_MGR}'), ('${prof1}','${viewer1}','${R_VIEW}'), ('${prof1}','${kids1}','${R_KIDS}'), ('${prof1}','${kidsMgr1}','${R_KIDSMGR}'),
      ('${prof1}','${del1}','${R_DEL}'), ('${prof1}','${mgrNoChurch}','${R_NOCH}'), ('${prof1}','${staffPlain}','${R_PLAIN}'), ('${prof1}','${mgrKids}','${R_MGRK}'),
      ('${prof1}','${adminMember}','${R_VIEW}'), ('${prof1}','${mgrInbox}','${R_MGRI}'),
      ('${prof1}','${kvm}','${R_KVM}'), ('${prof1}','${kgv}','${R_KGV}'), ('${prof1}','${kg}','${R_KG}'), ('${prof1}','${kd}','${R_KD}'), ('${prof1}','${kdn}','${R_KDN}');
  `);
}

async function seedChurch(db) {
  await svc(db, `
    insert into public.church_members (id, profile_id, full_name, age_group, user_id, guardian_member_id) values
      ('${MA}','${prof1}','Alice Adult','adult','${plain1}',null), ('${ML}','${prof1}','Lou Leader','adult','${leader1}',null), ('${MV}','${prof1}','Vera Volunteer','adult','${vol1}',null),
      ('${MO}','${prof1}','Otto Other','adult',null,null), ('${MG}','${prof1}','Grace Guardian','adult',null,null), ('${MP}','${prof1}','Pat Plain','adult',null,null);
    insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values
      ('${MC1}','${prof1}','Child One','child','${MG}'), ('${MC2}','${prof1}','Child Two','child','${MG}'), ('${MY}','${prof1}','Yara Youth','youth','${MG}');
    insert into public.church_members (id, profile_id, full_name, age_group, user_id) values
      ('${M2A}','${prof2}','Second Church Leader','adult','${leader2}'), ('${M2B}','${prof2}','Second Church Member','adult',null);
    insert into public.church_groups (id, profile_id, kind, name) values
      ('${G1}','${prof1}','group','Choir'), ('${G2}','${prof1}','department','Ushers'), ('${G3}','${prof2}','group','Youth'), ('${G4}','${prof1}','group','Hospitality');
    insert into public.church_group_members (id, profile_id, group_id, member_id, role) values
      ('${GM_L}','${prof1}','${G1}','${ML}','leader'), ('${GM_V}','${prof1}','${G1}','${MV}','volunteer'), ('${GM_P}','${prof1}','${G1}','${MP}','member'),
      ('${GM_C2}','${prof1}','${G1}','${MC2}','member'), ('${GM_O}','${prof1}','${G2}','${MO}','member'), ('${GM_A}','${prof2}','${G3}','${M2A}','leader');
    insert into public.church_leadership (id, profile_id, member_id, title) values ('${LD1}','${prof1}','${ML}','Elder'), ('${LD2}','${prof2}','${M2A}','Deacon');
  `);
}

const cnt = async (db, user, table, where = "true") => { const r = await as(db, user, `select count(*)::int as n from public.${table} where ${where}`); return r.ok ? r.rows[0].n : `ERR ${r.msg}`; };
const ids = async (db, user, table, where = "true") => { const r = await as(db, user, `select id from public.${table} where ${where} order by id`); return r.ok ? r.rows.map((x) => x.id) : `ERR ${r.msg}`; };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const denied = (r, re = /./) => r.ok === false && r.code === "42501" && re.test(r.msg);
const rls = (r) => r.ok === false && r.code === "42501" && /row-level security/.test(r.msg); // a policy refused the new row
const zero = (r) => r.ok && r.count === 0;                                                   // the statement ran but could see / change no row
const reason = (r, re) => r.ok === false && r.code === "42501" && re.test(`${r.msg} ${r.detail || ""}`); // a trigger or privilege refused it, for THIS reason
const snap = async (db, sql) => JSON.stringify((await db.query(sql)).rows);
// A boundary is only proven if (1) the denied users' attempt leaves the state exactly as it was, for the expected reason, AND (2) the very same statement DOES change the state
// when an authorised user runs it. `how`: "rls" (a policy error), "filtered" (no row visible / changeable), or a RegExp (a trigger / privilege error with that reason).
async function gate(db, label, { deny, allow, stmt, look, restore, how }) {
  const before = await snap(db, look);
  let why = "";
  let ok = true;
  for (const u of deny) {
    const r = await as(db, u, stmt);
    const good = how === "rls" ? rls(r) : how === "filtered" ? zero(r) : reason(r, how);
    if (!good) { ok = false; why += ` | denied user ${u.slice(-2)} got ${JSON.stringify(r)}`; }
    if ((await snap(db, look)) !== before) { ok = false; why += ` | state changed by denied user ${u.slice(-2)}`; }
  }
  const ra = await as(db, allow, stmt);
  const changed = (await snap(db, look)) !== before;
  if (!(ra.ok && changed)) { ok = false; why += ` | the authorised user did not change the state: ${JSON.stringify(ra)}`; }
  if (restore) await svc(db, restore);
  check(label, ok, why);
}
const perms = async (db, rid) => (await db.query(`select permissions from public.organization_roles where id = '${rid}'`)).rows[0].permissions.join(",");
const roleOf = async (db, uid, prof = prof1) => (await db.query(`select role_id, status from public.organization_members where user_id = '${uid}' and profile_id = '${prof}'`)).rows[0];
const memberOf = async (db, mid) => (await db.query(`select * from public.church_members where id = '${mid}'`)).rows[0];
const invite = (iid, role, by, prof = prof1) => `insert into public.organization_invitations (id, profile_id, role_id, invited_by, method, token_hash, expires_at) values ('${iid}','${prof}','${role}','${by}','link','${iid}', now() + interval '7 days')`;

// =========================================================================================================================================================================
// A. STATIC: the migration is what it says it is
// =========================================================================================================================================================================
{
  suite = "[static] ";
  const code = stripComments(MIG);
  const files = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  // Phase 3 adds exactly one later migration (2026-12-28_daily_words.sql); this one must still directly follow the church category migration and be followed by nothing else.
  check("it follows the church category migration, and only the later church migrations (Phases 3, 4, 5, 7, 8, 9, Testimonies, the landing images and the expansion Phases 3 to 7) come after it, in that order", files.indexOf("2026-12-27_church_people_groups.sql") === files.indexOf("2026-12-26_church_category.sql") + 1 && files.slice(files.indexOf("2026-12-27_church_people_groups.sql") + 1).join() === "2026-12-28_daily_words.sql,2026-12-29_ministry_events_announcements.sql,2026-12-30_bible_programs.sql,2026-12-31_ministry_attendance.sql,2027-01-01_ministry_music_links.sql,2027-01-02_ministry_care_cases.sql,2027-01-03_ministry_testimonies.sql,2027-01-04_church_landing_images.sql,2027-01-05_church_groups_pastors.sql,2027-01-06_church_membership_requests.sql,2027-01-07_church_bible_year.sql,2027-01-08_church_push.sql,2027-01-09_church_counselling.sql,2027-01-10_church_giving.sql,2027-01-11_church_giving_lock.sql,2027-01-12_church_gifts.sql,2027-01-14_church_giving_general.sql,2027-01-15_church_inventory.sql,2027-01-16_church_service_schedule.sql", files.slice(-6).join(","));
  check("one transaction with a lock timeout, preconditions and postconditions", /^\s*begin;/m.test(code) && /commit;\s*$/.test(code.trim()) && /set local lock_timeout/.test(code) && /precondition failed/.test(code) && /postcondition failed/.test(code));
  check("the four tables are created and nothing else is created as a table", (code.match(/create table if not exists public\.\w+/g) || []).join(",") === "create table if not exists public.church_members,create table if not exists public.church_groups,create table if not exists public.church_group_members,create table if not exists public.church_leadership");
  check("no existing table is altered, and no existing policy / trigger / function is dropped or replaced", !/alter table public\.(profiles|users|plans|organization_\w+|ringo_customers)/i.test(code)
    && !/drop policy[^;]*on (public\.)?(profiles|users|organization_\w+)/i.test(code)
    && !/drop trigger[^;]*on public\.(profiles|users|organization_\w+)[^;]*;/i.test(code.replace(/drop trigger if exists organization_(roles|members|invitations)_church_guard_trg on public\.organization_\w+;/g, ""))
    && !/create or replace function public\.(has_org_permission|is_admin|is_org_member|org_team_enabled|team_permissions_not_held|team_inbox_\w+|team_role_has_inbox)\b/i.test(code));
  check("the only change to Team tables is three NEW church guard triggers (named, additive)", (code.match(/create trigger organization_\w+_church_guard_trg/g) || []).length === 3);
  const policyStatements = code.match(/create policy[^;]*;/g) || [];
  const functionBodies = (code.match(/\$\$[\s\S]*?\$\$/g) || []).filter((b) => !/precondition failed|postcondition failed/.test(b));
  check("no policy and no church function calls has_org_permission() or is_org_member() (the helpers that grant platform admins access)", policyStatements.length === 29 && policyStatements.every((x) => !/has_org_permission|is_org_member/.test(x)) && functionBodies.length >= 18 && functionBodies.every((b) => !/has_org_permission|is_org_member/.test(b)));
  check("no policy is granted to anon or PUBLIC; every policy is `to authenticated`", !/create policy[^;]*\bto (anon|public)\b/i.test(code) && (code.match(/create policy/g) || []).length === (code.match(/create policy[^;]*to authenticated/g) || []).length && (code.match(/create policy/g) || []).length === 29);
  check("privileges are revoked from PUBLIC, anon AND authenticated before the minimum is granted, and never granted to anon", /revoke all on public\.church_members, public\.church_groups, public\.church_group_members, public\.church_leadership from public, anon, authenticated;/.test(code) && /grant select, insert, update, delete on public\.church_members, public\.church_groups, public\.church_group_members, public\.church_leadership to authenticated;/.test(code) && !/grant [^;]*\bto [^;]*\banon\b/i.test(code) && !/grant [^;]*(truncate|references|trigger)/i.test(code));
  const topLevel = code.replace(/\$\$[\s\S]*?\$\$/g, () => "$$ $$").replace(/'[^']*'/g, "''"); // statements outside function bodies and string literals
  check("the migration writes no data at top level (no insert / update / delete / truncate); the only DML anywhere is the age-sync trigger's own UPDATE of church_group_members", !/\b(insert\s+into|delete\s+from|truncate)\b/i.test(topLevel) && !/\bupdate\s+public\./i.test(topLevel) && (code.match(/\bupdate\s+public\./gi) || []).length === 1 && /update public\.church_group_members gm\s+set is_child/.test(code));
  check("church_member_age_group is not created, and no function returns another person's age group", !/create (or replace )?function public\.church_member_age_group/i.test(code) && !/returns text[\s\S]{0,80}age_group/i.test(code.replace(/\$\$[\s\S]*?\$\$/g, "")));
  check("concurrency: the guardian row and the person's row are locked FOR SHARE and the group row FOR UPDATE", (code.match(/for share;/g) || []).length === 2 && (code.match(/for update;/g) || []).length === 2);
  check("M2: the age-sync trigger takes the group locks in id order, only when the person starts or stops being a child, before the flag flips", /\(old\.age_group = 'child'\) is distinct from \(new\.age_group = 'child'\) then\s+perform 1 from public\.church_groups g[\s\S]*?order by g\.id for update;[\s\S]*?update public\.church_group_members gm/.test(code));
  check("group deletion: a security-definer, pinned-search_path BEFORE DELETE trigger refuses church_group_has_children unless the caller holds church.children.manage", /create or replace function public\.church_groups_delete_guard\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = pg_catalog, public, pg_temp/.test(code) && /create trigger church_groups_delete_guard_trg before delete on public\.church_groups/.test(code) && /church_group_has_children/.test(code) && /not public\.church_has_permission\(old\.profile_id, 'church\.children\.manage'\)/.test(code));
  check("re-run: the four tables must already carry the marker, otherwise the migration refuses to adopt them", /already exist but are not marked as managed by this migration; refusing to adopt or re-mark them/.test(code));
  const doc = POLICY_DOC.replace(/\s+/g, " ");
  check("retention doc: the owner-account cascade starts at auth.users, and hard-deleting a child's record names every permission it needs", /auth\.users/.test(doc) && /OWNER's Ringo account/.test(doc) && /hard-deleting a child's record needs[^|]*church\.members\.delete[^|]*church\.children\.manage[^|]*church\.children\.view/i.test(doc));
  check("name collisions: functions, triggers and tables carry a marker comment, and the preconditions refuse foreign objects", /managed by 2026-12-27_church_people_groups\.sql/.test(code) && /not managed by it \(it would be overwritten\)/.test(code) && /not managed by it \(it would be replaced\)/.test(code) && (code.match(/comment on table/g) || []).length === 4 && (code.match(/comment on trigger/g) || []).length === 3);
  check("every definer function pins search_path", (code.match(/security definer/g) || []).length === (code.match(/security definer\s+set search_path = pg_catalog, public, pg_temp/g) || []).length);
  check("the child rules are constraints, not only triggers", /church_members_child_minimal_check/.test(code) && /church_members_child_guardian_check/.test(code) && /church_members_adult_no_guardian_check/.test(code));
  check("no date of birth, photo, school, religion, denomination or attendance column exists", !/date_of_birth|birth|photo|school|denomination|religion|baptis|attendance|donation|giving|counsel/i.test(code.replace(/counselling|donation|attendance|no date of birth|no photo|no school|baptism and other/gi, "")));
  check("no export, public join request or public leadership display is added (deferred)", !/export|show_on_public|public_page|join_request_token/i.test(code.replace(/church\.export|CSV export|no CSV export|'join_request'|join_request/g, "")));
  for (const k of ["preflight", "verify", "rollback"]) check(`${k} companion exists`, fs.existsSync(path.join(REPO, `${SUP}.${k}.sql`)));
  check("preflight and verify are read-only", ["preflight", "verify"].every((k) => !/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(stripComments(read(`${SUP}.${k}.sql`)).replace(/'[^']*'/g, ""))));
  check("the retention policy exists, says nothing is erased automatically, and lists the open decisions", /Nothing here is automated erasure/i.test(POLICY_DOC) && /Open policy decisions/.test(POLICY_DOC) && /Retention period/.test(POLICY_DOC) && /Age boundaries/.test(POLICY_DOC));
  // nothing in the application reads these tables yet: no AI context, analytics, push payload, log or page can expose them
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const refs = walk(path.join(REPO, "src")).filter((f) => /\.(ts|tsx|js|mjs|json)$/.test(f)).filter((f) => /church_members|church_groups|church_group_members|church_leadership/.test(fs.readFileSync(f, "utf8")));
  // Phase 2B (churchPeopleGroupsApi.test.mjs) supersedes "nothing reads them yet": ONLY the church workspace code (its handlers, routes and screens) may, and that test proves no public, AI, analytics, push or log code does.
  const workspace = (f) => /[\\/]src[\\/](lib[\\/]church|app[\\/]api[\\/]church|components[\\/]church|app[\\/]dashboard[\\/]church)[\\/]/.test(f);
  check("no file under src/ outside the church workspace references the new tables (so AI, analytics, push, logs and public pages cannot expose them)", refs.filter((f) => !workspace(f)).length === 0, refs.filter((f) => !workspace(f)).join(", "));
  const ALLOWED = new Set([MIG_PATH, `${SUP}.preflight.sql`, `${SUP}.verify.sql`, `${SUP}.rollback.sql`, `${SUP}.retention-policy.md`, "scripts/tests/churchPeopleGroups.test.mjs",
    "scripts/tests/churchCategory.test.mjs", "scripts/tests/churchPublicPage.test.mjs", // the two earlier church tests whose "no church tables / newest migration is Phase 0" assertions this phase supersedes
    "supabase/support/2026-12-26_church_category.verify.sql"]); // its historical "no church_* tables" row now excludes the four known Phase 2A tables
  let changed = [];
  try { changed = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.slice(3).replace(/"/g, "").trim()); } catch { /* not a git checkout */ }
  // Phase 2B adds application code on top; what must stay true is that the Phase 2A database files themselves are never modified.
  const frozen = [MIG_PATH, `${SUP}.preflight.sql`, `${SUP}.verify.sql`, `${SUP}.rollback.sql`, `${SUP}.retention-policy.md`];
  check("scope: the Phase 2A migration and its support files are unchanged", changed.every((f) => !frozen.includes(f)), changed.filter((f) => frozen.includes(f)).join(", "));
  void ALLOWED;
}

// =========================================================================================================================================================================
// B. EXECUTED SQL: the whole attack surface, run twice — with every earlier Team guard loaded (A) and with NONE of them (B), to prove this migration does not depend on them
// =========================================================================================================================================================================
async function runSuite(label, { ceiling, inbox }) {
  suite = `[${label}] `;
  const db = await newDb({ ceiling, inbox });

  // ---- preflight on the untouched database -------------------------------------------------------------------------------------------------------------------------
  const pre = await db.exec(PRE);
  check("preflight query 1: every row is ok on a database where the migration has not been applied", pre[0].rows.length === 12 && pre[0].rows.every((x) => x.ok === true), JSON.stringify(pre[0].rows.filter((x) => !x.ok)));
  const info = Object.fromEntries(pre[1].rows.map((x) => [x.item, x.value]));
  check("preflight query 2 reports which Team guards are live", info.team_ceiling_guard_triggers === (ceiling ? "3" : "0") && info.team_inbox_guard_triggers === (inbox ? "3" : "0"), JSON.stringify(info));
  const vPre = await db.query(VER).then((x) => x.rows).catch(() => null);
  check("verify before the migration is not green (negative control)", vPre === null || vPre.some((x) => x.ok === false));

  await seedBase(db);
  const sigBefore = await sig(db);
  const err = await txn(db, MIG);
  check("the migration applies cleanly", err === null, err);
  check("applying it changed NOTHING that already existed (functions, policies, triggers, counts)", (await sig(db)) === sigBefore);
  const ver = await db.query(VER);
  check("verify: every one of the 23 rows is ok right after the migration", ver.rows.length === 23 && ver.rows.every((x) => x.ok === true), JSON.stringify(ver.rows.filter((x) => !x.ok)));
  await seedChurch(db);
  const ver2 = await db.query(VER);
  check("verify after the feature holds data: only the 'tables are empty' row differs", ver2.rows.filter((x) => !x.ok).length === 1 && /^23 /.test(ver2.rows.find((x) => !x.ok).label));
  const pre2 = await db.exec(PRE);
  check("preflight after the migration is NOT green (it detects an already-applied state)", pre2[0].rows.some((x) => x.ok === false));

  // ---- structure ---------------------------------------------------------------------------------------------------------------------------------------------------
  const pols = (await db.query(`select c.relname, count(*) filter (where p.polpermissive)::int as perm, count(*) filter (where not p.polpermissive)::int as restr, bool_and(p.polroles = array[(select oid from pg_roles where rolname='authenticated')]) as only_auth
     from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'church\\_%' group by 1 order by 1`)).rows;
  check("policies: members 7+4, groups 4+1, group_members 4+4, leadership 4+1 (permissive + restrictive), all authenticated-only", JSON.stringify(pols.map((x) => [x.relname, x.perm, x.restr, x.only_auth])) === JSON.stringify([["church_group_members", 4, 4, true], ["church_groups", 4, 1, true], ["church_leadership", 4, 1, true], ["church_members", 7, 4, true]]), JSON.stringify(pols));
  for (const t of ["church_members", "church_groups", "church_group_members", "church_leadership"]) {
    const a = await asRole(db, "anon", "", `select * from public.${t}`);
    check(`anon cannot read ${t}`, a.ok === false && a.code === "42501", JSON.stringify(a));
    const w = await asRole(db, "anon", "", `delete from public.${t}`);
    check(`anon cannot write ${t}`, w.ok === false && w.code === "42501");
  }
  const fks = (await db.query(`select conname, confdeltype from pg_constraint where contype='f' and conrelid::regclass::text like 'church\\_%' order by 1`)).rows;
  const act = Object.fromEntries(fks.map((x) => [x.conname, x.confdeltype]));
  check("account / visitor links detach (SET NULL), tenant keys cascade, the guardian key refuses", act.church_members_user_id_fkey === "n" && act.church_members_customer_id_fkey === "n" && act.church_members_profile_id_fkey === "c" && act.church_group_members_member_fk === "c" && act.church_leadership_member_fk === "c" && act.church_members_guardian_fk === "a", JSON.stringify(act));

  // ---- tenant isolation --------------------------------------------------------------------------------------------------------------------------------------------
  check("church 1 owner sees exactly church 1's 9 people; church 2's owner sees church 2's 2 and none of church 1's", (await cnt(db, owner1, "church_members")) === 9 && (await cnt(db, owner2, "church_members")) === 2 && (await cnt(db, owner2, "church_members", `profile_id = '${prof1}'`)) === 0);
  for (const t of ["church_groups", "church_group_members", "church_leadership"]) check(`the other church's owner sees none of church 1's ${t}`, (await cnt(db, owner2, t, `profile_id = '${prof1}'`)) === 0);
  check("a delegated church administrator of church 1 sees nothing of church 2", (await cnt(db, mgr1, "church_members", `profile_id = '${prof2}'`)) === 0 && (await cnt(db, mgr1, "church_groups", `profile_id = '${prof2}'`)) === 0);
  const temp = (n) => `insert into public.church_members (id, profile_id, full_name) values ('${M(n)}','${prof1}','Temp ${n}') on conflict (id) do nothing`;
  await gate(db, "cross-church: church 2's owner cannot UPDATE church 1's person (unchanged); church 1's owner can", { deny: [owner2], allow: owner1, stmt: `update public.church_members set full_name = 'Alice Edited' where id = '${MA}'`, look: `select full_name from public.church_members where id = '${MA}'`, restore: `update public.church_members set full_name = 'Alice Adult' where id = '${MA}'`, how: "filtered" });
  await svc(db, temp(53));
  await gate(db, "cross-church: church 2's owner cannot DELETE church 1's person (unchanged); church 1's owner can", { deny: [owner2], allow: owner1, stmt: `delete from public.church_members where id = '${M(53)}'`, look: `select count(*) from public.church_members where id = '${M(53)}'`, restore: temp(53), how: "filtered" });
  await svc(db, `delete from public.church_members where id = '${M(53)}'`);
  await gate(db, "cross-church: a church-1 administrator cannot insert into church 2 (policy error); church 2's owner can", { deny: [mgr1], allow: owner2, stmt: `insert into public.church_members (profile_id, full_name) values ('${prof2}','Intruder')`, look: `select count(*) from public.church_members where profile_id = '${prof2}'`, restore: `delete from public.church_members where full_name = 'Intruder'`, how: "rls" });
  check("a group leader of church 2 cannot see church 1's group or its members", (await cnt(db, leader2, "church_groups", `profile_id = '${prof1}'`)) === 0 && (await cnt(db, leader2, "church_group_members", `profile_id = '${prof1}'`)) === 0 && (await cnt(db, leader2, "church_members", `profile_id = '${prof1}'`)) === 0);
  // each case twice: with the integrity triggers in place (they refuse first), and with the trigger switched off to prove the KEY ITSELF refuses
  const noTrigger = async (table, trg, fn) => { await db.exec(`alter table public.${table} disable trigger ${trg}`); try { return await fn(); } finally { await db.exec(`alter table public.${table} enable trigger ${trg}`); } };
  const X1 = `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G1}','${M2B}')`;
  const X2 = `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof2}','${G1}','${M2B}')`;
  const X3 = `insert into public.church_leadership (profile_id, member_id, title) values ('${prof1}','${M2B}','Elder')`;
  const X4 = `insert into public.church_members (profile_id, full_name, age_group, guardian_member_id) values ('${prof1}','Kid','child','${M2A}')`;
  let e = await svcErr(db, X1);
  check("a church-1 group cannot take a church-2 person (service role included)", e && e.code === "23514", JSON.stringify(e));
  e = await noTrigger("church_group_members", "church_group_members_guard_trg", () => svcErr(db, X1));
  check("composite key alone: a church-1 group cannot take a church-2 person", e && e.code === "23503", JSON.stringify(e));
  e = await noTrigger("church_group_members", "church_group_members_guard_trg", () => svcErr(db, X2));
  check("composite key alone: a church-2 row cannot point at a church-1 group", e && e.code === "23503", JSON.stringify(e));
  e = await svcErr(db, X3);
  check("leadership cannot point at another church's person (service role included)", e && e.code === "23514", JSON.stringify(e));
  e = await noTrigger("church_leadership", "church_leadership_guard_trg", () => svcErr(db, X3));
  check("composite key alone: leadership cannot point at another church's person", e && e.code === "23503", JSON.stringify(e));
  e = await svcErr(db, X4);
  check("a guardian from another church is rejected (service role included)", e && e.code === "23514", JSON.stringify(e));
  e = await noTrigger("church_members", "church_members_guard_trg", () => svcErr(db, X4));
  check("composite key alone: a guardian from another church is rejected", e && e.code === "23503", JSON.stringify(e));
  e = await svcErr(db, `update public.church_members set profile_id = '${prof2}' where id = '${MA}'`);
  check("a person can never be moved to another church (service role included)", e && e.code === "42501" && /church_tenant_immutable/.test(e.msg), JSON.stringify(e));
  e = await svcErr(db, `update public.church_groups set profile_id = '${prof2}' where id = '${G2}'`);
  check("a group can never be moved to another church", e && /church_tenant_immutable/.test(e.msg), JSON.stringify(e));
  e = await svcErr(db, `insert into public.church_members (profile_id, full_name) values ('${profNC}','Nobody')`);
  check("rows can only be created for a church profile (a music profile is refused)", e && /church_profile_required/.test(e.msg), JSON.stringify(e));
  e = await svcErr(db, `insert into public.church_members (profile_id, full_name) values ('${prof2}','Via secondary category')`);
  check("a profile with church as a SECONDARY category is accepted", e === null, JSON.stringify(e));

  // ---- platform admins ---------------------------------------------------------------------------------------------------------------------------------------------
  for (const t of ["church_members", "church_groups", "church_group_members", "church_leadership"]) check(`platform admin sees no rows of ${t}`, (await cnt(db, admin, t)) === 0);
  check("platform admin who is also on the church's team (a viewer role) still sees nothing", (await cnt(db, adminMember, "church_members")) === 0);
  await gate(db, "platform admin cannot INSERT a church record (policy error); the church's owner can", { deny: [admin, adminMember], allow: owner1, stmt: `insert into public.church_members (profile_id, full_name) values ('${prof1}','Admin attempt')`, look: `select count(*) from public.church_members where profile_id = '${prof1}'`, restore: `delete from public.church_members where full_name = 'Admin attempt'`, how: "rls" });
  await gate(db, "platform admin cannot UPDATE a church record (unchanged); the church's owner can", { deny: [admin, adminMember], allow: owner1, stmt: `update public.church_members set full_name = 'Alice Edited' where id = '${MA}'`, look: `select full_name from public.church_members where id = '${MA}'`, restore: `update public.church_members set full_name = 'Alice Adult' where id = '${MA}'`, how: "filtered" });
  await svc(db, temp(53));
  await gate(db, "platform admin cannot DELETE a church record (unchanged); the church's owner can", { deny: [admin, adminMember], allow: owner1, stmt: `delete from public.church_members where id = '${M(53)}'`, look: `select count(*) from public.church_members where id = '${M(53)}'`, restore: temp(53), how: "filtered" });
  await svc(db, `delete from public.church_members where id = '${M(53)}'`);
  await gate(db, "platform admin cannot create a group (policy error); the church's owner can", { deny: [admin], allow: owner1, stmt: `insert into public.church_groups (profile_id, kind, name) values ('${prof1}','group','Admin group')`, look: `select count(*) from public.church_groups where profile_id = '${prof1}'`, restore: `delete from public.church_groups where name = 'Admin group'`, how: "rls" });
  check("a platform admin who OWNS a church keeps owner access to that church only", (await as(db, adminOwner, `insert into public.church_members (profile_id, full_name) values ('${prof3}','Own church person')`)).ok && (await cnt(db, adminOwner, "church_members", `profile_id = '${prof3}'`)) === 1 && rls(await as(db, adminOwner, `insert into public.church_members (profile_id, full_name) values ('${prof1}','x')`)) && (await cnt(db, adminOwner, "church_members", `profile_id = '${prof1}'`)) === 0);
  let r = await as(db, admin, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','adm','Admin made','{church.members.view}')`);
  check("platform admin cannot create a role holding a church permission", denied(r, /church_permission_admin_denied/), JSON.stringify(r));
  r = await as(db, admin, `update public.organization_roles set permissions = '{orders.view,church.groups.view}' where id = '${R_PLAIN}'`);
  check("platform admin cannot add a church permission to an existing role", denied(r, /church_permission_admin_denied/) && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  r = await as(db, admin, `update public.organization_members set role_id = '${R_VIEW}' where user_id = '${staffPlain}' and profile_id = '${prof1}'`);
  check("platform admin cannot move anyone onto a church-permission role", denied(r, /church_permission_admin_denied/) && (await roleOf(db, staffPlain)).role_id === R_PLAIN, JSON.stringify(r));
  r = await as(db, admin, invite(id("7", 1), R_VIEW, admin));
  check("platform admin cannot invite someone to a church-permission role", denied(r, /church_permission_admin_denied/), JSON.stringify(r));
  r = await as(db, admin, `update public.organization_roles set permissions = '{orders.view,orders.update}' where id = '${R_PLAIN}'`);
  check("platform admin can still change NON-church permissions exactly as before (existing behaviour untouched)", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_PLAIN}'`);

  // ---- who sees what (the matrix) ----------------------------------------------------------------------------------------------------------------------------------
  const ADULTS_YOUTH = [MA, ML, MV, MO, MG, MP, MY];
  check("owner: sees all 9 people including both children", same(await ids(db, owner1, "church_members", `profile_id = '${prof1}'`), [...ADULTS_YOUTH, MC1, MC2]));
  check("church admin with members.view: sees adults and youth but NOT the children", same(await ids(db, mgr1, "church_members"), ADULTS_YOUTH));
  check("members.view alone: same, no children", same(await ids(db, viewer1, "church_members"), ADULTS_YOUTH));
  check("children.view (owner-granted): sees the children too", same(await ids(db, kids1, "church_members"), [...ADULTS_YOUTH, MC1, MC2]));
  check("group leader: sees only the people of the group they lead (including the child in it), nobody else", same(await ids(db, leader1, "church_members"), [ML, MV, MP, MC2]));
  check("volunteer: sees only their own record", same(await ids(db, vol1, "church_members"), [MV]));
  check("ordinary linked member: sees only their own record", same(await ids(db, plain1, "church_members"), [MA]));
  check("a signed-in stranger sees nothing", (await cnt(db, stranger, "church_members")) === 0 && (await cnt(db, stranger, "church_groups")) === 0);
  check("groups: owner/admin see both; a leader sees only their group; a volunteer sees their group; a plain member sees none", same(await ids(db, owner1, "church_groups", `profile_id='${prof1}'`), [G1, G2, G4]) && same(await ids(db, mgr1, "church_groups"), [G1, G2, G4]) && same(await ids(db, leader1, "church_groups"), [G1]) && same(await ids(db, vol1, "church_groups"), [G1]) && (await cnt(db, plain1, "church_groups")) === 0);
  check("group roster: a leader sees the whole roster of their group; a volunteer only their own row", same(await ids(db, leader1, "church_group_members"), [GM_L, GM_V, GM_P, GM_C2]) && same(await ids(db, vol1, "church_group_members"), [GM_V]));
  check("a child's group membership is hidden from groups.view holders without children access, visible to the group's leader and to the owner", !(await ids(db, mgr1, "church_group_members")).includes(GM_C2) && (await ids(db, leader1, "church_group_members")).includes(GM_C2) && (await ids(db, owner1, "church_group_members", `profile_id='${prof1}'`)).includes(GM_C2));
  check("leadership: view permission sees titles; a titled person sees their own; others none", (await cnt(db, mgr1, "church_leadership")) === 1 && (await cnt(db, leader1, "church_leadership")) === 1 && (await cnt(db, vol1, "church_leadership")) === 0 && (await cnt(db, viewer1, "church_leadership")) === 0);
  check("a church admin sees the sibling groups but leadership of another church is invisible", (await cnt(db, mgr1, "church_leadership", `profile_id='${prof2}'`)) === 0);

  // ---- writes by role ----------------------------------------------------------------------------------------------------------------------------------------------
  r = await as(db, mgr1, `insert into public.church_members (id, profile_id, full_name) values ('${M(50)}','${prof1}','Added by admin') returning id`);
  check("church admin (members.manage) can add an adult", r.ok && r.rows.length === 1, JSON.stringify(r));
  check("church admin can soft-remove a person, which stamps removed_at", (await as(db, mgr1, `update public.church_members set status = 'removed' where id = '${M(50)}'`)).count === 1 && (await memberOf(db, M(50))).removed_at !== null);
  await gate(db, "church admin cannot hard-delete a person (members.delete not held; unchanged); a holder of members.delete can", { deny: [mgr1], allow: del1, stmt: `delete from public.church_members where id = '${M(50)}'`, look: `select count(*) from public.church_members where id = '${M(50)}'`, restore: `insert into public.church_members (id, profile_id, full_name, status) values ('${M(50)}','${prof1}','Added by admin','removed') on conflict (id) do nothing`, how: "filtered" });
  await gate(db, "church admin cannot add a child (children.manage not held: policy error); a holder of children.manage can", { deny: [mgr1], allow: kidsMgr1, stmt: `insert into public.church_members (profile_id, full_name, age_group, guardian_member_id) values ('${prof1}','Kid Gate','child','${MG}')`, look: `select count(*) from public.church_members where profile_id = '${prof1}'`, restore: `delete from public.church_members where full_name = 'Kid Gate'`, how: "rls" });
  await gate(db, "church admin cannot see or edit an existing child (unchanged); a holder of children.manage can", { deny: [mgr1], allow: kidsMgr1, stmt: `update public.church_members set full_name = 'Child Edited' where id = '${MC1}'`, look: `select full_name from public.church_members where id = '${MC1}'`, restore: `update public.church_members set full_name = 'Child One' where id = '${MC1}'`, how: "filtered" });
  await gate(db, "church admin cannot delete an existing child (unchanged); the owner can", { deny: [mgr1], allow: owner1, stmt: `delete from public.church_members where id = '${MC1}'`, look: `select count(*) from public.church_members where id = '${MC1}'`, restore: `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${MC1}','${prof1}','Child One','child','${MG}') on conflict (id) do nothing`, how: "filtered" });
  check("nobody with an end-user identity can create a record marked as a join request, the owner included (reserved for a later server route); the service role can", rls(await as(db, mgr1, `insert into public.church_members (profile_id, full_name, source) values ('${prof1}','JR1','join_request')`)) && rls(await as(db, owner1, `insert into public.church_members (profile_id, full_name, source) values ('${prof1}','JR2','join_request')`)) && (await svcErr(db, `insert into public.church_members (profile_id, full_name, source) values ('${prof1}','JR3','join_request')`)) === null);
  await svc(db, `delete from public.church_members where full_name = 'JR3'`);
  await gate(db, "members.view alone cannot insert (policy error); a holder of members.manage can", { deny: [viewer1], allow: mgr1, stmt: `insert into public.church_members (profile_id, full_name) values ('${prof1}','Viewer attempt')`, look: `select count(*) from public.church_members where profile_id = '${prof1}'`, restore: `delete from public.church_members where full_name = 'Viewer attempt'`, how: "rls" });
  await gate(db, "members.view alone cannot update (unchanged); a holder of members.manage can", { deny: [viewer1], allow: mgr1, stmt: `update public.church_members set full_name = 'Alice Edited' where id = '${MA}'`, look: `select full_name from public.church_members where id = '${MA}'`, restore: `update public.church_members set full_name = 'Alice Adult' where id = '${MA}'`, how: "filtered" });
  await gate(db, "children.view alone cannot add a child (policy error); children.manage can", { deny: [kids1], allow: kidsMgr1, stmt: `insert into public.church_members (profile_id, full_name, age_group, guardian_member_id) values ('${prof1}','Kid Gate 2','child','${MG}')`, look: `select count(*) from public.church_members where profile_id = '${prof1}'`, restore: `delete from public.church_members where full_name = 'Kid Gate 2'`, how: "rls" });
  await gate(db, "children.view alone cannot edit a child (unchanged); children.manage can", { deny: [kids1], allow: kidsMgr1, stmt: `update public.church_members set full_name = 'Child Edited' where id = '${MC1}'`, look: `select full_name from public.church_members where id = '${MC1}'`, restore: `update public.church_members set full_name = 'Child One' where id = '${MC1}'`, how: "filtered" });
  r = await as(db, kidsMgr1, `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${M(51)}','${prof1}','Kid Three','child','${MG}') returning id`);
  check("children.manage can add a child with a guardian", r.ok && r.rows.length === 1, JSON.stringify(r));
  r = await as(db, kidsMgr1, `insert into public.church_members (profile_id, full_name, age_group) values ('${prof1}','Orphan','child')`);
  check("…but not a child without a guardian (constraint)", !r.ok && r.code === "23514" && /child_guardian_check/.test(r.msg), JSON.stringify(r));
  await svc(db, `insert into public.church_members (id, profile_id, full_name) values ('${M(52)}','${prof1}','Temp adult')`);
  check("members.delete (with view) can hard-delete an adult", (await as(db, del1, `delete from public.church_members where id = '${M(52)}'`)).count === 1);
  await gate(db, "members.delete cannot hard-delete a child it cannot even see (unchanged); the owner can", { deny: [del1], allow: owner1, stmt: `delete from public.church_members where id = '${MC1}'`, look: `select count(*) from public.church_members where id = '${MC1}'`, restore: `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${MC1}','${prof1}','Child One','child','${MG}') on conflict (id) do nothing`, how: "filtered" });
  r = await as(db, del1, `delete from public.church_members where id = '${MG}'`);
  check("a guardian with dependents cannot be hard-deleted, even by someone allowed to", !r.ok && r.code === "23503", JSON.stringify(r));
  await gate(db, "an ordinary member cannot edit their own record (unchanged); a church admin can", { deny: [plain1], allow: mgr1, stmt: `update public.church_members set full_name = 'Alice Edited' where id = '${MA}'`, look: `select full_name from public.church_members where id = '${MA}'`, restore: `update public.church_members set full_name = 'Alice Adult' where id = '${MA}'`, how: "filtered" });
  await gate(db, "an ordinary member cannot delete their own record (unchanged); the owner can", { deny: [plain1], allow: owner1, stmt: `delete from public.church_members where id = '${MA}'`, look: `select count(*) from public.church_members where id = '${MA}'`, restore: `insert into public.church_members (id, profile_id, full_name, user_id) values ('${MA}','${prof1}','Alice Adult','${plain1}') on conflict (id) do nothing`, how: "filtered" });
  await gate(db, "a stranger cannot self-register into a church (policy error); a church admin can add a person", { deny: [stranger], allow: mgr1, stmt: `insert into public.church_members (profile_id, full_name) values ('${prof1}','Self registered')`, look: `select count(*) from public.church_members where profile_id = '${prof1}'`, restore: `delete from public.church_members where full_name = 'Self registered'`, how: "rls" });
  // group leader powers
  check("group leader can change a volunteer to a worker", (await as(db, leader1, `update public.church_group_members set role = 'worker' where id = '${GM_V}'`)).count === 1);
  r = await as(db, leader1, `update public.church_group_members set role = 'leader' where id = '${GM_V}'`);
  check("group leader cannot promote anyone to leader (exact reason: church_leader_assignment_denied) and the role is unchanged", reason(r, /church_leader_assignment_denied/) && (await db.query(`select role from public.church_group_members where id = '${GM_V}'`)).rows[0].role === "worker", JSON.stringify(r));
  await gate(db, "group leader cannot demote the leading row (unchanged); a groups.manage holder can", { deny: [leader1], allow: mgr1, stmt: `update public.church_group_members set role = 'member' where id = '${GM_L}'`, look: `select role from public.church_group_members where id = '${GM_L}'`, restore: `update public.church_group_members set role = 'leader' where id = '${GM_L}'`, how: "filtered" });
  await gate(db, "group leader cannot remove the leading row (unchanged); a groups.manage holder can", { deny: [leader1], allow: mgr1, stmt: `delete from public.church_group_members where id = '${GM_L}'`, look: `select count(*) from public.church_group_members where id = '${GM_L}'`, restore: `insert into public.church_group_members (id, profile_id, group_id, member_id, role) values ('${GM_L}','${prof1}','${G1}','${ML}','leader') on conflict (id) do nothing`, how: "filtered" });
  await gate(db, "group leader cannot add people to the group (policy error); a groups.manage holder can", { deny: [leader1], allow: mgr1, stmt: `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G1}','${MO}')`, look: `select count(*) from public.church_group_members where group_id = '${G1}'`, restore: `delete from public.church_group_members where group_id = '${G1}' and member_id = '${MO}'`, how: "rls" });
  r = await as(db, leader1, `update public.church_group_members set group_id = '${G2}' where id = '${GM_V}'`);
  check("a membership cannot be moved to another group, by a leader or anyone (exact reason; unchanged)", reason(r, /church_membership_link_immutable/) && (await db.query(`select group_id from public.church_group_members where id = '${GM_V}'`)).rows[0].group_id === G1, JSON.stringify(r));
  await gate(db, "group leader cannot rename the group (unchanged); a groups.manage holder can", { deny: [leader1], allow: mgr1, stmt: `update public.church_groups set name = 'Renamed' where id = '${G1}'`, look: `select name from public.church_groups where id = '${G1}'`, restore: `update public.church_groups set name = 'Choir' where id = '${G1}'`, how: "filtered" });
  await gate(db, "group leader cannot retitle a leadership record (unchanged); the owner can", { deny: [leader1], allow: owner1, stmt: `update public.church_leadership set title = 'Bishop' where id = '${LD1}'`, look: `select title from public.church_leadership where id = '${LD1}'`, restore: `update public.church_leadership set title = 'Elder' where id = '${LD1}'`, how: "filtered" });
  await gate(db, "group leader cannot edit the people themselves (unchanged); a members.manage holder can", { deny: [leader1], allow: mgr1, stmt: `update public.church_members set full_name = 'Pat Edited' where id = '${MP}'`, look: `select full_name from public.church_members where id = '${MP}'`, restore: `update public.church_members set full_name = 'Pat Plain' where id = '${MP}'`, how: "filtered" });
  check("group leader can remove a plain member from their group", (await as(db, leader1, `delete from public.church_group_members where id = '${GM_P}'`)).count === 1);
  await gate(db, "a volunteer cannot change a membership (unchanged); a groups.manage holder can", { deny: [vol1], allow: mgr1, stmt: `update public.church_group_members set role = 'volunteer' where id = '${GM_V}'`, look: `select role from public.church_group_members where id = '${GM_V}'`, restore: `update public.church_group_members set role = 'worker' where id = '${GM_V}'`, how: "filtered" });
  check("group admins (groups.manage) can add people to a group, and assign a leader", (await as(db, mgr1, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MP}','assistant')`)).ok);
  await gate(db, "groups.manage cannot add a child to a group without children.manage (policy error); with children.manage it can", { deny: [mgr1], allow: kg, stmt: `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G2}','${MC1}')`, look: `select count(*) from public.church_group_members where group_id = '${G2}'`, restore: `delete from public.church_group_members where group_id = '${G2}' and member_id = '${MC1}'`, how: "rls" });
  await gate(db, "leadership.manage is required to write titles: view-only cannot (policy error), the owner can", { deny: [mgr1], allow: owner1, stmt: `insert into public.church_leadership (profile_id, member_id, title) values ('${prof1}','${MG}','Treasurer')`, look: `select count(*) from public.church_leadership where profile_id = '${prof1}'`, restore: `delete from public.church_leadership where title = 'Treasurer'`, how: "rls" });
  // a leader whose own record is no longer active loses the powers at once
  await svc(db, `update public.church_members set status = 'inactive' where id = '${ML}'`);
  check("a leader whose record becomes inactive loses leader access immediately (sees only their own row, no group, no roster)", same(await ids(db, leader1, "church_group_members"), [GM_L]) && (await cnt(db, leader1, "church_groups")) === 0 && same(await ids(db, leader1, "church_members"), [ML]) && zero(await as(db, leader1, `update public.church_group_members set role = 'worker' where id = '${GM_V}'`)));
  await svc(db, `update public.church_members set status = 'active' where id = '${ML}'`);
  check("…and gets it back when reactivated", (await cnt(db, leader1, "church_groups")) === 1);
  await svc(db, `update public.church_members set status = 'removed' where id = '${MA}'`);
  check("a removed person no longer sees their own record", (await cnt(db, plain1, "church_members")) === 0);
  await svc(db, `update public.church_members set status = 'active' where id = '${MA}'`);

  // ---- F1 / F6: the two guards that stop a church admin reaching children through leader powers. Exact reasons, unchanged state, and controls proving the legitimate path still works.
  const LEAD = /church_leader_assignment_denied/, LINK = /church_leader_link_denied/;
  const leaderUser = async () => (await db.query(`select user_id from public.church_members where id = '${ML}'`)).rows[0].user_id;
  const gmRows = async (gid, mid) => (await db.query(`select role from public.church_group_members where group_id = '${gid}' and member_id = '${mid}'`)).rows;
  r = await as(db, mgr1, `update public.church_members set user_id = '${mgr1}' where id = '${ML}'`);
  check("attack 1: a church admin (members.manage + groups.manage, no children rights) cannot re-point a group leader's account to their own (church_leader_link_denied)", reason(r, LINK) && (await leaderUser()) === leader1, JSON.stringify(r));
  check("…so they still cannot see the child in that leader's group", (await cnt(db, mgr1, "church_members", `id = '${MC2}'`)) === 0);
  r = await as(db, mgr1, `update public.church_members set user_id = null where id = '${ML}'`);
  check("…nor detach the leader's account", reason(r, LINK) && (await leaderUser()) === leader1, JSON.stringify(r));
  r = await as(db, kg, `update public.church_members set user_id = '${kg}' where id = '${ML}'`);
  check("control: a holder of children.manage CAN re-point it (the legitimate path works)", r.ok && r.count === 1 && (await leaderUser()) === kg, JSON.stringify(r));
  await svc(db, `update public.church_members set user_id = '${leader1}' where id = '${ML}'`);
  for (const role of ["leader", "assistant"]) {
    r = await as(db, mgr1, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G1}','${MO}','${role}')`);
    check(`attack 2: a church admin cannot appoint a ${role} of a group that contains a child (church_leader_assignment_denied, 'contains children')`, reason(r, LEAD) && /contains children|needs church\.children\.manage/.test(r.detail) && (await gmRows(G1, MO)).length === 0, JSON.stringify(r));
  }
  r = await as(db, mgr1, `update public.church_group_members set role = 'leader' where id = '${GM_V}'`);
  check("attack 2 (by promotion): a church admin cannot promote an existing volunteer to leader of that group", reason(r, LEAD) && (await db.query(`select role from public.church_group_members where id = '${GM_V}'`)).rows[0].role === "worker", JSON.stringify(r));
  check("…and still cannot see the child in that group", (await cnt(db, mgr1, "church_members", `id = '${MC2}'`)) === 0);
  r = await as(db, kg, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G1}','${MO}','assistant')`);
  check("control: a holder of children.manage + groups.manage CAN appoint an assistant of that group", r.ok && r.count === 1 && (await gmRows(G1, MO))[0].role === "assistant", JSON.stringify(r));
  r = await as(db, owner1, `update public.church_group_members set role = 'leader' where group_id = '${G1}' and member_id = '${MO}'`);
  check("control: the owner can promote them to leader", r.ok && r.count === 1 && (await gmRows(G1, MO))[0].role === "leader", JSON.stringify(r));
  await svc(db, `delete from public.church_group_members where group_id = '${G1}' and member_id = '${MO}'`);
  r = await as(db, mgr1, `update public.church_members set user_id = '${mgr1}' where id = '${MO}'`);
  check("a church admin MAY link their own account to an ordinary (non-leading) record — the first half of the self-appointment attack is not blocked on its own", r.ok && r.count === 1, JSON.stringify(r));
  r = await as(db, mgr1, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G4}','${MO}','leader')`);
  check("attack 2b: …but cannot then appoint that record leader of ANY group, even a child-free one (church_leader_assignment_denied, 'not assigning themselves')", reason(r, LEAD) && /not assigning themselves/.test(r.detail) && (await gmRows(G4, MO)).length === 0, JSON.stringify(r));
  r = await as(db, mgr1, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G4}','${MP}','leader')`);
  check("control: appointing SOMEONE ELSE leader of a child-free group is allowed for that church admin", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `delete from public.church_group_members where group_id = '${G4}'; update public.church_members set user_id = null where id = '${MO}'`);
  r = await as(db, owner1, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G4}','${MO}','leader')`);
  check("control: the owner can appoint a leader of a child-free group", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `delete from public.church_group_members where group_id = '${G4}'`);

  // ---- F2: no function discloses another person's age group; is_child is derived and cannot be tampered with
  const callable = (await db.query(`select proname from pg_proc p where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname = 'is_church_profile') and has_function_privilege('authenticated', p.oid, 'execute')`)).rows.map((x) => x.proname).sort();
  check("the only church functions a signed-in API user can call are the seven caller-relative policy helpers", JSON.stringify(callable) === JSON.stringify(["church_has_permission", "church_is_group_leader", "church_is_group_member", "church_is_owner", "church_member_in_led_group", "church_member_is_me", "is_church_profile"].sort()), callable.join());
  r = await as(db, stranger, `select public.church_member_age_group('${MC1}') as a`);
  const ra = await asRole(db, "anon", "", `select public.church_member_age_group('${MC1}') as a`);
  check("church_member_age_group no longer exists: calling it fails as an undefined function for a signed-in user and for anon", !r.ok && r.code === "42883" && !ra.ok && ra.code === "42883", JSON.stringify([r, ra]));
  const RND = id("8", 99);
  const oracle = async (fn, real, args = "") => JSON.stringify([(await as(db, stranger, `select public.${fn}('${real}'${args}) as a`)).rows, (await as(db, stranger, `select public.${fn}('${RND}'${args}) as a`)).rows]);
  const answers = [await oracle("church_is_owner", prof1), await oracle("church_has_permission", prof1, ", 'church.children.view'"), await oracle("church_is_group_leader", G1), await oracle("church_is_group_member", G1),
    await oracle("church_member_in_led_group", MC2), await oracle("church_member_is_me", MC2)];
  check("for a signed-in stranger every caller-relative helper answers identically for a real child's / group's / church's id and for a random id (no oracle)", answers.every((a) => { const [x, y] = JSON.parse(a); return JSON.stringify(x) === JSON.stringify(y) && x[0].a === false; }), answers.join(" "));
  await svc(db, `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${M(10)}','${prof1}','Child Three','child','${MG}')`);
  const MC3 = M(10);
  const isChild = async (mid, gid) => (await db.query(`select is_child from public.church_group_members where member_id = '${mid}' and group_id = '${gid}'`)).rows[0]?.is_child;
  r = await as(db, kg, `insert into public.church_group_members (profile_id, group_id, member_id, role, is_child) values ('${prof1}','${G2}','${MC3}','member', false) returning is_child`);
  check("is_child cannot be set by the caller: a child's membership inserted with is_child = false is stored as true", r.ok && r.rows[0].is_child === true && (await isChild(MC3, G2)) === true, JSON.stringify(r));
  r = await as(db, kg, `update public.church_group_members set is_child = false where member_id = '${MC3}' and group_id = '${G2}'`);
  check("…an update cannot clear it", r.ok && (await isChild(MC3, G2)) === true, JSON.stringify(r));
  await svc(db, `update public.church_group_members set is_child = false where member_id = '${MC3}' and group_id = '${G2}'`);
  check("…and neither can the service role (the trigger recomputes it on every write)", (await isChild(MC3, G2)) === true);
  r = await as(db, mgr1, `insert into public.church_group_members (profile_id, group_id, member_id, role, is_child) values ('${prof1}','${G2}','${MA}','member', true) returning is_child`);
  check("an adult's membership inserted with is_child = true is stored as false (the flag follows the person, not the caller)", r.ok && r.rows[0].is_child === false, JSON.stringify(r));
  await svc(db, `delete from public.church_group_members where group_id = '${G2}' and member_id = '${MA}'`);
  const childRow = `group_id = '${G2}' and member_id = '${MC3}'`;
  check("a child's membership is hidden from a groups.view holder without children access, and visible to one with it", (await ids(db, mgr1, "church_group_members", childRow)).length === 0 && (await ids(db, kg, "church_group_members", childRow)).length === 1);
  await svc(db, `update public.church_members set age_group = 'youth' where id = '${MC3}'`);
  check("when the person is reclassified as a youth the membership's is_child follows (false) and the row becomes visible to the groups.view holder", (await isChild(MC3, G2)) === false && (await ids(db, mgr1, "church_group_members", childRow)).length === 1);
  await svc(db, `update public.church_members set age_group = 'child' where id = '${MC3}'`);
  check("…and back to a child: true again and hidden again", (await isChild(MC3, G2)) === true && (await ids(db, mgr1, "church_group_members", childRow)).length === 0);
  check("consistency: no membership disagrees with its person's age group", (await db.query(`select count(*)::int as n from public.church_group_members gm join public.church_members m on m.id = gm.member_id and m.profile_id = gm.profile_id where gm.is_child is distinct from (m.age_group = 'child')`)).rows[0].n === 0);

  // ---- F3: nobody without children.manage can change, declassify or reclassify a child record (allowed and denied transitions)
  check("setup: the children.view + members.manage user can see the child", (await cnt(db, kvm, "church_members", `id = '${MC1}'`)) === 1);
  const childLook = `select age_group, guardian_member_id, full_name from public.church_members where id = '${MC1}'`;
  const toChild = `update public.church_members set age_group = 'child', guardian_member_id = '${MG}' where id = '${MC1}'`;
  await gate(db, "F3 denied: children.view + members.manage cannot turn a child into an ADULT (unchanged); children.manage can", { deny: [kvm], allow: kidsMgr1, stmt: `update public.church_members set age_group = 'adult', guardian_member_id = null where id = '${MC1}'`, look: childLook, restore: toChild, how: "filtered" });
  await gate(db, "F3 denied: …nor into a YOUTH record; children.manage can", { deny: [kvm], allow: kidsMgr1, stmt: `update public.church_members set age_group = 'youth' where id = '${MC1}'`, look: childLook, restore: toChild, how: "filtered" });
  await gate(db, "F3 denied: …nor rename the child, nor change its language; children.manage can", { deny: [kvm], allow: kidsMgr1, stmt: `update public.church_members set full_name = 'Renamed Child', preferred_language = 'fr' where id = '${MC1}'`, look: `select full_name, preferred_language from public.church_members where id = '${MC1}'`, restore: `update public.church_members set full_name = 'Child One', preferred_language = null where id = '${MC1}'`, how: "filtered" });
  await gate(db, "F3 denied: …nor re-point the child to another guardian; children.manage can", { deny: [kvm], allow: kidsMgr1, stmt: `update public.church_members set guardian_member_id = '${MO}' where id = '${MC1}'`, look: childLook, restore: toChild, how: "filtered" });
  await gate(db, "F3 denied: an adult cannot be turned INTO a child record without children.manage (policy error); children.manage can", { deny: [kvm], allow: kidsMgr1, stmt: `update public.church_members set age_group = 'child', guardian_member_id = '${MG}' where id = '${MO}'`, look: `select age_group, guardian_member_id from public.church_members where id = '${MO}'`, restore: `update public.church_members set age_group = 'adult', guardian_member_id = null where id = '${MO}'`, how: "rls" });
  await gate(db, "F3 denied: children.view + groups.manage cannot remove a child from a group (unchanged); children.manage can", { deny: [kgv], allow: kg, stmt: `delete from public.church_group_members where member_id = '${MC3}' and group_id = '${G2}'`, look: `select count(*) from public.church_group_members where member_id = '${MC3}' and group_id = '${G2}'`, restore: `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G2}','${MC3}') on conflict do nothing`, how: "filtered" });
  await gate(db, "F3 denied: children.view + groups.manage cannot add a child to a group (policy error); children.manage can", { deny: [kgv], allow: kg, stmt: `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G2}','${MC1}')`, look: `select count(*) from public.church_group_members where group_id = '${G2}'`, restore: `delete from public.church_group_members where group_id = '${G2}' and member_id = '${MC1}'`, how: "rls" });
  check("F3 allowed transitions end where they started (child -> youth -> child -> adult -> child, by children.manage)", (await snap(db, childLook)) === JSON.stringify([{ age_group: "child", guardian_member_id: MG, full_name: "Child One" }]));

  // ---- F5: table privileges (catalog-level and executed)
  await db.exec(`create table public.zz_privilege_control (id int)`);
  const tp = async (role, tbl, priv) => (await db.query(`select has_table_privilege('${role}', 'public.${tbl}', '${priv}') as p`)).rows[0].p;
  check("negative control: a table created under the harness's Supabase-style default privileges DOES give authenticated TRUNCATE, REFERENCES and TRIGGER (so the revoke is what protects the church tables)", (await tp("authenticated", "zz_privilege_control", "truncate")) && (await tp("authenticated", "zz_privilege_control", "references")) && (await tp("authenticated", "zz_privilege_control", "trigger")));
  const TABLES = ["church_members", "church_groups", "church_group_members", "church_leadership"];
  let privOk = true, privWhy = "";
  for (const t of TABLES) {
    for (const role of ["authenticated", "anon"]) for (const priv of ["truncate", "references", "trigger"]) if (await tp(role, t, priv)) { privOk = false; privWhy += ` ${role}:${t}:${priv}`; }
    for (const priv of ["select", "insert", "update", "delete"]) { if (!(await tp("authenticated", t, priv))) { privOk = false; privWhy += ` authenticated lacks ${priv} on ${t}`; } if (await tp("anon", t, priv)) { privOk = false; privWhy += ` anon has ${priv} on ${t}`; } }
  }
  check("catalog: authenticated holds exactly SELECT / INSERT / UPDATE / DELETE on the four tables (no TRUNCATE, REFERENCES, TRIGGER); anon holds nothing", privOk, privWhy);
  let execOk = true, execWhy = "";
  for (const t of TABLES) for (const [role, who] of [["authenticated", owner1], ["anon", ""]]) {
    const x = await asRole(db, role, who, `truncate public.${t}`);
    if (!(reason(x, /permission denied for table/))) { execOk = false; execWhy += ` ${role}:${t}=${JSON.stringify(x)}`; }
  }
  check("executed: TRUNCATE is refused for authenticated (even the church owner) and anon on every table, with 'permission denied for table'", execOk, execWhy);
  const rowsAfter = (await db.query(`select count(*)::int as n from public.church_members`)).rows[0].n;
  check("…and the rows are still there", rowsAfter > 0);
  const trg = await asRole(db, "authenticated", owner1, `create trigger zz_x before insert on public.church_leadership for each row execute function public.church_leadership_guard()`);
  const rlsOff = await asRole(db, "authenticated", owner1, `alter table public.church_members disable row level security`);
  check("executed: authenticated cannot create a trigger on, or switch off row-level security of, a church table", !trg.ok && !rlsOff.ok && (await db.query(`select relrowsecurity from pg_class where oid = 'public.church_members'::regclass`)).rows[0].relrowsecurity === true, JSON.stringify([trg.code, rlsOff.code]));

  // ---- group deletion: a group that holds a child can only be deleted with children.manage (church_groups_delete_guard)
  const GD = G(90);
  const mkGroup = `insert into public.church_groups (id, profile_id, kind, name) values ('${GD}','${prof1}','group','Temp kids') on conflict (id) do nothing; insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${GD}','${MC3}') on conflict do nothing; insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${GD}','${MP}') on conflict do nothing`;
  await svc(db, mkGroup);
  const gdLook = `select (select count(*) from public.church_groups where id = '${GD}') g, (select count(*) from public.church_group_members where group_id = '${GD}') gm`;
  await gate(db, "group deletion: groups.manage (and children.view) cannot delete a group that holds a child (church_group_has_children; group and memberships unchanged); children.manage can", { deny: [mgr1, kgv], allow: kg, stmt: `delete from public.church_groups where id = '${GD}'`, look: gdLook, restore: mkGroup, how: /church_group_has_children/ });
  await gate(db, "group deletion: …and the owner can", { deny: [mgr1], allow: owner1, stmt: `delete from public.church_groups where id = '${GD}'`, look: gdLook, restore: mkGroup, how: /church_group_has_children/ });
  check("group deletion: the child's own record and the guardian link survive a permitted deletion", (await memberOf(db, MC3)).guardian_member_id === MG);
  const e8 = await svcErr(db, `delete from public.church_groups where id = '${GD}'`);
  check("group deletion: no end-user identity (the service role) is not restricted, so account / profile cascades run as before", e8 === null && (await svc(db, `select count(*)::int n from public.church_group_members where group_id = '${GD}'`)).rows[0].n === 0, JSON.stringify(e8));
  await svc(db, `insert into public.church_groups (id, profile_id, kind, name) values ('${GD}','${prof1}','group','Temp adults'); insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${GD}','${MP}')`);
  await gate(db, "group deletion: a group WITHOUT a child stays deletable by groups.manage alone (a leader still cannot)", { deny: [leader1], allow: mgr1, stmt: `delete from public.church_groups where id = '${GD}'`, look: gdLook, restore: `insert into public.church_groups (id, profile_id, kind, name) values ('${GD}','${prof1}','group','Temp adults') on conflict (id) do nothing`, how: "filtered" });
  await svc(db, `delete from public.church_groups where id = '${GD}'`);
  // cascades started by a client: the owner's own profile deletion works; a non-owner / platform-admin SESSION is refused while a child sits in a group; the service role is not
  const P5 = P(50), P6 = P(51), P7 = P(52);
  const mkChurch = (pid, uid, tag, k) => `insert into public.profiles (id, user_id, category) values ('${pid}','${uid}','church_ministries') on conflict (id) do nothing;
    insert into public.church_members (id, profile_id, full_name) values ('${M(80 + 2 * k)}','${pid}','Guardian ${tag}');
    insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${M(81 + 2 * k)}','${pid}','Child ${tag}','child','${M(80 + 2 * k)}');
    insert into public.church_groups (id, profile_id, kind, name) values ('${G(80 + k)}','${pid}','group','Kids ${tag}');
    insert into public.church_group_members (profile_id, group_id, member_id) values ('${pid}','${G(80 + k)}','${M(81 + 2 * k)}')`;
  const left = async (pid) => (await svc(db, `select (select count(*) from public.church_groups where profile_id='${pid}')::int g, (select count(*) from public.church_members where profile_id='${pid}')::int m, (select count(*) from public.profiles where id='${pid}')::int p`)).rows[0];
  await svc(db, mkChurch(P5, owner5, "five", 1));
  r = await as(db, owner5, `delete from public.profiles where id = '${P5}'`);
  check("group deletion: the OWNER deleting their own church profile (with a child in a group) cascades normally — the guard must not block a legitimate cascade", r.ok && r.count === 1 && JSON.stringify(await left(P5)) === JSON.stringify({ g: 0, m: 0, p: 0 }), JSON.stringify(r));
  await svc(db, mkChurch(P6, owner6, "six", 2));
  r = await as(db, stranger, `delete from public.profiles where id = '${P6}'`);
  check("group deletion: a stranger cannot delete a church profile at all (the profile's own delete policy; unchanged) and nothing is lost", zero(r) && JSON.stringify(await left(P6)) === JSON.stringify({ g: 1, m: 2, p: 1 }), JSON.stringify(r));
  r = await as(db, owner6, `delete from public.church_groups where id = '${G(82)}'`);
  check("group deletion: even the owner's STAND-ALONE delete of a group that holds a child works (the owner holds children.manage)", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `insert into public.church_groups (id, profile_id, kind, name) values ('${G(82)}','${P6}','group','Kids six'); insert into public.church_group_members (profile_id, group_id, member_id) values ('${P6}','${G(82)}','${M(85)}')`);
  await svc(db, mkChurch(P7, owner7, "seven", 3));
  r = await as(db, admin, `delete from public.profiles where id = '${P7}'`);
  check("group deletion (documented, unchanged platform power): a platform-admin SESSION can delete a church profile through the profile's own delete policy; this migration does not add or remove that", r.ok && r.count === 1 && JSON.stringify(await left(P7)) === JSON.stringify({ g: 0, m: 0, p: 0 }), JSON.stringify(r));
  await svc(db, `delete from public.users where id = '${owner6}'`);
  check("group deletion: deleting the owner's account through the service role cascades the whole roster, as documented", JSON.stringify(await left(P6)) === JSON.stringify({ g: 0, m: 0, p: 0 }));

  // ---- hard-deleting a child's record: exactly which permissions it takes (evidence for the retention document)
  const restoreMC1 = `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${MC1}','${prof1}','Child One','child','${MG}') on conflict (id) do nothing`;
  await gate(db, "hard-deleting a child's record needs members.delete AND children.manage AND being able to see the child (children.view): members.delete alone, children.manage without members.delete, and children.manage without children.view are all refused; the holder of all three can", { deny: [del1, kidsMgr1, kdn], allow: kd, stmt: `delete from public.church_members where id = '${MC1}'`, look: `select count(*) from public.church_members where id = '${MC1}'`, restore: restoreMC1, how: "filtered" });

  // ---- owner-only sensitive permissions ----------------------------------------------------------------------------------------------------------------------------
  const OWN = /church_permission_owner_only/;
  r = await as(db, mgrKids, `update public.organization_roles set permissions = '{orders.view,church.children.view}' where id = '${R_PLAIN}'`);
  check("a manager who HOLDS children.view still cannot grant it (owner-only)", denied(r, OWN) && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  r = await as(db, mgrKids, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','sneak','Sneak','{church.children.view}')`);
  check("…nor create a role holding it", denied(r, OWN), JSON.stringify(r));
  r = await as(db, mgrKids, `update public.organization_members set role_id = '${R_KIDS}' where user_id = '${staffPlain}' and profile_id = '${prof1}'`);
  check("…nor move someone onto a role that holds it", denied(r, OWN) && (await roleOf(db, staffPlain)).role_id === R_PLAIN, JSON.stringify(r));
  r = await as(db, mgrKids, invite(id("7", 2), R_KIDS, mgrKids));
  check("…nor invite someone to a role that holds it", denied(r, OWN), JSON.stringify(r));
  for (const [what, perm] of [["children.manage", "church.children.manage"], ["members.delete", "church.members.delete"], ["export (reserved)", "church.export"], ["an unknown church.* string", "church.anything.new"], ["a case variant", "Church.Children.View"], ["a padded variant", " church.children.view "]]) {
    r = await as(db, mgr1, `update public.organization_roles set permissions = array['orders.view','${perm}'] where id = '${R_PLAIN}'`);
    check(`a church admin cannot grant ${what}`, denied(r, ceiling ? /church_permission_owner_only|team_permission_ceiling/ : OWN) && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  }
  r = await as(db, mgr1, `update public.organization_members set role_id = '${R_KIDS}' where user_id = '${staffPlain}' and profile_id = '${prof1}'`);
  check("a church admin cannot move a member onto the children-viewer role", denied(r, ceiling ? /church_permission_owner_only|team_permission_ceiling/ : OWN) && (await roleOf(db, staffPlain)).role_id === R_PLAIN, JSON.stringify(r));
  await svc(db, `update public.organization_members set status = 'inactive' where user_id = '${kids1}' and profile_id = '${prof1}'`);
  r = await as(db, mgr1, `update public.organization_members set status = 'active' where user_id = '${kids1}' and profile_id = '${prof1}'`);
  check("a church admin cannot reactivate a member whose role holds children access", denied(r, ceiling ? /church_permission_owner_only|team_permission_ceiling/ : OWN) && (await roleOf(db, kids1)).status === "inactive", JSON.stringify(r));
  r = await as(db, owner1, `update public.organization_members set status = 'active' where user_id = '${kids1}' and profile_id = '${prof1}'`);
  check("the owner can reactivate it", r.ok && r.count === 1 && (await roleOf(db, kids1)).status === "active", JSON.stringify(r));
  r = await as(db, mgr1, invite(id("7", 3), R_KIDS, mgr1));
  check("a church admin cannot invite to the children-viewer role", denied(r, ceiling ? /church_permission_owner_only|team_permission_ceiling/ : OWN), JSON.stringify(r));
  r = await as(db, owner1, invite(id("7", 4), R_KIDS, owner1));
  check("the owner can create that invitation", r.ok, JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_invitations set expires_at = now() + interval '30 days' where id = '${id("7", 4)}'`);
  check("a church admin cannot modify it", denied(r), JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_invitations set status = 'revoked' where id = '${id("7", 4)}'`);
  check("a church admin CAN still revoke it (taking access away)", r.ok && r.count === 1, JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_members set status = 'inactive' where user_id = '${kids1}' and profile_id = '${prof1}'`);
  check("a church admin CAN still deactivate a children-viewer (taking access away)", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `update public.organization_members set status = 'active' where user_id = '${kids1}' and profile_id = '${prof1}'`);
  r = await as(db, owner1, `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${R(40)}','${prof1}','ownermade','Owner made','{church.children.view,church.children.manage,church.members.delete,church.export}')`);
  check("the owner can create a role with every sensitive permission", r.ok, JSON.stringify(r));
  r = await as(db, owner1, `update public.organization_roles set permissions = '{church.children.view}' where id = '${R(40)}'`);
  check("…change it, and assign it", r.ok && (await as(db, owner1, `update public.organization_members set role_id = '${R(40)}' where user_id = '${staffPlain}' and profile_id = '${prof1}'`)).count === 1);
  await svc(db, `update public.organization_members set role_id = '${R_PLAIN}' where user_id = '${staffPlain}' and profile_id = '${prof1}'`);
  check("a platform admin who owns a church can grant sensitive permissions in THEIR church (owner status, not admin status)", (await as(db, adminOwner, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof3}','k','K','{church.children.view}')`)).ok);
  await gate(db, "the owner of ANOTHER church cannot touch church 1's roles (unchanged); church 1's owner can", { deny: [owner2], allow: owner1, stmt: `update public.organization_roles set name = 'Renamed role' where id = '${R_PLAIN}'`, look: `select name from public.organization_roles where id = '${R_PLAIN}'`, restore: `update public.organization_roles set name = 'Plain' where id = '${R_PLAIN}'`, how: "filtered" });
  r = await svcErr(db, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','svcmade','Service made','{church.children.view}')`);
  check("the service role (e.g. the invitation-accept route) is not affected by the guard", r === null, JSON.stringify(r));

  // ---- escalation of ordinary church permissions (the ceiling) ------------------------------------------------------------------------------------------------------
  const CEIL = ceiling ? /church_permission_ceiling|team_permission_ceiling/ : /church_permission_ceiling/;
  r = await as(db, mgr1, `update public.organization_roles set permissions = '{orders.view,church.leadership.manage}' where id = '${R_PLAIN}'`);
  check("a church admin cannot grant an ordinary church permission they do not hold (leadership.manage)", denied(r, CEIL) && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_members set role_id = '${R_LEADMGR}' where user_id = '${mgr1}' and profile_id = '${prof1}'`);
  check("a church admin cannot move THEMSELVES onto a stronger church role", denied(r, CEIL) && (await roleOf(db, mgr1)).role_id === R_MGR, JSON.stringify(r));
  r = await as(db, mgr1, invite(id("7", 5), R_LEADMGR, mgr1));
  check("…nor invite someone to a stronger church role", denied(r, CEIL), JSON.stringify(r));
  r = await as(db, mgrNoChurch, `update public.organization_roles set permissions = '{orders.view,church.members.view}' where id = '${R_PLAIN}'`);
  check("a team manager with NO church permission cannot hand out even members.view", denied(r, CEIL) && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_roles set permissions = '{orders.view,church.members.view}' where id = '${R_PLAIN}'`);
  check("a church admin CAN hand out a church permission they hold (delegation works)", r.ok && r.count === 1 && (await perms(db, R_PLAIN)) === "orders.view,church.members.view", JSON.stringify(r));
  r = await as(db, mgr1, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_PLAIN}'`);
  check("…and take it away again", r.ok && (await perms(db, R_PLAIN)) === "orders.view", JSON.stringify(r));
  r = await as(db, mgr1, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','ok1','Staff view only','{staff.view}')`);
  check("a role without any church permission is not affected by the church guard (existing behaviour)", r.ok, JSON.stringify(r));
  r = await as(db, owner1, `update public.organization_roles set permissions = '{orders.view,church.leadership.manage,church.groups.manage}' where id = '${R_PLAIN}'`);
  check("the owner can grant any church permission", r.ok && r.count === 1, JSON.stringify(r));
  await svc(db, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_PLAIN}'`);
  check("a plain team member (no church permission) has no church access at all", (await cnt(db, staffPlain, "church_members")) === 0);
  // the earlier guards, if loaded, still fire exactly as before
  if (inbox) {
    r = await as(db, mgrInbox, `update public.organization_roles set permissions = '{orders.view,inbox.view}' where id = '${R_PLAIN}'`);
    check("the Inbox owner-only guard still fires (untouched)", denied(r, /inbox_permission_owner_only/), JSON.stringify(r));
  }
  if (ceiling) {
    r = await as(db, mgr1, `update public.organization_roles set permissions = '{orders.view,payments.view}' where id = '${R_PLAIN}'`);
    check("the existing permission ceiling still fires for non-church permissions (untouched)", denied(r, /team_permission_ceiling/), JSON.stringify(r));
  } else {
    r = await as(db, mgr1, `update public.organization_roles set permissions = '{orders.view,payments.view}' where id = '${R_PLAIN}'`);
    check("control: without 07a the old hole for NON-church permissions is still open (this migration does not claim to close it)", r.ok && r.count === 1, JSON.stringify(r));
    await svc(db, `update public.organization_roles set permissions = '{orders.view}' where id = '${R_PLAIN}'`);
  }

  // ---- child / guardian integrity (service role: constraints and triggers apply to everyone) ---------------------------------------------------------------------------
  const bad = async (sql) => (await svcErr(db, sql));
  const child = (cols, vals) => `insert into public.church_members (profile_id, full_name, age_group, ${cols}) values ('${prof1}','C','child', ${vals})`;
  e = await bad(`insert into public.church_members (profile_id, full_name, age_group) values ('${prof1}','C','child')`);
  check("a child needs a guardian", e && e.code === "23514", JSON.stringify(e));
  e = await bad(child("guardian_member_id, phone", `'${MG}','+237600000000'`));
  check("a child cannot carry a phone number", e && e.code === "23514" && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id, email", `'${MG}','kid@example.com'`));
  check("a child cannot carry an email", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id, user_id", `'${MG}','${stranger}'`));
  check("a child cannot have a Ringo account link", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  await svc(db, `insert into public.ringo_customers (id) values ('${id("5", 1)}')`);
  e = await bad(child("guardian_member_id, customer_id", `'${MG}','${id("5", 1)}'`));
  check("a child cannot have a visitor-identity link", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id, source", `'${MG}','join_request'`));
  check("a child cannot self-register (source must be manual)", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id, source", `'${MG}','invite'`));
  check("…nor arrive through an invitation", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id", `'${MY}'`));
  check("a youth cannot be a guardian", e && /church_guardian_must_be_adult/.test(e.msg), JSON.stringify(e));
  e = await bad(child("guardian_member_id", `'${MC1}'`));
  check("a child cannot be a guardian", e && /church_guardian_must_be_adult/.test(e.msg), JSON.stringify(e));
  e = await bad(`insert into public.church_members (profile_id, full_name, age_group, guardian_member_id) values ('${prof1}','A','adult','${MG}')`);
  check("an adult cannot have a guardian", e && /adult_no_guardian/.test(e.msg), JSON.stringify(e));
  e = await bad(`update public.church_members set guardian_member_id = id where id = '${MC1}'`);
  check("a person cannot be their own guardian (trigger)", e && e.code === "23514", JSON.stringify(e));
  e = await noTrigger("church_members", "church_members_guard_trg", () => bad(`update public.church_members set guardian_member_id = id where id = '${MC1}'`));
  check("a person cannot be their own guardian (constraint alone)", e && /no_self_guardian/.test(e.msg), JSON.stringify(e));
  e = await bad(`update public.church_members set age_group = 'youth' where id = '${MG}'`);
  check("a guardian cannot stop being an adult while someone depends on them", e && /church_guardian_has_dependents/.test(e.msg), JSON.stringify(e));
  e = await bad(`update public.church_members set age_group = 'child', guardian_member_id = '${MG}' where id = '${MA}'`);
  check("an adult with an account cannot be turned into a child record (the account link would be kept)", e && /child_minimal/.test(e.msg), JSON.stringify(e));
  e = await bad(`delete from public.church_members where id = '${MG}'`);
  check("hard-deleting a guardian is refused while a child depends on them", e && e.code === "23503", JSON.stringify(e));
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MC1}','volunteer')`);
  check("a child cannot be a volunteer", e && /church_child_role_denied/.test(e.msg), JSON.stringify(e));
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MC1}','leader')`);
  check("a child cannot lead a group", e && /church_child_role_denied/.test(e.msg), JSON.stringify(e));
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MC1}','member')`);
  check("a child can be a plain member of a group", e === null, JSON.stringify(e));
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MY}','assistant')`);
  check("a youth cannot lead or assist", e && /church_role_requires_adult/.test(e.msg), JSON.stringify(e));
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof1}','${G2}','${MY}','volunteer')`);
  check("a youth can volunteer", e === null, JSON.stringify(e));
  e = await bad(`insert into public.church_leadership (profile_id, member_id, title) values ('${prof1}','${MY}','Youth rep')`);
  check("a youth or child cannot hold a leadership title", e && /church_role_requires_adult/.test(e.msg), JSON.stringify(e));
  e = await bad(`update public.church_members set age_group = 'youth' where id = '${ML}'`);
  check("a leader or titled person cannot be turned into a non-adult record", e && /church_role_requires_adult/.test(e.msg), JSON.stringify(e));
  await svc(db, `insert into public.church_members (id, profile_id, full_name, status) values ('${M(60)}','${prof1}','Dormant','inactive')`);
  e = await bad(`insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G2}','${M(60)}')`);
  check("an inactive person cannot be added to a group", e && /church_member_not_active/.test(e.msg), JSON.stringify(e));
  e = await bad(`update public.church_group_members set member_id = '${MP}' where id = '${GM_O}'`);
  check("a membership cannot be re-pointed at another person", e && /church_membership_link_immutable/.test(e.msg), JSON.stringify(e));
  e = await bad(`insert into public.church_leadership (profile_id, member_id, title, started_on, ended_on) values ('${prof1}','${MG}','Treasurer','2026-02-01','2026-01-01')`);
  check("leadership dates must be ordered", e && e.code === "23514", JSON.stringify(e));
  e = await bad(`insert into public.church_leadership (profile_id, member_id, title) values ('${prof1}','${ML}','elder')`);
  check("the same open title cannot be assigned twice to the same person", e && e.code === "23505", JSON.stringify(e));
  e = await bad(`insert into public.church_members (profile_id, full_name, user_id) values ('${prof1}','Dup','${plain1}')`);
  check("one live record per account per church", e && e.code === "23505", JSON.stringify(e));
  e = await bad(`insert into public.church_members (profile_id, full_name, status) values ('${prof1}','Gone','removed')`);
  check("a removed person is stamped removed_at automatically (the table never holds a removed row without it)", e === null && (await db.query(`select removed_at from public.church_members where full_name = 'Gone'`)).rows[0].removed_at !== null);
  e = await bad(`insert into public.church_groups (profile_id, kind, name) values ('${prof1}','group','choir')`);
  check("two active groups of the same kind cannot share a name (case-insensitive)", e && e.code === "23505", JSON.stringify(e));

  // ---- account-link deletion, hard delete, church deletion ---------------------------------------------------------------------------------------------------------
  await svc(db, `insert into public.church_members (id, profile_id, full_name, user_id) values ('${M(70)}','${prof1}','Linked person','${delUser}');
                 insert into public.church_group_members (id, profile_id, group_id, member_id) values ('${GM(70)}','${prof1}','${G2}','${M(70)}');
                 insert into public.organization_members (profile_id, user_id, role_id) values ('${prof1}','${delUser}','${R_PLAIN}');
                 insert into public.ringo_customers (id) values ('${id("5", 2)}');
                 insert into public.church_members (id, profile_id, full_name, customer_id) values ('${M(71)}','${prof1}','Visitor person','${id("5", 2)}');`);
  await svc(db, `delete from public.users where id = '${delUser}'`);
  const linked = await memberOf(db, M(70));
  check("deleting the account detaches the link but KEEPS the church's record and its group membership", linked && linked.user_id === null && linked.full_name === "Linked person" && (await db.query(`select 1 from public.church_group_members where id = '${GM(70)}'`)).rows.length === 1);
  check("…and the staff membership goes with the account, as it always did", (await db.query(`select 1 from public.organization_members where user_id = '${delUser}'`)).rows.length === 0);
  await svc(db, `delete from public.ringo_customers where id = '${id("5", 2)}'`);
  const vis = await memberOf(db, M(71));
  check("deleting a visitor identity detaches the link but keeps the record", vis && vis.customer_id === null && vis.full_name === "Visitor person");
  await svc(db, `delete from public.church_members where id = '${M(70)}'`);
  check("a hard delete takes that person's group memberships with it", (await db.query(`select 1 from public.church_group_members where member_id = '${M(70)}'`)).rows.length === 0);
  await svc(db, `delete from public.church_members where id in ('${MC1}','${MC2}','${MY}')`);
  await svc(db, `delete from public.church_members where guardian_member_id = '${MG}'`);
  check("once the dependent records are dealt with the guardian can be hard-deleted", (await svcErr(db, `delete from public.church_members where id = '${MG}'`)) === null);
  await svc(db, `insert into public.profiles (id, user_id, category) values ('${prof4}','${stranger}','church_ministries');
                 insert into public.church_members (id, profile_id, full_name) values ('${M(80)}','${prof4}','Gone with the church');
                 insert into public.church_groups (id, profile_id, kind, name) values ('${G(80)}','${prof4}','group','X');
                 insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof4}','${G(80)}','${M(80)}');
                 insert into public.church_leadership (profile_id, member_id, title) values ('${prof4}','${M(80)}','Elder')`);
  await svc(db, `delete from public.profiles where id = '${prof4}'`);
  check("deleting the church's profile removes all of that church's rows, in all four tables, and no other church's", (await svc(db, `select (select count(*) from public.church_members where profile_id='${prof4}')::int + (select count(*) from public.church_groups where profile_id='${prof4}')::int + (select count(*) from public.church_group_members where profile_id='${prof4}')::int + (select count(*) from public.church_leadership where profile_id='${prof4}')::int as n`)).rows[0].n === 0 && (await cnt(db, owner2, "church_members")) >= 2);

  // ---- idempotence and failure modes -------------------------------------------------------------------------------------------------------------------------------
  const sigApplied = await sig(db);
  const polBefore = (await db.query(`select count(*)::int as n from pg_policy where polrelid::regclass::text like 'church\\_%'`)).rows[0].n;
  const rerun = await txn(db, MIG);
  check("re-running the migration on an applied database succeeds and changes nothing", rerun === null && (await sig(db)) === sigApplied && (await db.query(`select count(*)::int as n from pg_policy where polrelid::regclass::text like 'church\\_%'`)).rows[0].n === polBefore, rerun);

  // ---- rollback safety ---------------------------------------------------------------------------------------------------------------------------------------------
  const refused = await txn(db, ROLL);
  check("rollback REFUSES while church rows exist, and says why", refused && /rollback refused/.test(refused), refused);
  check("…and the refused rollback changed nothing", (await sig(db)) === sigApplied && (await cnt(db, owner1, "church_members")) > 0 && (await db.query(`select count(*)::int as n from pg_trigger where tgname like '%church_guard_trg'`)).rows[0].n === 3);
  const confirmed = await txn(db, ROLL.replace("begin;", "begin;\nselect set_config('church_people.allow_data_loss', 'yes', true);"));
  check("with the explicit data-loss confirmation the rollback runs", confirmed === null, confirmed);
  check("…removing the tables, functions and guard triggers", (await db.query(`select count(*)::int as n from pg_class where relname like 'church\\_%' and relkind = 'r'`)).rows[0].n === 0 && (await db.query(`select count(*)::int as n from pg_proc where proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname = 'is_church_profile' or proname like '%\\_church\\_guard'`)).rows[0].n === 0 && (await db.query(`select count(*)::int as n from pg_trigger where tgname like '%church_guard_trg'`)).rows[0].n === 0);
  check("…and leaving every pre-existing object exactly as it was before the migration", (await sig(db)).split("|").slice(0, 3).join("|") === sigBefore.split("|").slice(0, 3).join("|"));
  if (inbox) {
    r = await as(db, mgrInbox, `update public.organization_roles set permissions = '{orders.view,inbox.view}' where id = '${R_PLAIN}'`);
    check("after rollback the earlier Team guards still work", denied(r, /inbox_permission_owner_only/), JSON.stringify(r));
  }
  const again = await txn(db, ROLL);
  check("the rollback is safe to run twice", again === null, again);
  const reapply = await txn(db, MIG);
  check("the migration can be re-applied after a rollback, and verify is green again", reapply === null && (await db.query(VER)).rows.every((x) => x.ok === true), reapply);
  const emptyRb = await txn(db, ROLL);
  check("with the tables empty the rollback needs no confirmation", emptyRb === null, emptyRb);

}

await runSuite("A: all earlier Team guards loaded", { ceiling: true, inbox: true });
await runSuite("B: NO earlier guard loaded", { ceiling: false, inbox: false });

// =========================================================================================================================================================================
// C. FAILURE MODES OF THE MIGRATION ITSELF
// =========================================================================================================================================================================
{
  suite = "[failure modes] ";
  let db = await newDb({ team: false });
  let err = await txn(db, MIG);
  check("without the Team tables the migration refuses to start and names what is missing", err && /precondition failed: missing tables/.test(err) && /organization_roles/.test(err), err);

  db = await newDb();
  await seedBase(db);
  await db.exec(`drop table public.ringo_customers`);
  err = await txn(db, MIG);
  check("without ringo_customers it refuses and changes nothing", err && /missing tables: ringo_customers/.test(err) && (await db.query(`select count(*)::int as n from pg_class where relname like 'church\\_%'`)).rows[0].n === 0, err);

  db = await newDb();
  await seedBase(db);
  await db.exec(`create function public.has_org_permission_x() returns int language sql as 'select 1'`);
  await db.exec(`drop function public.is_org_member(uuid) cascade`).catch(() => {});
  err = await txn(db, MIG);
  check("without the shared permission helpers it refuses", err && /precondition failed/.test(err), err);

  db = await newDb();
  await seedBase(db);
  err = await txn(db, MIG);
  await db.exec(`drop table public.church_leadership`);
  err = await txn(db, MIG);
  check("a half-applied database (one table missing) is refused rather than patched", err && /half-applied/.test(err), err);

  db = await newDb();
  await seedBase(db);
  await db.exec(`create table public.church_members (id uuid primary key)`);
  err = await txn(db, MIG);
  check("a foreign table with the same name is refused (unknown state)", err && /half-applied/.test(err), err);
  check("…and the migration rolled back completely", (await db.query(`select count(*)::int as n from pg_proc where proname like 'church\\_%'`)).rows[0].n === 0);

  // a disabled pre-existing guard must be reported by the postcondition path: simulate by disabling one before the run
  db = await newDb();
  await seedBase(db);
  await db.exec(`alter table public.organization_roles disable trigger organization_roles_ceiling_guard_trg`);
  err = await txn(db, MIG);
  check("a pre-existing Team trigger that is already disabled makes the postcondition fail (the migration will not run on a drifted database)", err && /postcondition failed: an existing trigger is missing or disabled/.test(err), err);
  check("…and nothing was created", (await db.query(`select count(*)::int as n from pg_class where relname like 'church\\_%'`)).rows[0].n === 0);
}

  // ---- F9: name collisions. The migration refuses to overwrite, and the rollback refuses to drop, anything that is not provably this migration's own.
  const fresh = async () => { const d = await newDb(); await seedBase(d); return d; };
  const nTables = async (d) => (await d.query(`select count(*)::int as n from pg_class where relname in ('church_members','church_groups','church_group_members','church_leadership')`)).rows[0].n;
  const cases = [
    ["a foreign function with the same name and signature", `create function public.church_is_owner(uuid) returns boolean language sql as 'select true'`, /a function with one of this file's names already exists/],
    ["a foreign function with the same name but a different signature", `create function public.church_has_permission(text) returns boolean language sql as 'select true'`, /a function with one of this file's names already exists/],
    ["a leftover church_member_age_group from an earlier draft", `create function public.church_member_age_group(uuid) returns text language sql as 'select 1::text'`, /a function with one of this file's names already exists/],
    ["a foreign trigger with a Team guard trigger's name", `create function public.zz_f() returns trigger language plpgsql as 'begin return new; end'; create trigger organization_roles_church_guard_trg before insert on public.organization_roles for each row execute function public.zz_f()`, /a trigger with one of this file's names already exists/],
    ["a foreign relation named church_*", `create table public.church_notes (id int)`, /relations named church_\* already exist/],
  ];
  for (const [label, setup, re] of cases) {
    const d = await fresh();
    await d.exec(setup);
    const e1 = await txn(d, MIG);
    check(`F9: ${label} makes the migration refuse before changing anything`, e1 && re.test(e1) && (await nTables(d)) === 0 && (await d.query(`select count(*)::int as n from pg_proc where obj_description(oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql'`)).rows[0].n === 0, e1);
  }
  let d = await fresh();
  await d.exec(`create function public.church_is_owner(uuid) returns boolean language sql as 'select true'`);
  await txn(d, MIG);
  check("F9: …and the foreign function is exactly as it was (not overwritten)", (await d.query(`select prosrc from pg_proc where proname = 'church_is_owner'`)).rows[0].prosrc === "select true");

  d = await fresh();
  check("F9: setup — a clean first run succeeds and marks everything it created", (await txn(d, MIG)) === null && (await d.query(`select count(*)::int as n from pg_proc where obj_description(oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql'`)).rows[0].n === 20);
  await d.exec(`comment on function public.church_is_owner(uuid) is null`);
  let e2 = await txn(d, MIG);
  check("F9: a re-run refuses when one of its functions has lost its marker (it could have been replaced by something else)", e2 && /not managed by it \(it would be overwritten\)/.test(e2), e2);
  const fnCount = async () => (await d.query(`select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname = 'is_church_profile')`)).rows[0].n;
  const n0 = await fnCount();
  e2 = await txn(d, ROLL.replace("begin;", "begin;\nselect set_config('church_people.allow_data_loss', 'yes', true);"));
  check("F9: the rollback refuses to drop an unmarked function, even with data loss confirmed, and drops NOTHING", e2 && /rollback refused: function\(s\) church_is_owner\(uuid\)/.test(e2) && (await nTables(d)) === 4 && (await fnCount()) === n0, e2);
  await d.exec(`comment on function public.church_is_owner(uuid) is 'managed by 2026-12-27_church_people_groups.sql'; comment on trigger organization_roles_church_guard_trg on public.organization_roles is null`);
  e2 = await txn(d, ROLL);
  check("F9: …nor an unmarked Team trigger", e2 && /rollback refused: trigger\(s\) organization_roles_church_guard_trg/.test(e2) && (await nTables(d)) === 4, e2);
  await d.exec(`comment on trigger organization_roles_church_guard_trg on public.organization_roles is 'managed by 2026-12-27_church_people_groups.sql'; comment on table public.church_groups is null`);
  e2 = await txn(d, ROLL);
  check("F9: …nor an unmarked table", e2 && /rollback refused: table\(s\) church_groups/.test(e2) && (await nTables(d)) === 4, e2);
  await d.exec(`comment on table public.church_groups is 'managed by 2026-12-27_church_people_groups.sql'; create function public.church_is_owner(text) returns boolean language sql as 'select false'`);
  e2 = await txn(d, MIG);
  check("F9: a re-run refuses when an extra overload of one of its names appeared", e2 && /not managed by it/.test(e2), e2);
  await d.exec(`drop function public.church_is_owner(text)`);
  check("F9: …and once the stranger is gone the rollback works and removes only its own objects", (await txn(d, ROLL)) === null && (await nTables(d)) === 0 && (await fnCount()) === 0);

  d = await fresh();
  await d.exec(`create table public.church_members (id int); insert into public.church_members values (1)`);
  e2 = await txn(d, ROLL.replace("begin;", "begin;\nselect set_config('church_people.allow_data_loss', 'yes', true);"));
  check("F9: on a database where the migration was never applied, a rollback refuses to drop a foreign table that happens to be called church_members", e2 && /rollback refused: table\(s\) church_members/.test(e2) && (await d.query(`select count(*)::int as n from public.church_members`)).rows[0].n === 1, e2);

  // ---- L1: a re-run must not adopt or silently re-mark tables that lack the marker. A correct re-run still works.
  for (const t of ["church_members", "church_groups", "church_group_members", "church_leadership"]) {
    d = await fresh();
    check(`L1 setup (${t}): a clean first run succeeds`, (await txn(d, MIG)) === null);
    const pol0 = (await d.query(`select count(*)::int n from pg_policy where polrelid::regclass::text like 'church\\_%'`)).rows[0].n;
    await d.exec(`comment on table public.${t} is null`);
    const e = await txn(d, MIG);
    const marker = (await d.query(`select obj_description('public.${t}'::regclass, 'pg_class') as m`)).rows[0].m;
    check(`L1: re-run with ${t} unmarked is refused ('already exist but are not marked') and does NOT re-mark it`, e && e.includes(`table(s) ${t} already exist but are not marked as managed by this migration; refusing to adopt or re-mark them`) && marker === null && (await d.query(`select count(*)::int n from pg_policy where polrelid::regclass::text like 'church\\_%'`)).rows[0].n === pol0, e);
  }
  d = await fresh();
  await txn(d, MIG);
  await d.exec(`comment on table public.church_members is null; comment on table public.church_groups is null; comment on table public.church_group_members is null; comment on table public.church_leadership is null`);
  const e4 = await txn(d, MIG);
  check("L1: with all four unmarked it also refuses, naming all four", e4 && ["church_members", "church_groups", "church_group_members", "church_leadership"].every((t) => e4.includes(t)), e4);
  d = await fresh();
  await txn(d, MIG);
  check("L1: a correctly applied migration still re-runs cleanly, twice, and the verify file stays green", (await txn(d, MIG)) === null && (await txn(d, MIG)) === null && (await d.query(VER)).rows.every((x) => x.ok === true));

  // ---- M2: the executable part (the flag follows every group) and what is NOT proven
  d = await fresh();
  await txn(d, MIG);
  await seedChurch(d);
  await svc(d, `insert into public.church_members (id, profile_id, full_name, age_group, guardian_member_id) values ('${M(10)}','${prof1}','Youth X','youth','${MG}')`);
  await svc(d, `insert into public.church_group_members (profile_id, group_id, member_id) values ('${prof1}','${G1}','${M(10)}'), ('${prof1}','${G2}','${M(10)}'), ('${prof1}','${G4}','${M(10)}')`);
  await svc(d, `update public.church_members set age_group = 'child' where id = '${M(10)}'`);
  check("M2 (executed, single session): reclassifying a person to child flips is_child on EVERY group they belong to, and back", (await d.query(`select count(*)::int n from public.church_group_members where member_id = '${M(10)}' and is_child`)).rows[0].n === 3 && ((await svc(d, `update public.church_members set age_group = 'youth' where id = '${M(10)}'`)), (await d.query(`select count(*)::int n from public.church_group_members where member_id = '${M(10)}' and is_child`)).rows[0].n === 0));
  check("M2 (executed): …and with the group locks in place the same transaction still completes (no self-deadlock between the person lock and the group locks)", (await svcErr(d, `begin; update public.church_members set age_group = 'child' where id = '${M(10)}'; update public.church_members set age_group = 'youth' where id = '${M(10)}'; commit`)) === null);
  const syncSrc = (await d.query(`select pg_get_functiondef('public.church_members_age_sync()'::regprocedure) as d`)).rows[0].d;
  check("M2 (source level ONLY): the installed sync function holds the group locks in id order, under the flip condition, before updating — concurrency itself is NOT exercised by this suite", /order by g\.id\s+for update/.test(syncSrc) && syncSrc.indexOf("for update") < syncSrc.indexOf("update public.church_group_members"));

suite = "";
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} church people & groups checks passed`);
process.exit(failed.length ? 1 : 0);
