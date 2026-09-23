// Test for supabase/migrations/2026-10-26_ringo_ai_quota_reservations.sql
//
// Runs on a throwaway, local, REAL PostgreSQL server (embedded-postgres) — real, because the point is to
// prove behaviour under genuinely concurrent transactions on separate connections, which the single-
// connection in-memory PGlite used by the other Ringo AI test cannot do. It never connects to Supabase or
// any real database, and uses no real credentials (the local server's password is a fixed test value).
//
// It applies the ACTUAL foundation + reservation migration, verify and rollback files to a Supabase-shaped
// database (anon / authenticated / service_role roles, auth.uid(), is_admin()), then checks:
//   * the migration is idempotent and purely additive (pre-existing and foundation objects unchanged)
//   * both verify scripts pass
//   * only the server (service_role) can reserve; users can't call it, write reservations or read others'
//   * CONCURRENCY: N simultaneous reservations on N separate connections can never collectively exceed
//       - the daily message limit, - the monthly user token limit, - the global monthly budget (across users)
//     including with an artificially widened race window (pg_sleep injected before the insert, in memory)
//   * released and expired reservations stop counting; settled usage counts the ACTUAL tokens, not the estimate
//   * budget not enforced when pricing is unset (null); invalid arguments rejected
//   * the rollback removes only this migration's objects
//
// MUT=no_lock removes the advisory lock IN MEMORY ONLY (never on disk) to prove the concurrency checks can fail.
//
//   Setup (outside the repo is fine; nothing is added to package.json):
//     npm install --no-save embedded-postgres pg          (or install them anywhere and set PG_MODULES_DIR)
//   Run:  node supabase/support/tests/ringo_ai_quota_reservations.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const req = createRequire(process.env.PG_MODULES_DIR ? path.join(process.env.PG_MODULES_DIR, "noop.js") : import.meta.url);
const EmbeddedPostgres = req("embedded-postgres").default ?? req("embedded-postgres");
const pg = req("pg");

const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const FOUNDATION = read("supabase/migrations/2026-10-25_ringo_ai_foundation.sql");
const FOUNDATION_VERIFY = read("supabase/support/2026-10-25_ringo_ai_foundation.verify.sql");
const SOURCE = read("supabase/migrations/2026-10-26_ringo_ai_quota_reservations.sql");
const VERIFY = read("supabase/support/2026-10-26_ringo_ai_quota_reservations.verify.sql");
const ROLLBACK = read("supabase/support/2026-10-26_ringo_ai_quota_reservations.rollback.sql");

const LOCK_LINE = "perform pg_advisory_xact_lock(hashtextextended('ringo_ai_quota', 0));";
const INSERT_LINE = "insert into public.ai_quota_reservations (user_id, reserved_tokens, reserved_cost_usd, expires_at)";
if (!SOURCE.includes(LOCK_LINE) || !SOURCE.includes(INSERT_LINE)) throw new Error("test anchors not found in migration");
const MIGRATION = process.env.MUT === "no_lock" ? SOURCE.replace(LOCK_LINE, "") : SOURCE;
// Same function with a 150ms pause between reading usage and inserting the reservation: if the lock
// didn't serialize check+insert, every concurrent caller would read the same "remaining" and pass.
const WIDE_RACE = MIGRATION.replace(INSERT_LINE, "perform pg_sleep(0.15);\n  " + INSERT_LINE);

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
const U = { alice: UID(1), bob: UID(2), admin: UID(3), carol: UID(4), dan: UID(5) };
const PORT = 54000 + Math.floor(Math.random() * 900);
const DATA_DIR = path.join(fs.mkdtempSync(path.join((await import("os")).tmpdir(), "ringo-ai-quota-")), "data");
const conn = { host: "localhost", port: PORT, user: "postgres", password: "local-test-only", database: "postgres" };

const server = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: conn.user, password: conn.password, port: PORT, persistent: false, onLog: () => {} });
await server.initialise();
await server.start();

const db = new pg.Client(conn);
await db.connect();
// Every connection the server uses runs as service_role (bypasses RLS, like createAdminClient()).
const pool = new pg.Pool({ ...conn, max: 30, options: "-c role=service_role" });

