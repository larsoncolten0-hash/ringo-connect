// Adversarial test for supabase/migrations/2026-10-07d_watchdog_events.sql (Ringo Watchdog V1).
//
// Scratch in-memory PostgreSQL (PGlite) only; never connects to Supabase. It applies the REAL migration, rollback and verify files and attacks the table the way each kind of
// caller could: an anonymous visitor, an ordinary signed-in user (including the account an incident is about), a platform admin through the API role, and the service role.
//   Setup:  npm install --no-save @electric-sql/pglite      Run:  node supabase/support/tests/watchdog.adversarial.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sql = (rel) => fs.readFileSync(REPO + rel, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = sql("supabase/migrations/2026-10-07d_watchdog_events.sql");
const ROLLBACK = sql("supabase/support/2026-10-07d_watchdog_events.rollback.sql");
const VERIFY = sql("supabase/support/2026-10-07d_watchdog_events.verify.sql");
const IS_ADMIN = (() => { const m = sql("supabase/schema.sql").replace(/--[^\n]*/g, "").match(/create or replace function is_admin\(\)[\s\S]*?\$\$ language sql security definer;/i); if (!m) throw new Error("is_admin not found"); return m[0]; })();

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const denied = async (f) => { const e = await errOf(f); return !!e && /permission denied|row-level security|violates row-level|violates check constraint|watchdog_events:|cannot|invalid/i.test(e.message); };
const ID = (k, n) => `${k}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { admin: ID("a", 1), victim: ID("a", 2), other: ID("a", 3) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.users (id uuid primary key, role text not null default 'creator');
  create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid not null, action text not null, target_user_id uuid, details jsonb, created_at timestamptz not null default now());
  grant all on all tables in schema public to anon, authenticated, service_role;
  ${IS_ADMIN}
  grant execute on all functions in schema public to anon, authenticated, service_role;
  alter table public.users enable row level security; create policy "u" on public.users for select using (true);
  insert into public.users values ('${U.admin}', 'admin'), ('${U.victim}', 'creator'), ('${U.other}', 'creator');
`);
const as = async (role, sub, q, params) => { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`); try { return await db.query(q, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false)`); } };
const val = async (q) => (await db.query(q)).rows[0];
const INSERT = (key, extra = "") => `insert into public.watchdog_events (rule_code, severity, event_type, subject_user_id, params, dedupe_key ${extra ? ", " + extra.split("|")[0] : ""}) values ('WD-002', 'high', 'send_music_payout_failed', '${U.victim}', '{"count":3,"program":"music"}', '${key}' ${extra ? ", " + extra.split("|")[1] : ""}) returning id`;

console.log("### 1. apply the REAL migration");
check("the migration applies and commits (postconditions pass)", (await errOf(() => db.exec(MIGRATION))) === null);
check("re-applying it is harmless (idempotent)", (await errOf(() => db.exec(MIGRATION))) === null);
const v = (await db.query(VERIFY)).rows;
check("verify: P1-P6 all PASS on a fresh install", v.filter((r) => r.grp.startsWith("P")).length === 6 && v.filter((r) => r.grp.startsWith("P")).every((r) => r.status === "PASS"), JSON.stringify(v));
check("verify is a single read-only SELECT", !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(sql("supabase/support/2026-10-07d_watchdog_events.verify.sql").replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "")));

console.log("### 2. nobody but the service role can create an incident");
check("anonymous visitor: cannot insert", await denied(() => as("anon", null, INSERT("anon-1"))));
check("ordinary signed-in user (the affected account): cannot insert a fake incident", await denied(() => as("authenticated", U.victim, INSERT("user-1"))));
check("a platform ADMIN through the API role: cannot insert either (only the server's service role writes)", await denied(() => as("authenticated", U.admin, INSERT("admin-1"))));
const first = (await as("service_role", null, INSERT("wd002:music:account:x:1"))).rows[0].id;
check("the service role can create an incident", !!first);

console.log("### 3. who can read");
check("anonymous visitor: cannot read", await denied(() => as("anon", null, "select * from public.watchdog_events")));
check("ordinary user, including the affected account: sees ZERO rows", (await as("authenticated", U.victim, "select * from public.watchdog_events")).rows.length === 0);
check("another ordinary user: sees ZERO rows", (await as("authenticated", U.other, "select * from public.watchdog_events")).rows.length === 0);
check("a platform admin can read the incident feed", (await as("authenticated", U.admin, "select * from public.watchdog_events")).rows.length === 1);

