// Test for supabase/migrations/2026-10-25_ringo_ai_foundation.sql
//
// Runs entirely on a scratch, in-memory PostgreSQL (PGlite). It never connects to Supabase or any real database.
// Applies the ACTUAL migration, verify and rollback files from this repository to a Supabase-shaped database
// (anon / authenticated / service_role roles, auth.uid() from the JWT claim, is_admin()), then checks:
//   * the migration is idempotent and purely additive (pre-existing objects byte-for-byte unchanged)
//   * the verify script passes
//   * RLS: owners see only their own conversations/messages/feedback; nobody but the server can write;
//     settings/usage/beta rows are not readable by normal users; admins can read
//   * constraints (content size, roles, ratings, settings ranges) and the quota function's numbers
//   * ai_quota_snapshot is not callable by anon/authenticated
//   * the rollback removes every Ringo AI object and nothing else
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json)
//   Run:    node supabase/support/tests/ringo_ai_foundation.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
// MUT=open_messages breaks the ai_messages read policy IN MEMORY ONLY (never on disk) to prove the RLS checks can fail.
const MIGRATION_SOURCE = read("supabase/migrations/2026-10-25_ringo_ai_foundation.sql");
const MIGRATION = process.env.MUT === "open_messages" ? MIGRATION_SOURCE.replace("is_admin()\n      or exists", "true or exists") : MIGRATION_SOURCE;
const VERIFY = read("supabase/support/2026-10-25_ringo_ai_foundation.verify.sql");
const ROLLBACK = read("supabase/support/2026-10-25_ringo_ai_foundation.rollback.sql");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const errOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message.split("\n")[0];
  }
};

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), admin: UID(3) };
const P = { alice: PID(1), bob: PID(2) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.users (id uuid primary key, email text not null, role text not null default 'creator');
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null);
  create function public.is_admin() returns boolean language sql security definer set search_path = public as $$
    select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  alter table public.users enable row level security;
  create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
  insert into public.users (id, email, role) values ('${U.alice}','alice@x.test','creator'), ('${U.bob}','bob@x.test','creator'), ('${U.admin}','admin@x.test','admin');
  insert into public.profiles (id, user_id, username) values ('${P.alice}','${U.alice}','alice'), ('${P.bob}','${U.bob}','bob');
`);

const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`);
  }
};

const snapshotExisting = async () =>
  JSON.stringify(
    (
      await db.query(`
      select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default,'') as x
        from information_schema.columns where table_schema = 'public' and table_name in ('users','profiles')
      union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies where tablename in ('users','profiles')
      union all select 'fn:' || p.proname || ':' || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','auth') and p.proname not like 'ai\\_%'
      order by 1`)
    ).rows.map((r) => r.x)
  );

// ------------------------------------------------------------------ static: purely additive
const stripped = MIGRATION.replace(/--.*$/gm, "");
check("migration never ALTERs a non-ai table", !/alter\s+table\s+(?!(if\s+exists\s+)?public\.ai_)/i.test(stripped));
check("migration never DROPs anything", !/\bdrop\s+(table|column|function|policy|trigger|index|constraint)\b/i.test(stripped));
check("migration never UPDATEs/DELETEs existing data", !/\b(update|delete\s+from)\s+(?!public\.ai_)/i.test(stripped.replace(/for\s+(update|delete)\b/gi, "")));

// ------------------------------------------------------------------ apply (twice: idempotent)
const before = await snapshotExisting();
check("migration applies", (await errOf(() => db.exec(MIGRATION))) === null);
check("migration re-applies cleanly (idempotent)", (await errOf(() => db.exec(MIGRATION))) === null);
check("pre-existing tables/policies/functions unchanged", before === (await snapshotExisting()));

const verifyRows = (await db.query(VERIFY.split(/;\s*\n\s*-- Informational/)[0])).rows;
check("verify script: every check ok", verifyRows.length >= 10 && verifyRows.every((r) => r.ok === true), JSON.stringify(verifyRows.filter((r) => !r.ok)));
const settings = (await db.query(`select * from ai_settings`)).rows;
check("settings singleton seeded, kill switch OFF by default", settings.length === 1 && settings[0].enabled === false && settings[0].access_mode === "allowlist");
check("second settings row impossible", (await errOf(() => db.exec(`insert into ai_settings (id) values (2)`))) !== null);