try {
  await db.query(`
    create extension if not exists pgcrypto;
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
    insert into public.users (id, email, role) values
      ('${U.alice}','alice@x.test','creator'), ('${U.bob}','bob@x.test','creator'), ('${U.admin}','admin@x.test','admin'),
      ('${U.carol}','carol@x.test','creator'), ('${U.dan}','dan@x.test','creator');
  `);
  await db.query(FOUNDATION);

  const as = async (role, sub, sql) => {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
      return await c.query(sql);
    } finally {
      await c.query(`reset role; select set_config('request.jwt.claim.sub','', false); set role service_role;`);
      c.release();
    }
  };

  const snapshotExisting = async () =>
    JSON.stringify(
      (
        await db.query(`
        select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default,'') as x
          from information_schema.columns where table_schema = 'public' and table_name <> 'ai_quota_reservations'
        union all select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
          where connamespace = 'public'::regnamespace and conrelid::regclass::text <> 'ai_quota_reservations'
        union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies where tablename <> 'ai_quota_reservations'
        union all select 'fn:' || p.proname || ':' || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','auth') and p.proname <> 'ai_reserve_quota'
        union all select 'acl:' || p.proname || ':' || coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname <> 'ai_reserve_quota'
        order by 1`)
      ).rows.map((r) => r.x)
    );

  // ---------------------------------------------------------------- static: purely additive
  const stripped = SOURCE.replace(/--.*$/gm, "");
  check("migration never ALTERs a pre-existing table", !/alter\s+table\s+(?!(if\s+exists\s+)?public\.ai_quota_reservations)/i.test(stripped));
  check("migration never DROPs anything", !/\bdrop\s+(table|column|function|policy|trigger|index|constraint)\b/i.test(stripped));
  check("migration never redefines ai_quota_snapshot", !/function\s+public\.ai_quota_snapshot/i.test(stripped));
  check(
    "migration only deletes from its own table",
    [...stripped.matchAll(/delete\s+from\s+([\w.]+)/gi)].every((m) => m[1] === "public.ai_quota_reservations")
  );

  // ---------------------------------------------------------------- apply (twice: idempotent)
  const before = await snapshotExisting();
  check("migration applies", (await errOf(() => db.query(MIGRATION))) === null);
  check("migration re-applies cleanly (idempotent)", (await errOf(() => db.query(MIGRATION))) === null);
  check("pre-existing + foundation tables/constraints/policies/functions/grants unchanged", before === (await snapshotExisting()));

  const verifyRows = (await db.query(VERIFY)).rows;
  check("verify script: every check ok", verifyRows.length >= 7 && verifyRows.every((r) => r.ok === true), JSON.stringify(verifyRows.filter((r) => !r.ok)));
  const fvRows = (await db.query(FOUNDATION_VERIFY.split(/;\s*\n\s*-- Informational/)[0])).rows;
  check("foundation verify still passes with the new table present", fvRows.length > 0 && fvRows.every((r) => r.ok === true), JSON.stringify(fvRows.filter((r) => !r.ok)));

  // ---------------------------------------------------------------- helpers
  const reserve = (client, { user, daily = 30, monthly = 3_000_000, budget = 50, tokens = 120_000, cost = 0.5, ttl = 120 }) =>
    client
      .query(`select * from ai_reserve_quota($1, $2, $3, $4, $5, $6, $7)`, [user, daily, monthly, budget, tokens, cost, ttl])
      .then((r) => r.rows[0]);
  const reset = () =>
    db.query(`set role service_role; delete from ai_quota_reservations; delete from ai_usage_events; reset role;`);
  const usage = (user, { n = 1, tokens = 0, cost = null, at = "now()" } = {}) =>
    db.query(
      `set role service_role;
       insert into ai_usage_events (user_id, provider, model, status, input_tokens, cost_usd, created_at)
       select '${user}', 'anthropic', 'm', 'ok', ${tokens}, ${cost === null ? "null" : cost}, ${at} from generate_series(1, ${n});
       reset role;`
    );
  // N reservations fired at once, each on its own connection.
  const burst = async (n, argsFor) => {
    const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
    try {
      return await Promise.all(clients.map((c, i) => reserve(c, argsFor(i))));
    } finally {
      clients.forEach((c) => c.release());
    }
  };
  const granted = (rows) => rows.filter((r) => r.reservation_id).length;

  // ---------------------------------------------------------------- access control
  await reset();
  check("anon cannot reserve", (await errOf(() => as("anon", null, `select * from ai_reserve_quota('${U.alice}', 30, 3000000, 50, 1, 0, 60)`))) !== null);
  check(
    "a signed-in user cannot reserve (even for themselves)",
    (await errOf(() => as("authenticated", U.alice, `select * from ai_reserve_quota('${U.alice}', 30, 3000000, 50, 1, 0, 60)`))) !== null
  );
  check(
    "a signed-in user cannot insert a reservation",
    (await errOf(() => as("authenticated", U.alice, `insert into ai_quota_reservations (user_id, reserved_tokens, expires_at) values ('${U.alice}', 0, now() + interval '1 minute')`))) !== null
  );
  const aliceRes = await reserve(pool, { user: U.alice });
  check("service role can reserve", !!aliceRes.reservation_id && aliceRes.deny_reason === null);
  check("users cannot read reservations (even their own)", (await as("authenticated", U.alice, `select id from ai_quota_reservations`)).rows.length === 0);
  check(
    "users cannot delete reservations",
    (await as("authenticated", U.alice, `delete from ai_quota_reservations returning id`)).rows.length === 0 &&
      Number((await db.query(`select count(*)::int n from ai_quota_reservations`)).rows[0].n) === 1
  );
  check("admins can read reservations", (await as("authenticated", U.admin, `select id from ai_quota_reservations`)).rows.length === 1);

  // ---------------------------------------------------------------- invalid arguments
  check("null user rejected", (await errOf(() => reserve(pool, { user: null }))) !== null);
  check("negative reserve rejected", (await errOf(() => reserve(pool, { user: U.alice, tokens: -1 }))) !== null);
  check("ttl out of range rejected", (await errOf(() => reserve(pool, { user: U.alice, ttl: 100000 }))) !== null);

  const concurrency = async (label) => {
    // Daily limit 5, 2 already used in the last 24h (+1 older one that must not count) → exactly 3 of 20 pass.
    await reset();
    await usage(U.alice, { n: 2 });
    await usage(U.alice, { n: 1, at: "now() - interval '25 hours'" });
    let rows = await burst(20, () => ({ user: U.alice, daily: 5 }));
    check(`${label}: daily limit — 20 simultaneous requests, exactly the 3 remaining pass`, granted(rows) === 3, `granted=${granted(rows)}`);
    check(`${label}: daily limit — the rest are refused as daily_limit`, rows.filter((r) => r.deny_reason === "daily_limit").length === 17);

    // Monthly tokens: limit 1,000,000, 700,000 used, each reservation 120,000 → 700k, 820k, 940k admitted; 1.06M refused.
    await reset();
    await usage(U.alice, { tokens: 700_000 });
    rows = await burst(15, () => ({ user: U.alice, daily: 1000, monthly: 1_000_000, tokens: 120_000 }));
    check(`${label}: monthly token limit — exactly 3 of 15 pass`, granted(rows) === 3, `granted=${granted(rows)}`);
    check(`${label}: monthly token limit — the rest are refused as monthly_limit`, rows.filter((r) => r.deny_reason === "monthly_limit").length === 12);

    // Global budget across DIFFERENT users: $10 budget, $8 already spent, $0.50 per reservation → 4 pass in total.
    await reset();
    await usage(U.bob, { cost: 8 });
    const users = [U.alice, U.bob, U.carol, U.dan];
    rows = await burst(24, (i) => ({ user: users[i % users.length], daily: 1000, budget: 10, cost: 0.5 }));
    check(`${label}: global budget — 24 simultaneous requests from 4 users, exactly 4 pass`, granted(rows) === 4, `granted=${granted(rows)}`);
    check(`${label}: global budget — the rest are refused as budget_reached`, rows.filter((r) => r.deny_reason === "budget_reached").length === 20);
  };
  await concurrency("real function");
  await db.query(WIDE_RACE);
  await concurrency("150ms race window");
  await db.query(MIGRATION); // restore the real function body

  // ---------------------------------------------------------------- lifecycle: release, expiry, settlement
  await reset();
  const a = await reserve(pool, { user: U.alice, daily: 1 });
  const b = await reserve(pool, { user: U.alice, daily: 1 });
  check("second request refused while the first is in flight", !!a.reservation_id && b.deny_reason === "daily_limit");
  await pool.query(`delete from ai_quota_reservations where id = $1`, [a.reservation_id]);
  const c = await reserve(pool, { user: U.alice, daily: 1 });
  check("released reservation (request ended with no model call) no longer counts", !!c.reservation_id);

  await reset();
  await reserve(pool, { user: U.alice, daily: 1, ttl: 1 });
  await db.query(`select pg_sleep(1.2)`);
  const afterExpiry = await reserve(pool, { user: U.alice, daily: 1 });
  check("expired reservation (request died without releasing) stops counting", !!afterExpiry.reservation_id);
  check("expired reservations are cleaned up", Number((await db.query(`select count(*)::int n from ai_quota_reservations`)).rows[0].n) === 1);

  // Settlement = the server records ACTUAL usage then releases: the estimate must not linger or double count.
  // (Semantics match checkAiQuota: refused once used + in-flight reaches the limit.)
  await reset();
  const r1 = await reserve(pool, { user: U.alice, monthly: 1_000_000, tokens: 1_000_000 });
  const blocked = await reserve(pool, { user: U.alice, monthly: 1_000_000, tokens: 1_000_000 });
  await usage(U.alice, { tokens: 5_000 });
  await pool.query(`delete from ai_quota_reservations where id = $1`, [r1.reservation_id]);
  const snap = (await db.query(`set role service_role; select * from ai_quota_snapshot('${U.alice}');`))[1].rows[0];
  await db.query(`reset role`);
  const next = await reserve(pool, { user: U.alice, monthly: 1_000_000, tokens: 1_000_000 });
  check("estimate blocks while in flight", !!r1.reservation_id && blocked.deny_reason === "monthly_limit");
  check("after settlement only the actual 5,000 tokens count (not the 1,000,000 estimate)", Number(snap.user_tokens_month) === 5000 && !!next.reservation_id);
  check("settled request counts once toward the daily limit", Number(snap.user_requests_24h) === 1);

  // Budget null = pricing not configured = budget not enforced (existing behaviour).
  await reset();
  await usage(U.bob, { cost: 999 });
  check("budget not enforced when pricing is unset (null budget)", !!(await reserve(pool, { user: U.alice, budget: null, cost: null })).reservation_id);
  check("budget enforced when set", (await reserve(pool, { user: U.alice, budget: 50 })).deny_reason === "budget_reached");

  // Deleting an account removes its reservations (cascade); other users unaffected.
  await reset();
  await reserve(pool, { user: U.dan });
  await reserve(pool, { user: U.carol });
  await db.query(`delete from public.users where id = '${U.dan}'`);
  check("account deletion cascades its reservations only", Number((await db.query(`select count(*)::int n from ai_quota_reservations`)).rows[0].n) === 1);

  // ---------------------------------------------------------------- rollback
  await reset();
  const beforeRollback = await snapshotExisting();
  check("rollback applies", (await errOf(() => db.query(ROLLBACK))) === null);
  const gone = (await db.query(`select to_regclass('public.ai_quota_reservations') t, to_regprocedure('public.ai_reserve_quota(uuid,int,bigint,numeric,bigint,numeric,int)') f`)).rows[0];
  check("rollback removes the table and function", gone.t === null && gone.f === null);
  check("rollback leaves every other object unchanged", beforeRollback === (await snapshotExisting()));
} finally {
  await pool.end().catch(() => {});
  await db.end().catch(() => {});
  await server.stop().catch(() => {});
  fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\nringo_ai_quota_reservations${process.env.MUT ? ` [MUT=${process.env.MUT}]` : ""}: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