console.log("### 4. nobody but the service role can change one; even it can only change the status fields");
check("ordinary user cannot acknowledge (no UPDATE grant)", await denied(() => as("authenticated", U.victim, `update public.watchdog_events set status = 'resolved' where id = '${first}'`)));
check("a platform admin through the API role cannot update directly (acknowledging goes through the admin API route)", await denied(() => as("authenticated", U.admin, `update public.watchdog_events set status = 'acknowledged' where id = '${first}'`)));
check("ordinary user cannot delete", await denied(() => as("authenticated", U.victim, `delete from public.watchdog_events where id = '${first}'`)));
check("anonymous visitor cannot update or delete", await denied(() => as("anon", null, `update public.watchdog_events set status = 'resolved'`)) && await denied(() => as("anon", null, "delete from public.watchdog_events")));
check("the service role can acknowledge (status fields only)", (await errOf(() => as("service_role", null, `update public.watchdog_events set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = '${U.admin}' where id = '${first}'`))) === null && (await val(`select status from public.watchdog_events where id = '${first}'`)).status === "acknowledged");
for (const [label, set] of [["rule_code", "rule_code = 'WD-001'"], ["severity", "severity = 'medium'"], ["event_type", "event_type = 'x'"], ["subject", `subject_user_id = '${U.other}'`], ["params (rewrite what happened)", `params = '{"count":1}'`], ["dedupe_key", "dedupe_key = 'other'"], ["created_at (backdate)", "created_at = now() - interval '9 days'"]])
  check(`the service role cannot rewrite the incident's ${label}`, await denied(() => as("service_role", null, `update public.watchdog_events set ${set} where id = '${first}'`)));
check("the service role cannot DELETE an incident", await denied(() => as("service_role", null, `delete from public.watchdog_events where id = '${first}'`)));
check("an incident can be resolved, and then it is final: it cannot be reopened or re-stamped", (await errOf(() => as("service_role", null, `update public.watchdog_events set status = 'resolved', resolved_at = now(), resolved_by = '${U.admin}' where id = '${first}'`))) === null
  && await denied(() => as("service_role", null, `update public.watchdog_events set status = 'open' where id = '${first}'`))
  && await denied(() => as("service_role", null, `update public.watchdog_events set resolved_by = '${U.other}' where id = '${first}'`)));
check("TRUNCATE is not available to any API role", await denied(() => as("service_role", null, "truncate public.watchdog_events")) && await denied(() => as("authenticated", U.admin, "truncate public.watchdog_events")));

console.log("### 5. dedupe and content limits");
await as("service_role", null, INSERT("dup-key"));
check("the dedupe key is unique: a second incident with the same key is refused (23505), so overlapping requests cannot both alert", (await errOf(() => as("service_role", null, INSERT("dup-key"))))?.code === "23505");
check("a rule code must look like WD-nnn", await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, dedupe_key) values ('hack', 'high', 'x', 'k1')`)));
check("severity is medium or high only", await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, dedupe_key) values ('WD-001', 'critical', 'x', 'k2')`)));
check("params must be an object (not a string, an array or a number)", await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, params, dedupe_key) values ('WD-001', 'high', 'x', '"free text with a phone 670123456"', 'k3')`))
  && await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, params, dedupe_key) values ('WD-001', 'high', 'x', '[1]', 'k4')`)));
check("params are capped at 2000 bytes (a provider payload does not fit)", await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, params, dedupe_key) values ('WD-001', 'high', 'x', jsonb_build_object('blob', repeat('x', 5000)), 'k5')`)));
check("status must be open / acknowledged / resolved", await denied(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, dedupe_key, status) values ('WD-001', 'high', 'x', 'k6', 'deleted')`)));
check("an incident outlives the account it is about (no foreign key to users)", (await errOf(() => as("service_role", null, `insert into public.watchdog_events (rule_code, severity, event_type, subject_user_id, dedupe_key) values ('WD-001', 'medium', 'x', '${ID("f", 9)}', 'k7')`))) === null);
check("the audit-log lookup index Watchdog uses exists", !!(await val("select 1 as x from pg_indexes where indexname = 'admin_audit_log_action_target_created_idx'")));

console.log("### 6. verify after use, rollback, re-apply");
const v2 = (await db.query(VERIFY)).rows;
check("verify: still all PASS with data in the table, and the INFO counts see the incidents", v2.filter((r) => r.grp.startsWith("P")).every((r) => r.status === "PASS") && Number(v2.find((r) => r.grp === "I1").value) >= 3, JSON.stringify(v2.filter((r) => r.status !== "PASS")));
await db.exec(ROLLBACK);
check("rollback removes the table, its trigger and function and the index, and nothing else", !(await val("select to_regclass('public.watchdog_events') as t")).t && !(await val("select count(*)::int c from pg_proc where proname = 'watchdog_events_guard'")).c && !(await val("select 1 as x from pg_indexes where indexname = 'admin_audit_log_action_target_created_idx'")) && !!(await val("select to_regclass('public.admin_audit_log') as t")).t);
check("the migration applies again after a rollback", (await errOf(() => db.exec(MIGRATION))) === null && (await as("authenticated", U.victim, "select * from public.watchdog_events")).rows.length === 0);

const failed = results.filter((r) => !r.pass);
console.log(`\nwatchdog.adversarial: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map((f) => f.name).join("\n - ")); process.exit(1); }