// ------------------------------------------------------------------ seed data (as the server / service role)
await db.exec(`set role service_role;
  insert into ai_conversations (id, user_id, profile_id, title, locale) values
    ('e0000000-0000-4000-8000-000000000001','${U.alice}','${P.alice}','Alice chat','en'),
    ('e0000000-0000-4000-8000-000000000002','${U.bob}','${P.bob}','Bob chat','fr');
  insert into ai_messages (id, conversation_id, role, content) values
    ('f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','user','hi'),
    ('f0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','assistant','hello alice'),
    ('f0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000002','assistant','bonjour bob');
  insert into ai_feedback (message_id, user_id, rating) values ('f0000000-0000-4000-8000-000000000002','${U.alice}',1);
  insert into ai_beta_access (user_id) values ('${U.alice}');
  insert into ai_usage_events (user_id, profile_id, provider, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at) values
    ('${U.alice}','${P.alice}','anthropic','m','ok',100,50,1000,0,0.5, now() - interval '1 hour'),
    ('${U.alice}','${P.alice}','anthropic','m','error',10,0,0,0,null, now() - interval '2 hours'),
    ('${U.alice}','${P.alice}','anthropic','m','ok',1,1,0,0,0.25, now() - interval '30 hours'),
    ('${U.bob}','${P.bob}','anthropic','m','ok',5,5,0,0,1.0, now());
  reset role;`);

// ------------------------------------------------------------------ RLS: reads
const count = async (role, sub, table) => Number((await as(role, sub, `select count(*)::int as n from ${table}`)).rows[0].n);
check("alice sees only her conversation", (await count("authenticated", U.alice, "ai_conversations")) === 1);
check("alice sees only her messages", (await count("authenticated", U.alice, "ai_messages")) === 2);
check("alice cannot read bob's message by id", (await as("authenticated", U.alice, `select id from ai_messages where id='f0000000-0000-4000-8000-000000000003'`)).rows.length === 0);
check("alice sees her feedback", (await count("authenticated", U.alice, "ai_feedback")) === 1);
check("bob sees no feedback", (await count("authenticated", U.bob, "ai_feedback")) === 0);
check("alice sees her own beta row", (await count("authenticated", U.alice, "ai_beta_access")) === 1);
check("bob sees no beta rows", (await count("authenticated", U.bob, "ai_beta_access")) === 0);
check("owners cannot read usage events", (await count("authenticated", U.alice, "ai_usage_events")) === 0);
check("owners cannot read settings", (await count("authenticated", U.alice, "ai_settings")) === 0);
for (const t of ["ai_conversations", "ai_messages", "ai_usage_events", "ai_settings", "ai_beta_access", "ai_feedback"]) {
  check(`anon reads nothing from ${t}`, (await count("anon", null, t)) === 0);
}
check("admin reads all conversations", (await count("authenticated", U.admin, "ai_conversations")) === 2);
check("admin reads usage", (await count("authenticated", U.admin, "ai_usage_events")) === 4);
check("admin reads settings", (await count("authenticated", U.admin, "ai_settings")) === 1);

// ------------------------------------------------------------------ RLS: writes are server-only
const rowsAfter = async (sql) => Number((await db.query(sql)).rows[0].n);
await errOf(() => as("authenticated", U.alice, `insert into ai_conversations (user_id, profile_id) values ('${U.alice}','${P.alice}')`));
check("owner cannot insert conversations directly", (await rowsAfter(`select count(*)::int n from ai_conversations`)) === 2);
await errOf(() => as("authenticated", U.alice, `insert into ai_messages (conversation_id, role, content) values ('e0000000-0000-4000-8000-000000000001','assistant','forged')`));
check("owner cannot forge assistant messages", (await rowsAfter(`select count(*)::int n from ai_messages`)) === 3);
await errOf(() => as("authenticated", U.alice, `insert into ai_beta_access (user_id) values ('${U.bob}')`));
check("owner cannot grant beta access", (await rowsAfter(`select count(*)::int n from ai_beta_access`)) === 1);
await errOf(() => as("authenticated", U.alice, `update ai_settings set enabled = true, daily_message_limit = 1000`));
check("owner cannot change settings", (await db.query(`select enabled from ai_settings`)).rows[0].enabled === false);
await errOf(() => as("authenticated", U.alice, `delete from ai_usage_events`));
check("owner cannot erase usage (limits can't be reset)", (await rowsAfter(`select count(*)::int n from ai_usage_events`)) === 4);
await errOf(() => as("authenticated", U.alice, `update ai_messages set content='edited'`));
check("owner cannot edit stored messages", (await rowsAfter(`select count(*)::int n from ai_messages where content='edited'`)) === 0);
await errOf(() => as("authenticated", U.admin, `update ai_settings set enabled = true`));
check("even an admin session can't write settings directly (server route only)", (await db.query(`select enabled from ai_settings`)).rows[0].enabled === false);
await errOf(() => as("authenticated", U.alice, `delete from ai_conversations where id='e0000000-0000-4000-8000-000000000002'`));
check("alice cannot delete bob's conversation", (await rowsAfter(`select count(*)::int n from ai_conversations where user_id='${U.bob}'`)) === 1);

