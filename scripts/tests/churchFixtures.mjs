// Shared fixtures for the Churches & Ministries People & Groups (Phase 2B/2C) tests. NOT a test file.
// Builds scratch in-memory PostgreSQL (PGlite) holding the REAL Team migrations, the real permission-ceiling and Inbox guards and the REAL Phase 2A church migration, seeds synthetic
// churches / people / staff, and offers a small PostgREST-style client that runs every query as the `authenticated` role with auth.uid() = a chosen user, so row-level security and
// the guard triggers decide exactly as they do for a signed-in user. No Supabase, no network, no production data.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
export const MIG = read("supabase/migrations/2026-12-27_church_people_groups.sql");
const TEAM01 = read("supabase/migrations/2026-10-01_team_management.sql").split("\n").slice(27, 261).join("\n");
const TEAM03 = read("supabase/migrations/2026-10-03_team_rls_enterprise_gate.sql");
const TEAM04 = read("supabase/migrations/2026-10-04_team_members_read_fix.sql");
const CEILING = read("supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql");
const INBOX = read("supabase/migrations/2026-12-13_whatsapp_inbox_team_permission_guard.sql");

export const id = (kind, n) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const U = (n) => id("c", n), P = (n) => id("a", n), R = (n) => id("b", n), M = (n) => id("e", n), G = (n) => id("f", n), GM = (n) => id("d", n), LD = (n) => id("9", n);

// ---- personas (users) -------------------------------------------------------------------------------------------------------------------------------------------
export const u = {
  owner1: U(1), mgr1: U(2), viewer1: U(3), kids1: U(4), kidsMgr1: U(5), del1: U(6), leader1: U(7), vol1: U(8), plain1: U(9), stranger: U(10), owner2: U(11), mgr2: U(12),
  admin: U(13), adminOwner: U(14), adminMember: U(15), ownerNC: U(16), leadMgr1: U(17), grpMgr1: U(18), kg1: U(19), kd1: U(20), freeStaff: U(21), anonymous: "",
};
export const prof = { c1: P(1), c2: P(2), c3: P(3), nc: P(4) };
export const plan = { biz: "d0000000-0000-4000-8000-000000000001", free: "d0000000-0000-4000-8000-000000000002" };
export const role = {
  mgr: R(1), view: R(2), kids: R(3), kidsMgr: R(4), del: R(5), plain: R(6), leadMgr: R(7), grpMgr: R(8), kg: R(9), kd: R(10), mgr2: R(20), adminView: R(21), freeRole: R(22),
};
// c1 roster (adults MA.. , children MC1 MC2, youth MY)
export const m = { admin: M(1), leader: M(2), vol: M(3), other: M(4), guardian: M(5), kid1: M(6), kid2: M(7), pending: M(8), youth: M(9), c2a: M(20), c2b: M(21) };
export const g = { choir: G(1), youthGrp: G(2), kids: G(3), c2grp: G(4), empty: G(5) };
export const gm = { leader: GM(1), vol: GM(2), kid1: GM(3), other: GM(4), c2: GM(5) };
export const ld = { l1: LD(1), l2: LD(2), c2: LD(3) };

export const MGR_PERMS = "staff.view,staff.manage,staff.invite,church.members.view,church.members.manage,church.groups.view,church.groups.manage,church.leadership.view";

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

export async function newDb(PGlite) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(TEAM01); await db.exec(TEAM03); await db.exec(TEAM04);
  await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);
  await db.exec(CEILING); await db.exec(INBOX);
  await db.exec(MIG);
  return db;
}

export const svc = async (db, sql) => { await db.exec("set role service_role"); try { const out = await db.exec(sql); return out[out.length - 1]; } finally { await db.exec("reset role"); } };
export const svcQuery = async (db, sql) => { await db.exec("set role service_role"); try { return (await db.query(sql)).rows; } finally { await db.exec("reset role"); } };

