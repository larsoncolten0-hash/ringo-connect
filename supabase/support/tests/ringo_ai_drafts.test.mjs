// Test for supabase/migrations/2026-10-27_ringo_ai_drafts.sql
//
// Runs on a throwaway, local, REAL PostgreSQL server (embedded-postgres; see
// ringo_ai_quota_reservations.test.mjs for why real) — never Supabase, no real credentials.
// Applies the ACTUAL foundation + drafts migration, verify and rollback files to a Supabase-shaped database
// with Ringo's own profiles/products/events RLS policies (copied from schema.sql / music_entertainment.sql),
// then checks:
//   * migration idempotent and purely additive (every pre-existing object unchanged); verify passes
//   * RLS: owners read only their own drafts/audit rows; nobody but the server writes them; admins read
//   * ai_claim_draft: service-role only; scoped by user + profile; revision / expiry / stale / applied / rejected
//   * terminal states are immutable (trigger); identity columns immutable
//   * CONCURRENCY: 20 simultaneous "Confirm & Apply" on 20 connections → exactly ONE claim, ONE product
//   * the apply write through the owner's session obeys Ringo's RLS (another user can't write the profile)
//   * retrying an insert with the draft's target_id can't duplicate (primary key)
//   * events created by drafts stay 'draft' (unpublished)
//   * deleting a conversation removes its drafts; the audit trail survives
//   * the rollback removes only this migration's objects
//
// MUT=no_lock removes the row lock IN MEMORY ONLY to prove the concurrency check can fail.
//
//   Setup:  npm install --no-save embedded-postgres pg     (or set PG_MODULES_DIR to where they're installed)
//   Run:    node supabase/support/tests/ringo_ai_drafts.test.mjs
import fs from "fs";
import os from "os";
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
const SOURCE = read("supabase/migrations/2026-10-27_ringo_ai_drafts.sql");
const VERIFY = read("supabase/support/2026-10-27_ringo_ai_drafts.verify.sql");
const ROLLBACK = read("supabase/support/2026-10-27_ringo_ai_drafts.rollback.sql");
const LOCK = "   for update;";
if (!SOURCE.includes(LOCK)) throw new Error("test anchor not found");
const PRODUCT_LOCK = "  perform pg_advisory_xact_lock(hashtextextended('ringo_ai_product_limit:' || p_profile_id::text, 0));";
const PROFILE_LOCK = "where id = p_profile_id and user_id = v_uid for update;";
const PRODUCT_COUNT = "  select count(*)::int into v_count from public.products where profile_id = p_profile_id;";
for (const anchor of [PRODUCT_LOCK, PROFILE_LOCK, PRODUCT_COUNT]) if (!SOURCE.includes(anchor)) throw new Error(`test anchor not found: ${anchor}`);
// Mutations (IN MEMORY ONLY, never on disk) that remove one lock each, to prove each race test can fail:
//   MUT=no_lock          → the draft claim's row lock
//   MUT=no_product_lock  → the per-profile product-limit lock
//   MUT=no_profile_lock  → the profile row lock of the compare-and-set
const MIGRATION = {
  no_lock: SOURCE.replace(LOCK, ";"),
  no_product_lock: SOURCE.replace(PRODUCT_LOCK, ""),
  no_profile_lock: SOURCE.replace(PROFILE_LOCK, "where id = p_profile_id and user_id = v_uid;"),
}[process.env.MUT] ?? SOURCE;
// Same function with a 150ms pause between reading the draft and claiming it: without the row lock,
// every concurrent confirm would read "awaiting_confirmation" and claim it.
const CLAIM_POINT = "  -- awaiting_confirmation, failed (retry) or an abandoned 'applying'.";
if (!SOURCE.includes(CLAIM_POINT)) throw new Error("test anchor not found");
const WIDE_RACE = MIGRATION.replace(CLAIM_POINT, "  perform pg_sleep(0.15);\n" + CLAIM_POINT);

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
    return e.code || e.message.split("\n")[0];
  }
};