// ------------------------------------------------------------------ quota function
check(
  "authenticated cannot call ai_quota_snapshot",
  (await errOf(() => as("authenticated", U.alice, `select * from ai_quota_snapshot('${U.bob}')`))) !== null
);
check("anon cannot call ai_quota_snapshot", (await errOf(() => as("anon", null, `select * from ai_quota_snapshot('${U.bob}')`))) !== null);
const q = (await as("service_role", null, `select * from ai_quota_snapshot('${U.alice}')`)).rows[0];
check("quota: requests in last 24h counts ok+error, excludes older", Number(q.user_requests_24h) === 2, JSON.stringify(q));
const monthStartIsRecent = (await db.query(`select (now() - interval '30 hours') >= date_trunc('month', now() at time zone 'utc') at time zone 'utc' as x`)).rows[0].x;
check(
  "quota: monthly tokens include cache tokens",
  Number(q.user_tokens_month) === 1160 + (monthStartIsRecent ? 2 : 0),
  JSON.stringify(q)
);
check("quota: global monthly cost sums every user", Math.abs(Number(q.global_cost_month) - (1.5 + (monthStartIsRecent ? 0.25 : 0))) < 1e-9, JSON.stringify(q));

// ------------------------------------------------------------------ constraints
const bad = async (sql) => (await errOf(() => db.exec(sql))) !== null;
check("message content max length enforced", await bad(`insert into ai_messages (conversation_id, role, content) values ('e0000000-0000-4000-8000-000000000001','user', repeat('x', 16001))`));
check("empty message rejected", await bad(`insert into ai_messages (conversation_id, role, content) values ('e0000000-0000-4000-8000-000000000001','user','')`));
check("message role limited to user/assistant", await bad(`insert into ai_messages (conversation_id, role, content) values ('e0000000-0000-4000-8000-000000000001','system','x')`));
check("rating limited to -1/1", await bad(`insert into ai_feedback (message_id, user_id, rating) values ('f0000000-0000-4000-8000-000000000003','${U.bob}',5)`));
check("settings ranges enforced", await bad(`update ai_settings set max_tool_rounds = 50`));
check("settings effort enum enforced", await bad(`update ai_settings set effort = 'max'`));

// ------------------------------------------------------------------ cascades
await db.exec(`delete from ai_conversations where id='e0000000-0000-4000-8000-000000000001'`);
check("deleting a conversation removes its messages and feedback", (await rowsAfter(`select count(*)::int n from ai_messages where conversation_id='e0000000-0000-4000-8000-000000000001'`)) === 0 && (await rowsAfter(`select count(*)::int n from ai_feedback`)) === 0);
check("deleting a conversation keeps usage events (limits can't be reset)", (await rowsAfter(`select count(*)::int n from ai_usage_events`)) === 4);

// ------------------------------------------------------------------ rollback
const beforeRollback = await snapshotExisting();
check("rollback applies", (await errOf(() => db.exec(ROLLBACK))) === null);
const leftovers = (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'ai\\_%'
  union all select proname from pg_proc where proname like 'ai\\_%'`)).rows;
check("rollback removes every Ringo AI object", leftovers.length === 0, JSON.stringify(leftovers));
check("rollback leaves pre-existing objects untouched", beforeRollback === (await snapshotExisting()));
check("rollback leaves existing data untouched", (await rowsAfter(`select count(*)::int n from profiles`)) === 2 && (await rowsAfter(`select count(*)::int n from users`)) === 3);

const failed = results.filter((r) => !r.pass);
console.log(`\nringo_ai_foundation: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