export async function seed(db) {
  await svc(db, `
    insert into public.plans (id, name, team_enabled) values ('${plan.biz}','business',true), ('${plan.free}','free',false);
    insert into public.users (id, role, plan_id) values
      ('${u.owner1}','user','${plan.biz}'), ('${u.mgr1}','user','${plan.free}'), ('${u.viewer1}','user','${plan.free}'), ('${u.kids1}','user','${plan.free}'), ('${u.kidsMgr1}','user','${plan.free}'),
      ('${u.del1}','user','${plan.free}'), ('${u.leader1}','user','${plan.free}'), ('${u.vol1}','user','${plan.free}'), ('${u.plain1}','user','${plan.free}'), ('${u.stranger}','user','${plan.free}'),
      ('${u.owner2}','user','${plan.biz}'), ('${u.mgr2}','user','${plan.free}'), ('${u.admin}','admin','${plan.free}'), ('${u.adminOwner}','admin','${plan.biz}'), ('${u.adminMember}','admin','${plan.free}'),
      ('${u.ownerNC}','user','${plan.biz}'), ('${u.leadMgr1}','user','${plan.free}'), ('${u.grpMgr1}','user','${plan.free}'), ('${u.kg1}','user','${plan.free}'), ('${u.kd1}','user','${plan.free}'), ('${u.freeStaff}','user','${plan.free}');
    insert into public.profiles (id, user_id, category, categories) values
      ('${prof.c1}','${u.owner1}','church_ministries','{church_ministries}'), ('${prof.c2}','${u.owner2}','other','{church_ministries}'),
      ('${prof.c3}','${u.adminOwner}','church_ministries','{}'), ('${prof.nc}','${u.ownerNC}','music_entertainment','{}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${role.mgr}','${prof.c1}','mgr','Church admin','{${MGR_PERMS}}'),
      ('${role.view}','${prof.c1}','view','Viewer','{church.members.view}'),
      ('${role.kids}','${prof.c1}','kids','Kids viewer','{church.children.view,church.members.view}'),
      ('${role.kidsMgr}','${prof.c1}','kidsmgr','Kids manager','{church.children.manage,church.children.view,church.members.manage,church.members.view,church.groups.view}'),
      ('${role.del}','${prof.c1}','del','Deleter','{church.members.view,church.members.delete}'),
      ('${role.plain}','${prof.c1}','plain','Plain','{orders.view}'),
      ('${role.leadMgr}','${prof.c1}','leadmgr','Leadership manager','{church.leadership.manage,church.leadership.view,church.members.view}'),
      ('${role.grpMgr}','${prof.c1}','grpmgr','Groups manager (no children)','{church.groups.manage,church.groups.view,church.members.view}'),
      ('${role.kg}','${prof.c1}','kg','Children + groups manager','{church.children.manage,church.children.view,church.members.view,church.members.manage,church.groups.view,church.groups.manage}'),
      ('${role.kd}','${prof.c1}','kd','Deleter incl. children','{church.members.view,church.members.delete,church.children.view,church.children.manage}'),
      ('${role.adminView}','${prof.c1}','adminview','Viewer (held by a platform admin)','{church.members.view,church.groups.view}'),
      ('${role.freeRole}','${prof.c1}','freerole','Viewer on a lapsed plan','{church.members.view}'),
      ('${role.mgr2}','${prof.c2}','mgr','Church admin 2','{staff.view,staff.manage,church.members.view,church.members.manage,church.groups.view,church.groups.manage,church.leadership.view,church.leadership.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values
      ('${prof.c1}','${u.mgr1}','${role.mgr}'), ('${prof.c1}','${u.viewer1}','${role.view}'), ('${prof.c1}','${u.kids1}','${role.kids}'), ('${prof.c1}','${u.kidsMgr1}','${role.kidsMgr}'),
      ('${prof.c1}','${u.del1}','${role.del}'), ('${prof.c1}','${u.plain1}','${role.plain}'), ('${prof.c1}','${u.leadMgr1}','${role.leadMgr}'), ('${prof.c1}','${u.grpMgr1}','${role.grpMgr}'),
      ('${prof.c1}','${u.kg1}','${role.kg}'), ('${prof.c1}','${u.kd1}','${role.kd}'), ('${prof.c1}','${u.adminMember}','${role.adminView}'),
      ('${prof.c2}','${u.mgr2}','${role.mgr2}');
  `);
  await svc(db, `
    insert into public.church_members (id, profile_id, user_id, full_name, phone, email, status, age_group, guardian_member_id) values
      ('${m.admin}','${prof.c1}',null,'Grace Admin','+237670000001','grace@example.test','active','adult',null),
      ('${m.leader}','${prof.c1}','${u.leader1}','Luc Leader',null,null,'active','adult',null),
      ('${m.vol}','${prof.c1}','${u.vol1}','Vera Volunteer',null,null,'active','adult',null),
      ('${m.other}','${prof.c1}',null,'Olivier Other','+237670000002',null,'active','adult',null),
      ('${m.guardian}','${prof.c1}',null,'Gaby Guardian','+237670000003',null,'active','adult',null),
      ('${m.pending}','${prof.c1}',null,'Paul Pending',null,null,'pending','adult',null),
      ('${m.youth}','${prof.c1}',null,'Yann Youth',null,null,'active','youth',null),
      ('${m.c2a}','${prof.c2}',null,'Second Church Adult',null,null,'active','adult',null);
    insert into public.church_members (id, profile_id, full_name, status, age_group, guardian_member_id) values
      ('${m.kid1}','${prof.c1}','Kiki Child','active','child','${m.guardian}'),
      ('${m.kid2}','${prof.c1}','Koko Child','active','child','${m.guardian}');
    insert into public.church_groups (id, profile_id, kind, name, description, status) values
      ('${g.choir}','${prof.c1}','department','Choir','Sunday music','active'),
      ('${g.youthGrp}','${prof.c1}','group','Youth','Young people','active'),
      ('${g.kids}','${prof.c1}','department','Children Ministry',null,'active'),
      ('${g.empty}','${prof.c1}','group','Empty Group',null,'active'),
      ('${g.c2grp}','${prof.c2}','group','Second Church Group',null,'active');
    insert into public.church_group_members (id, profile_id, group_id, member_id, role) values
      ('${gm.leader}','${prof.c1}','${g.choir}','${m.leader}','leader'),
      ('${gm.vol}','${prof.c1}','${g.choir}','${m.vol}','volunteer'),
      ('${gm.other}','${prof.c1}','${g.choir}','${m.other}','member'),
      ('${gm.kid1}','${prof.c1}','${g.kids}','${m.kid1}','member'),
      ('${gm.c2}','${prof.c2}','${g.c2grp}','${m.c2a}','member');
    insert into public.church_leadership (id, profile_id, member_id, title, started_on, ended_on) values
      ('${ld.l1}','${prof.c1}','${m.admin}','Senior Pastor','2020-01-01',null),
      ('${ld.l2}','${prof.c1}','${m.other}','Deacon','2018-01-01','2019-12-31'),
      ('${ld.c2}','${prof.c2}','${m.c2a}','Elder','2021-01-01',null);
  `);
}