const ID = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: ID("c", 1), bob: ID("c", 2), admin: ID("c", 3) };
const PR = { alice: ID("a", 1), bob: ID("a", 2) };
const CONV = { alice: ID("e", 1), bob: ID("e", 2) };
const PORT = 55000 + Math.floor(Math.random() * 900);
const DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ringo-ai-drafts-")), "data");
const conn = { host: "localhost", port: PORT, user: "postgres", password: "local-test-only", database: "postgres" };

// UTF-8 like Supabase (a Windows default code page would reject non-ASCII characters in the migration).
const server = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: conn.user, password: conn.password, port: PORT, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {} });
await server.initialise();
await server.start();
const db = new pg.Client({ ...conn, options: "-c statement_timeout=30000" });
await db.connect();
const pool = new pg.Pool({ ...conn, max: 30, options: "-c role=service_role -c statement_timeout=30000" });
const step = (label) => process.stderr.write(`[step] ${label}
`);

try {
  await db.query(`
    create extension if not exists pgcrypto;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to public;
    -- Ringo's own tables + policies, as in schema.sql / 2026-09-13_music_entertainment.sql / 2026-09-21_event_ticket_types.sql
    create table public.plans (id uuid primary key default gen_random_uuid(), name text not null unique, max_products int);
    alter table public.plans enable row level security;
    create policy "plans are publicly readable" on plans for select using (true);
    insert into public.plans (name, max_products) values ('free', 3), ('locked', 0), ('unlimited', null);
    create table public.users (id uuid primary key, email text not null, role text not null default 'creator',
      plan_id uuid references plans(id));
    create function public.is_admin() returns boolean language sql security definer set search_path = public as $$
      select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
    alter table public.users enable row level security;
    create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
    create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade,
      username text not null unique, name text, bio text, category text, categories text[] not null default '{}',
      currency text, published boolean not null default true, verified boolean not null default false,
      about_long_bio text, about_location text, music_role text, restaurant_subcategory text,
      whatsapp_number text, about_phone text, about_email text);
    alter table public.profiles enable row level security;
    create policy "profiles are publicly readable" on profiles for select using (published = true or auth.uid() = user_id or is_admin());
    create policy "profiles update by owner or admin" on profiles for update using (auth.uid() = user_id or is_admin());
    create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references profiles(id) on delete cascade,
      name text not null, price numeric(10,2), description text, available boolean not null default true, sort_order int not null default 0);
    alter table public.products enable row level security;
    create policy "products public read" on products for select using (true);
    create policy "products owner write" on products for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
    create table public.events (id uuid primary key default gen_random_uuid(), profile_id uuid not null references profiles(id) on delete cascade,
      title text not null, location text, event_date date, event_time text, sort_order int not null default 0,
      status text not null default 'published' check (status in ('draft', 'published', 'cancelled', 'completed')));
    alter table public.events enable row level security;
    create policy "events public read" on events for select using (true);
    create policy "events owner write" on events for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
    insert into public.users (id, email, role, plan_id)
      select v.id, v.email, v.role, (select id from plans where name = 'unlimited')
        from (values ('${U.alice}'::uuid,'alice@x.test','creator'), ('${U.bob}'::uuid,'bob@x.test','creator'), ('${U.admin}'::uuid,'admin@x.test','admin')) v(id, email, role);
    insert into public.profiles (id, user_id, username, name, category, currency) values
      ('${PR.alice}','${U.alice}','alice','Alice','music_entertainment','XAF'), ('${PR.bob}','${U.bob}','bob','Bob','business_ecommerce','XAF');
  `);
  await db.query(FOUNDATION);
  await db.query(`set role service_role;
    insert into ai_conversations (id, user_id, profile_id) values ('${CONV.alice}','${U.alice}','${PR.alice}'), ('${CONV.bob}','${U.bob}','${PR.bob}');
    reset role;`);

  const as = async (role, sub, sql, params) => {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
      return await c.query(sql, params);
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
          from information_schema.columns where table_schema = 'public' and table_name not in ('ai_drafts','ai_draft_events')
        union all select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
          where connamespace = 'public'::regnamespace and conrelid::regclass::text not in ('ai_drafts','ai_draft_events')
        union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies where tablename not in ('ai_drafts','ai_draft_events')
        union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text <> 'ai_drafts'
        union all select 'fn:' || p.proname || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','auth') and p.proname not in ('ai_claim_draft','ai_drafts_guard_terminal','ai_create_product_within_limit','ai_apply_profile_update')
        order by 1`)
      ).rows.map((r) => r.x)
    );

  // ---------------------------------------------------------------- static + apply
  const stripped = SOURCE.replace(/--.*$/gm, "");
  check("migration never ALTERs a pre-existing table", !/alter\s+table\s+(?!(if\s+exists\s+)?public\.ai_draft)/i.test(stripped));
  check("migration never DROPs anything", !/\bdrop\s+(table|column|function|policy|trigger|index|constraint)\b/i.test(stripped));
  // The apply functions legitimately READ/WRITE profiles and products AS THE OWNER (that's the point), so
  // this checks the migration never alters their DEFINITIONS: no ALTER, no new policy/trigger/index/grant
  // on them. (The before/after snapshot below additionally proves every existing object is unchanged.)
  check(
    "migration never changes the definition of profiles/products/events (no alter/policy/trigger/index/grant on them)",
    !/(alter\s+table|create\s+(policy|trigger|index)[^;]*\bon|grant[^;]*\bon\s+table)\s+(if\s+exists\s+)?(public\.)?(profiles|products|events)\b/i.test(stripped) &&
      !/create\s+(policy|trigger)[^;]*\bon\s+(public\.)?(profiles|products|events)\b/i.test(stripped)
  );
  check("apply functions are SECURITY INVOKER (never definer — RLS and the demo-flag guard must apply)", !/security\s+definer/i.test(stripped));
  const before = await snapshotExisting();
  check("migration applies", (await errOf(() => db.query(MIGRATION))) === null);
  check("migration re-applies cleanly (idempotent)", (await errOf(() => db.query(MIGRATION))) === null);
  check("every pre-existing table/constraint/policy/trigger/function unchanged", before === (await snapshotExisting()));
  const vr = (await db.query(VERIFY)).rows;
  check("verify script: every check ok", vr.length >= 10 && vr.every((r) => r.ok === true), JSON.stringify(vr.filter((r) => !r.ok)));
  const fv = (await db.query(FOUNDATION_VERIFY.split(/;\s*\n\s*-- Informational/)[0])).rows;
  check("foundation verify still passes (incl. no write policies on ai_* tables)", fv.every((r) => r.ok === true), JSON.stringify(fv.filter((r) => !r.ok)));

  // ---------------------------------------------------------------- helpers
  let seq = 0;
  const newDraft = async ({ user = U.alice, profile = PR.alice, conv = CONV.alice, type = "product.create", status = "awaiting_confirmation", payload = { name: "Tee", price: 5000, currency: "XAF", description: null }, expires = "now() + interval '7 days'" } = {}) => {
    const r = await pool.query(
      `insert into ai_drafts (user_id, profile_id, conversation_id, draft_type, status, payload, summary, expires_at)
       values ($1,$2,$3,$4,$5,$6,'s', ${expires}) returning id, target_id, revision`,
      [user, profile, conv, type, status, payload]
    );
    seq += 1;
    return r.rows[0];
  };
  const claim = (c, id, user = U.alice, profile = PR.alice, revision = 1, staleAfter = 120) =>
    c.query(`select * from ai_claim_draft($1,$2,$3,$4,$5)`, [id, user, profile, revision, staleAfter]).then((r) => r.rows[0]);
  const statusOf = async (id) => (await pool.query(`select status from ai_drafts where id = $1`, [id])).rows[0]?.status;

  // ---------------------------------------------------------------- RLS on drafts
  const d1 = await newDraft();
  await newDraft({ user: U.bob, profile: PR.bob, conv: CONV.bob });
  await pool.query(`insert into ai_draft_events (draft_id, user_id, profile_id, draft_type, action) values ($1,$2,$3,'product.create','created')`, [d1.id, U.alice, PR.alice]);
  check("owner reads only their own drafts", (await as("authenticated", U.alice, `select user_id from ai_drafts`)).rows.every((r) => r.user_id === U.alice));
  check("another user can't read them", (await as("authenticated", U.bob, `select id from ai_drafts where id = '${d1.id}'`)).rows.length === 0);
  check("anon reads nothing", (await as("anon", null, `select id from ai_drafts`)).rows.length === 0);
  check("owner can't insert drafts from the browser", (await errOf(() => as("authenticated", U.alice, `insert into ai_drafts (user_id, profile_id, conversation_id, draft_type, payload, summary) values ('${U.alice}','${PR.alice}','${CONV.alice}','product.create','{}','x')`))) !== null);
  check("owner can't change a draft's status from the browser", (await as("authenticated", U.alice, `update ai_drafts set status = 'applied' where id = '${d1.id}' returning id`)).rows.length === 0 && (await statusOf(d1.id)) === "awaiting_confirmation");
  check("owner can't delete drafts from the browser", (await as("authenticated", U.alice, `delete from ai_drafts where id = '${d1.id}' returning id`)).rows.length === 0);
  check("owner reads own audit rows; others can't", (await as("authenticated", U.alice, `select id from ai_draft_events`)).rows.length === 1 && (await as("authenticated", U.bob, `select id from ai_draft_events`)).rows.length === 0);
  check("admin reads all drafts", (await as("authenticated", U.admin, `select id from ai_drafts`)).rows.length >= 2);
  check("anon/authenticated can't call ai_claim_draft", (await errOf(() => as("authenticated", U.alice, `select * from ai_claim_draft('${d1.id}','${U.alice}','${PR.alice}',1,120)`))) !== null && (await errOf(() => as("anon", null, `select * from ai_claim_draft('${d1.id}','${U.alice}','${PR.alice}',1,120)`))) !== null);

  // ---------------------------------------------------------------- claim semantics
  check("claim by another user → not_found", (await claim(pool, d1.id, U.bob, PR.bob)).outcome === "not_found");
  check("claim with the right user but another profile → not_found", (await claim(pool, d1.id, U.alice, PR.bob)).outcome === "not_found");
  check("claim with a stale revision → revision_mismatch (owner must re-review)", (await claim(pool, d1.id, U.alice, PR.alice, 2)).outcome === "revision_mismatch");
  const c1 = await claim(pool, d1.id);
  check("claim → claimed, returns payload + target_id; status applying", c1.outcome === "claimed" && c1.target_id === d1.target_id && (await statusOf(d1.id)) === "applying");
  check("second claim while applying → in_progress", (await claim(pool, d1.id)).outcome === "in_progress");
  await pool.query(`update ai_drafts set confirmed_at = now() - interval '10 minutes' where id = $1`, [d1.id]);
  check("abandoned 'applying' (server died) can be re-claimed after the window", (await claim(pool, d1.id)).outcome === "claimed");
  await pool.query(`update ai_drafts set status = 'applied', applied_at = now(), result_id = target_id where id = $1`, [d1.id]);
  check("replay of an applied draft → applied (never re-applied)", (await claim(pool, d1.id)).outcome === "applied");
  check("applied draft is immutable (trigger)", (await errOf(() => pool.query(`update ai_drafts set status = 'awaiting_confirmation' where id = $1`, [d1.id]))) === "55000");
  const dRej = await newDraft({ status: "rejected" });
  check("discarded draft → rejected, and immutable", (await claim(pool, dRej.id)).outcome === "rejected" && (await errOf(() => pool.query(`update ai_drafts set status = 'awaiting_confirmation' where id = $1`, [dRej.id]))) === "55000");
  const dExp = await newDraft({ expires: "now() + interval '1 second'" });
  await pool.query(`select pg_sleep(1.1)`);
  check("expired draft → expired (and marked)", (await claim(pool, dExp.id)).outcome === "expired" && (await statusOf(dExp.id)) === "expired");
  const dStale = await newDraft({ status: "stale" });
  check("stale draft can't be applied", (await claim(pool, dStale.id)).outcome === "stale");
  const dFail = await newDraft({ status: "failed" });
  check("failed draft can be retried (claimed again)", (await claim(pool, dFail.id)).outcome === "claimed");
  const dOwn = await newDraft();
  check("ownership columns are immutable", (await errOf(() => pool.query(`update ai_drafts set user_id = $2 where id = $1`, [dOwn.id, U.bob]))) === "55000");

  // ---------------------------------------------------------------- CONCURRENCY: 20 × Confirm & Apply
  const applyOnce = async (c, d) => {
    const r = await claim(c, d.id);
    if (r.outcome !== "claimed") return r.outcome;
    // The owner's session write (RLS as alice), exactly what productCreate.apply does.
    await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${U.alice}', false);`);
    try {
      await c.query(`insert into products (id, profile_id, name, price, available, sort_order) values ($1,$2,'Tee',5000,true,0)`, [r.target_id, PR.alice]);
    } catch (e) {
      return `claimed:insert_error_${e.code}`;
    } finally {
      await c.query(`reset role; select set_config('request.jwt.claim.sub','', false); set role service_role;`);
    }
    await c.query(`update ai_drafts set status = 'applied', applied_at = now(), result_id = target_id where id = $1 and status = 'applying'`, [d.id]);
    return "claimed";
  };
  let race;
  for (const [label, fnSql] of [["real function", MIGRATION], ["150ms race window", WIDE_RACE]]) {
    await db.query(fnSql);
    race = await newDraft();
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    let outcomes;
    try {
      outcomes = await Promise.all(clients.map((c) => applyOnce(c, race).catch((e) => `error:${e.code}`)));
    } finally {
      clients.forEach((c) => c.release());
    }
    const productCount = Number((await pool.query(`select count(*)::int n from products where id = $1`, [race.target_id])).rows[0].n);
    check(`${label}: 20 simultaneous confirms → exactly ONE claim`, outcomes.filter((o) => o.startsWith("claimed")).length === 1 && outcomes.includes("claimed"), outcomes.join());
    check(`${label}: …exactly ONE product created (no duplicates)`, productCount === 1, String(productCount));
    check(`${label}: …the others were told in_progress / already applied`, outcomes.filter((o) => o !== "claimed").every((o) => o === "in_progress" || o === "applied"), outcomes.join());
    check(`${label}: …the draft ends applied`, (await statusOf(race.id)) === "applied");
  }
  await db.query(MIGRATION); // restore the real function body

  // ---------------------------------------------------------------- RLS stays the write boundary
  check("retrying the insert with the same target_id can't duplicate (23505)", (await errOf(() => as("authenticated", U.alice, `insert into products (id, profile_id, name) values ('${race.target_id}','${PR.alice}','Tee')`))) === "23505");
  check("another user's session can't create a product on alice's page", (await errOf(() => as("authenticated", U.bob, `insert into products (profile_id, name) values ('${PR.alice}','Hijack')`))) === "42501");
  check("another user's session can't update alice's profile (0 rows)", (await as("authenticated", U.bob, `update profiles set name = 'Hijacked' where id = '${PR.alice}' returning id`)).rows.length === 0);
  check("owner's session can update own profile (the apply path)", (await as("authenticated", U.alice, `update profiles set bio = 'New bio' where id = '${PR.alice}' and user_id = '${U.alice}' returning id`)).rows.length === 1);
  const evId = ID("f", 1);
  await as("authenticated", U.alice, `insert into events (id, profile_id, title, event_date, status) values ('${evId}','${PR.alice}','Afro Night','2026-10-10','draft')`);
  check("event created by a draft stays unpublished ('draft')", (await pool.query(`select status from events where id = $1`, [evId])).rows[0].status === "draft");

  // ---------------------------------------------------------------- PRODUCT PLAN LIMIT: atomic at apply time
  // ai_create_product_within_limit runs AS THE OWNER (authenticated + JWT sub), so "products owner write" RLS applies.
  const asOwner = async (c, uid) => c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}', false);`);
  const back = async (c) => c.query(`reset role; select set_config('request.jwt.claim.sub','', false); set role service_role;`);
  const createProduct = async (c, uid, profile, id = null) => {
    await asOwner(c, uid);
    try {
      return (await c.query(`select * from ai_create_product_within_limit(coalesce($1::uuid, gen_random_uuid()), $2, 'AI Tee', null, 5000)`, [id, profile])).rows[0];
    } finally {
      await back(c);
    }
  };
  const productsOf = async (profile) => Number((await pool.query(`select count(*)::int n from products where profile_id = $1`, [profile])).rows[0].n);
  const setPlan = (uid, plan) => db.query(`update users set plan_id = (select id from plans where name = $2) where id = $1`, [uid, plan]);

  check("anon can't call the product apply function", (await errOf(() => as("anon", null, `select * from ai_create_product_within_limit(gen_random_uuid(), '${PR.bob}', 'x', null, 1)`))) !== null);
  step("product limit");
  {
    const c = await pool.connect();
    try {
      check("another user can't create a product on bob's page through it (not_owner, nothing written)", (await createProduct(c, U.alice, PR.bob)).outcome === "not_owner" && (await productsOf(PR.bob)) === 0);
    } finally {
      c.release();
    }
  }
  await setPlan(U.bob, "locked");
  {
    const c = await pool.connect();
    try {
      check("plan max_products = 0 → catalog_locked, nothing written", (await createProduct(c, U.bob, PR.bob)).outcome === "catalog_locked" && (await productsOf(PR.bob)) === 0);
    } finally {
      c.release();
    }
  }
  await setPlan(U.bob, "free"); // max_products = 3
  await db.query(`insert into products (profile_id, name) values ($1,'Manual 1'), ($1,'Manual 2')`, [PR.bob]); // 2 of 3 used → ONE slot left
  const WIDE_PRODUCT = MIGRATION.replace(PRODUCT_COUNT, PRODUCT_COUNT + "\n  perform pg_sleep(0.15);");
  for (const [label, fnSql] of [["real function", MIGRATION], ["150ms race window", WIDE_PRODUCT]]) {
    await db.query(fnSql);
    await db.query(`delete from products where profile_id = $1 and name = 'AI Tee'`, [PR.bob]);
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    let outs;
    try {
      outs = await Promise.all(clients.map((c) => createProduct(c, U.bob, PR.bob).then((r) => r.outcome).catch((e) => `error:${e.code}`)));
    } finally {
      clients.forEach((c) => c.release());
    }
    const n = await productsOf(PR.bob);
    check(`${label}: ONE slot left + 20 simultaneous AI product confirms → exactly ONE created`, outs.filter((o) => o === "inserted").length === 1, outs.join());
    check(`${label}: …the other 19 are refused as limit_reached`, outs.filter((o) => o === "limit_reached").length === 19, outs.join());
    check(`${label}: …invariant holds: products on the page (${n}) <= plans.max_products (3)`, n === 3);
  }
  await db.query(MIGRATION); // restore the real function bodies
  {
    const c = await pool.connect();
    try {
      const fixedId = ID("b", 1);
      await setPlan(U.bob, "unlimited");
      const first = await createProduct(c, U.bob, PR.bob, fixedId);
      const again = await createProduct(c, U.bob, PR.bob, fixedId);
      check("retrying with the same draft target id → already_exists, no duplicate", first.outcome === "inserted" && again.outcome === "already_exists" && Number((await pool.query(`select count(*)::int n from products where id = $1`, [fixedId])).rows[0].n) === 1);
      check("unlimited plan (max_products null) → inserted", (await createProduct(c, U.bob, PR.bob)).outcome === "inserted");
      const row = (await pool.query(`select available from products where id = $1`, [fixedId])).rows[0];
      check("AI product is a normal, visible product (available = true — not misused as a hidden state)", row.available === true);
    } finally {
      c.release();
    }
  }

  step("profile compare-and-set");
  // ---------------------------------------------------------------- PROFILE: compare-and-set can't overwrite a newer manual edit
  const applyProfile = async (c, uid, patch, base) => {
    await asOwner(c, uid);
    try {
      return (await c.query(`select ai_apply_profile_update($1, $2, $3) as r`, [PR.alice, patch, base])).rows[0].r;
    } finally {
      await back(c);
    }
  };
  const nameOf = async () => (await pool.query(`select name from profiles where id = $1`, [PR.alice])).rows[0].name;
  await db.query(`update profiles set name = 'State A', bio = null, categories = '{music_entertainment}' where id = $1`, [PR.alice]);
  {
    const c = await pool.connect();
    try {
      // 1. Sequential: draft prepared on A, owner edits to B, then Confirm & Apply → stale, B kept.
      await as("authenticated", U.alice, `update profiles set name = 'Manual B' where id = '${PR.alice}'`); // the Dashboard's plain UPDATE
      check("manual edit after the draft → apply refuses as stale", (await applyProfile(c, U.alice, { name: "AI Name" }, { name: "State A" })) === "stale");
      check("…and the manual value is kept", (await nameOf()) === "Manual B");
      // 2. Nothing changed since the draft → applies; a retry → already_applied.
      check("unchanged base → updated", (await applyProfile(c, U.alice, { name: "AI Name", bio: "AI bio" }, { name: "Manual B", bio: null })) === "updated" && (await nameOf()) === "AI Name");
      check("retry → already_applied (idempotent)", (await applyProfile(c, U.alice, { name: "AI Name", bio: "AI bio" }, { name: "Manual B", bio: null })) === "already_applied");
      check("NULL vs empty string compared exactly (base bio null, now 'AI bio' → stale)", (await applyProfile(c, U.alice, { bio: "Other" }, { bio: null })) === "stale");
      check("categories array: a different array in the base → stale", (await applyProfile(c, U.alice, { categories: ["music_entertainment", "events_experiences"] }, { category: "music_entertainment", categories: ["events_experiences"] })) === "stale");
      check("categories array: same values in a different order → stale (compared exactly)", (await applyProfile(c, U.alice, { categories: ["events_experiences"] }, { categories: ["music_entertainment", "music_entertainment"] })) === "stale");
      check("categories array: exact base → updated", (await applyProfile(c, U.alice, { category: "music_entertainment", categories: ["music_entertainment", "events_experiences"] }, { category: "music_entertainment", categories: ["music_entertainment"] })) === "updated");
      check("a column outside the editor whitelist is refused (e.g. published)", (await errOf(() => applyProfile(c, U.alice, { published: false }, {}))) === "42501");
      check("…also in the base", (await errOf(() => applyProfile(c, U.alice, { name: "x" }, { verified: false }))) === "42501");
      check("another user can't update alice's profile through it (not_found)", (await applyProfile(c, U.bob, { name: "Hijack" }, { name: "AI Name" })) === "not_found" && (await nameOf()) === "AI Name");
      check("anon can't call it", (await errOf(() => as("anon", null, `select ai_apply_profile_update('${PR.alice}', '{"name":"x"}', '{}')`))) !== null);
    } finally {
      c.release();
    }
  }
  step("profile race");
  // 3. DETERMINISTIC RACE — manual edit in flight when the AI apply starts:
  //    M: BEGIN; UPDATE name='Manual C' (row locked, not committed)
  //    A: ai_apply_profile_update(base name='AI Name') → must WAIT on the row lock
  //    M: COMMIT → A resumes, sees 'Manual C' ≠ base → 'stale'. 'Manual C' survives.
  {
    const m = await pool.connect();
    const a = await pool.connect();
    try {
      await asOwner(m, U.alice);
      await m.query("begin");
      await m.query(`update profiles set name = 'Manual C' where id = $1`, [PR.alice]);
      let settled = false;
      const pending = applyProfile(a, U.alice, { name: "AI Late" }, { name: "AI Name" }).then((r) => ((settled = true), r));
      await new Promise((r) => setTimeout(r, 300));
      check("race: the AI apply waits while a manual edit holds the row", settled === false);
      await m.query("commit");
      const outcome = await pending;
      check("race: after the manual edit commits, the AI apply sees it and refuses (stale)", outcome === "stale", String(outcome));
      check("race: the newer manual value is NOT overwritten", (await nameOf()) === "Manual C");
    } finally {
      await m.query("rollback").catch(() => {});
      await back(m).catch(() => {});
      m.release();
      a.release();
    }
  }
  step("profile reverse race");
  // 4. Reverse order — AI apply holds the lock first, then the owner saves in the Dashboard:
  //    the owner's newer save waits, then wins (it IS the newer change).
  {
    const a = await pool.connect();
    const m = await pool.connect();
    try {
      await asOwner(a, U.alice);
      await a.query("begin");
      const r = (await a.query(`select ai_apply_profile_update($1, $2, $3) as r`, [PR.alice, { name: "AI First" }, { name: "Manual C" }])).rows[0].r;
      let settled = false;
      const manual = as("authenticated", U.alice, `update profiles set name = 'Manual D' where id = '${PR.alice}'`).then(() => (settled = true));
      await new Promise((res) => setTimeout(res, 300));
      check("reverse race: AI applied first (updated) and the Dashboard save waits for it", r === "updated" && settled === false);
      await a.query("commit");
      await manual;
      check("reverse race: the owner's later Dashboard save wins", (await nameOf()) === "Manual D");
    } finally {
      await a.query("rollback").catch(() => {});
      await back(a).catch(() => {});
      a.release();
      m.release();
    }
  }

  step("revision");
  // ---------------------------------------------------------------- REVISION replacement: old card can't apply the new payload
  {
    const d = await newDraft({ payload: { name: "Tee v1", price: 5000, currency: "XAF", description: null } });
    // The model revised it (what store.reviseDraft does): new payload, revision 2.
    await pool.query(`update ai_drafts set payload = $2, revision = 2, updated_at = now() where id = $1 and revision = 1 and status = 'awaiting_confirmation'`, [d.id, { name: "Tee v2", price: 6000, currency: "XAF", description: null }]);
    const old = await claim(pool, d.id, U.alice, PR.alice, 1);
    check("revision: confirming with the OLD card's revision → revision_mismatch, nothing claimed", old.outcome === "revision_mismatch" && (await statusOf(d.id)) === "awaiting_confirmation");
    const fresh = await claim(pool, d.id, U.alice, PR.alice, 2);
    check("revision: only the newest revision applies, with the newest payload", fresh.outcome === "claimed" && fresh.payload.name === "Tee v2" && fresh.revision === 2);
    const revise = await pool.query(`update ai_drafts set revision = 3 where id = $1 and revision = 2 and status in ('awaiting_confirmation','failed','stale') returning id`, [d.id]);
    check("revision: a draft being applied can't be revised underneath the apply", revise.rows.length === 0);
  }

  step("cascade");
  // ---------------------------------------------------------------- cascade + audit survival
  const convX = ID("e", 9);
  await pool.query(`insert into ai_conversations (id, user_id, profile_id) values ($1,$2,$3)`, [convX, U.alice, PR.alice]);
  const dx = await newDraft({ conv: convX });
  await pool.query(`insert into ai_draft_events (draft_id, user_id, profile_id, draft_type, action) values ($1,$2,$3,'product.create','created')`, [dx.id, U.alice, PR.alice]);
  await as("authenticated", U.alice, `delete from ai_conversations where id = '${convX}'`);
  check("deleting a conversation deletes its drafts", (await pool.query(`select 1 from ai_drafts where id = $1`, [dx.id])).rows.length === 0);
  check("…but the audit trail survives", (await pool.query(`select 1 from ai_draft_events where draft_id = $1`, [dx.id])).rows.length === 1);
  check("audit metadata size is capped", (await errOf(() => pool.query(`insert into ai_draft_events (draft_id, draft_type, action, metadata) values ($1,'x','created', $2)`, [dx.id, { big: "x".repeat(5000) }]))) !== null);
  check("draft payload must be an object and size-capped", (await errOf(() => newDraft({ payload: { big: "x".repeat(20000) } }))) !== null);

  // ---------------------------------------------------------------- rollback
  const beforeRollback = await snapshotExisting();
  const productsBeforeRollback = Number((await db.query(`select count(*)::int n from products`)).rows[0].n);
  check("rollback applies", (await errOf(() => db.query(ROLLBACK))) === null);
  const gone = (await db.query(`select to_regclass('public.ai_drafts') a, to_regclass('public.ai_draft_events') b, to_regprocedure('public.ai_claim_draft(uuid,uuid,uuid,int,int)') c`)).rows[0];
  check("rollback removes the draft tables and function", gone.a === null && gone.b === null && gone.c === null);
  check("rollback leaves every other object unchanged (applied products/events stay)", beforeRollback === (await snapshotExisting()) && productsBeforeRollback > 0 && Number((await db.query(`select count(*)::int n from products`)).rows[0].n) === productsBeforeRollback);
} finally {
  await pool.end().catch(() => {});
  await db.end().catch(() => {});
  await server.stop().catch(() => {});
  fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\nringo_ai_drafts (db)${process.env.MUT ? ` [MUT=${process.env.MUT}]` : ""}: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