// ---- a PostgREST-style client that runs as a given signed-in user -----------------------------------------------------------------------------------------------------
export const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
export const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `${q(JSON.stringify(v))}::jsonb` : q(v));
const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const dbErr = (e) => ({ code: e.code, message: String(e.message).split("\n")[0], details: e.detail || null });

/** `userId` = null/"" is an anonymous visitor (role anon). The returned client has the slice of the Supabase API the church code uses. */
export function sessionFor(db, userId, { role: dbRole = userId ? "authenticated" : "anon" } = {}) {
  const log = [];
  let tail = Promise.resolve();
  const serial = (fn) => { const next = tail.then(fn, fn); tail = next.then(() => undefined, () => undefined); return next; };
  const run = (sql) => serial(async () => {
    await db.exec(`set role ${dbRole}; select set_config('request.jwt.claim.sub','${userId || ""}', false);`);
    try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
  });
  return {
    log,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) {
      const st = { cols: "*", where: [], order: [], limit: null, offset: 0, mode: "select", values: null, head: false, count: false, returning: false, inner: false };
      const colSql = () => st.cols === "*" ? "*" : splitCols(st.cols).filter((c) => !c.includes("(")).map((c) => `"${c}"`).join(", ");
      const whereSql = () => (st.where.length ? ` where ${st.where.join(" and ")}` : "");
      const sql = () => {
        if (st.mode === "insert") {
          const keys = Object.keys(st.values);
          const ins = `insert into public."${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((k) => lit(st.values[k])).join(",")})`;
          return st.returning ? `with r as (${ins} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x` : `${ins}`;
        }
        if (st.mode === "update") {
          const set = Object.entries(st.values).map(([k, v]) => `"${k}" = ${lit(v)}`).join(", ");
          const upd = `update public."${table}" as t set ${set}${whereSql()}`;
          return st.returning ? `with r as (${upd} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x` : upd;
        }
        if (st.mode === "delete") {
          const del = `delete from public."${table}" as t${whereSql()}`;
          return st.returning ? `with r as (${del} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x` : del;
        }
        const o = st.order.length ? ` order by ${st.order.join(", ")}` : "";
        const l = st.limit !== null ? ` limit ${st.limit} offset ${st.offset}` : "";
        const n = st.count ? `, (select count(*)::int from public."${table}" as t${whereSql()}) as n` : "";
        return `select coalesce(json_agg(r), '[]'::json) as j${n} from (select ${colSql()} from public."${table}" as t${whereSql()}${o}${l}) r`;
      };
      const exec1 = async () => {
        const text = sql();
        log.push({ table, mode: st.mode, sql: text });
        try {
          const r = await run(text);
          if ((st.mode === "insert" || st.mode === "update" || st.mode === "delete") && !st.returning) return { data: null, count: null, error: null };
          const row = r.rows[0];
          return { data: row ? row.j : null, count: row?.n ?? null, error: null };
        } catch (e) { return { data: null, count: null, error: dbErr(e) }; }
      };
      const col = (c) => (c.includes(".") ? null : `t."${c}"`);
      const chain = {
        select(c, opts) {
          if (st.mode === "select") { st.cols = c ?? "*"; if (opts?.count) st.count = true; if (opts?.head) st.head = true; }
          else { st.returning = true; st.cols = c ?? "*"; }
          return chain;
        },
        insert(v) { st.mode = "insert"; st.values = v; return chain; },
        update(v) { st.mode = "update"; st.values = v; return chain; },
        delete() { st.mode = "delete"; return chain; },
        eq(c, v) {
          // the one embedded filter the church code uses: members of ONE group (an inner join to church_group_members, evaluated under the caller's own RLS)
          if (c === "church_group_members.group_id") { st.where.push(`exists (select 1 from public.church_group_members x where x.member_id = t.id and x.profile_id = t.profile_id and x.group_id = ${lit(v)})`); return chain; }
          st.where.push(`${col(c)} = ${lit(v)}`); return chain;
        },
        neq(c, v) { st.where.push(`${col(c)} <> ${lit(v)}`); return chain; },
        in(c, v) { st.where.push(v.length ? `${col(c)} in (${v.map(lit).join(",")})` : "false"); return chain; },
        is(c, v) { st.where.push(`${col(c)} is ${v === null ? "null" : lit(v)}`); return chain; },
        lt(c, v) { st.where.push(`${col(c)} < ${lit(v)}`); return chain; },
        lte(c, v) { st.where.push(`${col(c)} <= ${lit(v)}`); return chain; },
        gte(c, v) { st.where.push(`${col(c)} >= ${lit(v)}`); return chain; },
        ilike(c, v) { st.where.push(`${col(c)} ilike ${q(v)}`); return chain; },
        or(str) {
          const parts = String(str).split(",").map((cl) => {
            const [c, op, ...rest] = cl.split("."); const v = rest.join(".");
            if (op === "is" && v === "null") return `t."${c}" is null`;
            if (op === "gte") return `t."${c}" >= ${lit(v)}`;
            if (op === "gt") return `t."${c}" > ${lit(v)}`;
            if (op === "lt") return `t."${c}" < ${lit(v)}`;
            if (op === "eq") return `t."${c}" = ${lit(v)}`;
            throw new Error("unsupported or() clause in the test client: " + cl);
          });
          st.where.push("(" + parts.join(" or ") + ")"); return chain;
        },
        order(c, o) { st.order.push(`t."${c}" ${o?.ascending === false ? "desc" : "asc"}${o?.nullsFirst === false ? " nulls last" : ""}`); return chain; },
        limit(n) { st.limit = n; return chain; },
        range(a, b) { st.limit = b - a + 1; st.offset = a; return chain; },
        async maybeSingle() { const r = await exec1(); if (r.error) return r; return r.data.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: r.data[0] ?? null, error: null }; },
        async single() { const r = await exec1(); if (r.error) return r; return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: "PGRST116", message: "expected one row" } }; },
        then(res, rej) { return exec1().then(res, rej); },
      };
      return chain;
    },
  };
}

/** Counts every row of the four church tables, so a test can prove a failed operation changed nothing. */
export async function snapshot(db) {
  const rows = async (t) => (await svcQuery(db, `select * from public.${t} order by 1`));
  const out = {};
  for (const t of ["church_members", "church_groups", "church_group_members", "church_leadership"]) out[t] = JSON.stringify(await rows(t));
  return out;
}
