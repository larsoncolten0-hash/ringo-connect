// Adversarial test for supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql (Phase 6 security).
//
// Scratch in-memory PostgreSQL (PGlite) only; never connects to Supabase. It loads the REAL request_music_payout / request_affiliate_payout function bodies from the
// repository's migrations, shows the double-payout interleaving succeeding BEFORE the guard (control), then applies the REAL migration, rollback and verify files.
//
// HONEST LIMIT: PGlite is a single connection, so two transactions cannot truly run at the same time here. The race is reproduced by running the statements in the exact
// order the two concurrent transactions run them (both read the balance, then the first writes and commits, then the second writes with its stale balance): that is what
// READ COMMITTED lets happen, and what the guard has to refuse. That the advisory lock is taken (so a real second transaction waits until the first commits and then sees its
// update) is asserted separately through pg_locks.
//   Setup:  npm install --no-save @electric-sql/pglite      Run:  node supabase/support/tests/payout_concurrency.adversarial.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sql = (rel) => fs.readFileSync(REPO + rel, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = sql("supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql");
const ROLLBACK = sql("supabase/support/2026-10-07c_payout_request_concurrency_guard.rollback.sql");
const VERIFY = sql("supabase/support/2026-10-07c_payout_request_concurrency_guard.verify.sql");
const fn = (file, name) => { const m = sql(file).replace(/--[^\n]*/g, "").match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?language plpgsql security definer;`, "i")); if (!m) throw new Error("function not found: " + name); return m[0]; };
const MUSIC_RPC = fn("supabase/migrations/2026-09-20_music_payments.sql", "request_music_payout");
const AFF_RPC = fn("supabase/migrations/2026-09-06_affiliate_system.sql", "request_affiliate_payout");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const refused = async (f) => ((await errOf(f))?.message || "").includes("payout_exceeds_available");
const ID = (k, n) => `${k}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { artist: ID("a", 1), other: ID("a", 2) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.users (id uuid primary key, affiliate_payout_method text, affiliate_payout_details jsonb);
  create table public.platform_settings (id int primary key default 1, affiliate_min_payout_xaf numeric(10,2) not null default 100, affiliate_min_payout_usd numeric(10,2) not null default 1, music_min_payout_xaf numeric(10,2) not null default 100);
  create table public.music_payouts (id uuid primary key default gen_random_uuid(), artist_user_id uuid not null references public.users(id), amount numeric(10,2) not null, currency text not null,
    status text not null default 'requested' check (status in ('requested','processing','paid','rejected')), payout_method text, payout_details jsonb, admin_note text, fapshi_trans_id text, requested_at timestamptz not null default now(), processed_at timestamptz, processed_by uuid);
  create table public.music_sale_earnings (id uuid primary key default gen_random_uuid(), artist_user_id uuid not null references public.users(id), order_id uuid not null unique default gen_random_uuid(), gross_amount numeric(10,2) not null default 0,
    commission_rate numeric(5,4) not null default 0.1, platform_fee numeric(10,2) not null default 0, artist_amount numeric(10,2) not null, currency text not null, status text not null default 'pending' check (status in ('pending','requested','paid','reversed')),
    available_at timestamptz not null, payout_id uuid references public.music_payouts(id) on delete set null, created_at timestamptz not null default now());
  create table public.affiliate_payouts (id uuid primary key default gen_random_uuid(), affiliate_user_id uuid not null references public.users(id), amount numeric(10,2) not null, currency text not null,
    status text not null default 'requested' check (status in ('requested','paid','rejected')), payout_method text, payout_details jsonb, admin_note text, requested_at timestamptz not null default now(), processed_at timestamptz, processed_by uuid);
  create table public.affiliate_commissions (id uuid primary key default gen_random_uuid(), affiliate_user_id uuid not null references public.users(id), referred_user_id uuid not null references public.users(id), payment_transaction_id uuid not null unique default gen_random_uuid(),
    amount numeric(10,2) not null, currency text not null, commission_rate numeric(5,4) not null default 0.1, status text not null default 'pending' check (status in ('pending','requested','paid','reversed')), available_at timestamptz not null, payout_id uuid references public.affiliate_payouts(id) on delete set null, created_at timestamptz not null default now());
  ${MUSIC_RPC}
  ${AFF_RPC}
  insert into public.platform_settings default values;
  insert into public.users values ('${U.artist}','mobile_money','{"phone":"670000000","provider":"mtn"}'), ('${U.other}','mobile_money','{"phone":"671111111","provider":"orange"}');
`);
const sub = (u) => db.exec(`select set_config('request.jwt.claim.sub','${u || ""}', false)`);
const val = async (q) => (await db.query(q)).rows[0];
const earn = (u, amt, avail = "now() - interval '1 day'") => db.exec(`insert into public.music_sale_earnings (artist_user_id, artist_amount, currency, available_at) values ('${u}', ${amt}, 'XAF', ${avail})`);
const aff = (u, amt) => db.exec(`insert into public.affiliate_commissions (affiliate_user_id, referred_user_id, amount, currency, available_at) values ('${u}', '${U.other}', ${amt}, 'XAF', now() - interval '1 day')`);
const reset = () => db.exec(`delete from public.music_sale_earnings; delete from public.music_payouts; delete from public.affiliate_commissions; delete from public.affiliate_payouts;`);

// the statements of two concurrent request_music_payout calls, in the order READ COMMITTED lets them interleave
const interleavedMusic = async () => {
  await sub(U.artist);
  const v1 = Number((await val(`select coalesce(sum(artist_amount),0) v from public.music_sale_earnings where artist_user_id='${U.artist}' and currency='XAF' and status='pending' and payout_id is null and available_at<=now()`)).v); // T1 step 1
  const v2 = v1;                                                                                                                                                                                            // T2 step 1 (same snapshot)
  const p1 = (await val(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', ${v1}, 'XAF', 'requested') returning id`)).id;                                   // T1 step 2
  await db.exec(`update public.music_sale_earnings set status='requested', payout_id='${p1}' where artist_user_id='${U.artist}' and status='pending' and payout_id is null`);                              // T1 step 3, commits
  await db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', ${v2}, 'XAF', 'requested')`);                                                         // T2 step 2 with the STALE balance
  await db.exec(`update public.music_sale_earnings set status='requested', payout_id=null where false`);                                                                                                   // T2 step 3 matches nothing
};
const interleavedAff = async () => {
  await sub(U.artist);
  const v = Number((await val(`select coalesce(sum(amount),0) v from public.affiliate_commissions where affiliate_user_id='${U.artist}' and currency='XAF' and status='pending' and payout_id is null and available_at<=now()`)).v);
  const p1 = (await val(`insert into public.affiliate_payouts (affiliate_user_id, amount, currency, status) values ('${U.artist}', ${v}, 'XAF', 'requested') returning id`)).id;
  await db.exec(`update public.affiliate_commissions set status='requested', payout_id='${p1}' where affiliate_user_id='${U.artist}' and status='pending' and payout_id is null`);
  await db.exec(`insert into public.affiliate_payouts (affiliate_user_id, amount, currency, status) values ('${U.artist}', ${v}, 'XAF', 'requested')`);
};

console.log("### 0. CONTROL: before the guard, two overlapping requests withdraw the same balance twice");
await sub(U.artist);
await earn(U.artist, 1000); await earn(U.artist, 500);
const single = (await val(`select * from public.request_music_payout('XAF')`));
check("control: one ordinary request pays out exactly the balance and links the earnings", Number(single.amount) === 1500 && Number((await val(`select sum(artist_amount) s from public.music_sale_earnings where payout_id='${single.id}'`)).s) === 1500);
await reset(); await earn(U.artist, 1000); await earn(U.artist, 500);
await interleavedMusic();
const m = await val(`select count(*)::int n, sum(amount)::numeric s from public.music_payouts`);
const mLinked = await val(`select coalesce(sum(artist_amount),0)::numeric s from public.music_sale_earnings where payout_id is not null`);
check("control: MUSIC - two payouts of 1500 exist for 1500 of earnings (3000 withdrawable, 1500 unbacked)", m.n === 2 && Number(m.s) === 3000 && Number(mLinked.s) === 1500, JSON.stringify([m, mLinked]));
await db.exec(`delete from public.affiliate_commissions; delete from public.affiliate_payouts`); await aff(U.artist, 800);
await interleavedAff();
const a = await val(`select count(*)::int n, sum(amount)::numeric s from public.affiliate_payouts`);
check("control: AFFILIATE - two payouts of 800 exist for 800 of commissions", a.n === 2 && Number(a.s) === 1600, JSON.stringify(a));

console.log("### 1. apply the REAL migration (a past unbacked payout is still in the table: the verify script must see it)");
check("the migration applies and commits", (await errOf(() => db.exec(MIGRATION))) === null);
const v0 = (await db.query(VERIFY)).rows;
check("verify: P1-P3 pass and D1/D2/D3/D4 REPORT the existing unbacked music + affiliate payouts", ["P1", "P2", "P3"].every((g) => v0.filter((r) => r.grp === g).every((r) => r.status === "PASS")) && v0.find((r) => r.grp === "D1").value === "1" && Number(v0.find((r) => r.grp === "D2").value) === 1500 && v0.find((r) => r.grp === "D3").value === "1" && Number(v0.find((r) => r.grp === "D4").value) === 800, JSON.stringify(v0.filter((r) => r.grp.startsWith("D"))));
check("the guard functions are SECURITY DEFINER with a pinned path and no API role can execute them", (await val(`select bool_and(prosecdef and proconfig::text like '%search_path%') ok from pg_proc where pronamespace='public'::regnamespace and proname in ('music_payout_concurrency_guard','affiliate_payout_concurrency_guard')`)).ok
  && !(await val(`select bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) x from pg_proc p, (values ('anon'),('authenticated'),('service_role')) v(r) where p.pronamespace='public'::regnamespace and p.proname in ('music_payout_concurrency_guard','affiliate_payout_concurrency_guard')`)).x);

console.log("### 2. the same interleaving is now refused");
await reset(); await earn(U.artist, 1000); await earn(U.artist, 500);
check("MUSIC: the second (stale-balance) payout is refused with payout_exceeds_available", await refused(() => interleavedMusic()));
let mm = await val(`select count(*)::int n, sum(amount)::numeric s from public.music_payouts`);
check("MUSIC: exactly one payout of 1500 remains, fully backed by its earnings", mm.n === 1 && Number(mm.s) === 1500 && Number((await val(`select sum(artist_amount) s from public.music_sale_earnings where payout_id is not null`)).s) === 1500);
await db.exec(`delete from public.affiliate_commissions; delete from public.affiliate_payouts`); await aff(U.artist, 800);
check("AFFILIATE: the second (stale-balance) payout is refused", await refused(() => interleavedAff()));
check("AFFILIATE: exactly one payout of 800 remains", Number((await val(`select count(*)::int n from public.affiliate_payouts`)).n) === 1);

console.log("### 3. what the guard must NOT break");
await reset(); await sub(U.artist); await earn(U.artist, 1000);
const r1 = await val(`select * from public.request_music_payout('XAF')`);
check("a normal request through the real RPC still pays out the whole matured balance, once", Number(r1.amount) === 1000 && (await val(`select status from public.music_payouts where id='${r1.id}'`)).status === 'requested');
check("an immediate second request is refused by the RPC itself (balance 0 is below the minimum)", (await errOf(() => db.query(`select * from public.request_music_payout('XAF')`))) !== null && Number((await val(`select count(*)::int n from public.music_payouts`)).n) === 1);
await earn(U.artist, 700);
const r2 = await val(`select * from public.request_music_payout('XAF')`);
check("a LATER request for NEW earnings works even while the first payout is still waiting for the admin", Number(r2.amount) === 700 && Number((await val(`select count(*)::int n from public.music_payouts`)).n) === 2);
await earn(U.artist, 900, "now() + interval '5 days'");
check("earnings still inside the hold period cannot be paid out (a hand-made payout for them is refused)", await refused(() => db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 900, 'XAF', 'requested')`)));
await earn(U.other, 300);
await sub(U.other);
check("another earner's balance is independent and unaffected", Number((await val(`select * from public.request_music_payout('XAF')`)).amount) === 300);
await sub(U.artist);
check("someone else's earnings cannot be claimed in a payout of my own (amount above MY matured balance is refused)", await refused(() => db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 300, 'XAF', 'requested')`)));
check("a payout in another currency than the earnings is refused", await refused(() => db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 100, 'USD', 'requested')`)));
await aff(U.artist, 450);
await db.exec(`delete from public.affiliate_payouts`);
await db.exec(`update public.affiliate_commissions set status='pending', payout_id=null`);
const ar = await val(`select * from public.request_affiliate_payout('XAF')`);
check("AFFILIATE: a normal request through the real RPC still works", Number(ar.amount) === 450 && Number((await val(`select sum(amount) s from public.affiliate_commissions where payout_id='${ar.id}'`)).s) === 450);
await sub(null);
check("the service role / direct database access (no signed-in user) is not blocked", (await errOf(() => db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 5000, 'XAF', 'requested')`))) === null);
await sub(U.artist);
check("non-'requested' rows (e.g. a paid / rejected history row) are not blocked", (await errOf(() => db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 5000, 'XAF', 'rejected')`))) === null);

console.log("### 4. the lock that makes a real second transaction wait");
await reset(); await earn(U.artist, 1000); await sub(U.artist);
await db.exec("begin");
await db.exec(`insert into public.music_payouts (artist_user_id, amount, currency, status) values ('${U.artist}', 1000, 'XAF', 'requested')`);
const held = Number((await val(`select count(*)::int n from pg_locks where locktype = 'advisory' and granted`)).n);
await db.exec("commit");
const after = Number((await val(`select count(*)::int n from pg_locks where locktype = 'advisory' and granted`)).n);
check("an advisory transaction lock is held from the payout insert until commit, then released", held >= 1 && after === 0, `held=${held} after=${after}`);
const body = MIGRATION.replace(/--[^\n]*/g, "");
const musicFn = body.slice(body.indexOf("function public.music_payout_concurrency_guard"), body.indexOf("function public.affiliate_payout_concurrency_guard"));
check("the lock is taken BEFORE the balance is read (otherwise the re-check would see a stale snapshot)", musicFn.indexOf("pg_advisory_xact_lock") > 0 && musicFn.indexOf("pg_advisory_xact_lock") < musicFn.indexOf("sum(e.artist_amount)"));

console.log("### 5. rollback and re-apply");
await db.exec(ROLLBACK);
check("rollback removes only this guard", (await val(`select count(*)::int c from pg_trigger where tgname like '%payout_concurrency_guard_trg'`)).c === 0 && (await val(`select count(*)::int c from pg_proc where proname like '%payout_concurrency_guard'`)).c === 0);
await reset(); await earn(U.artist, 1000); await sub(U.artist);
await interleavedMusic();
check("after rollback the race works again (so the guard is what closed it)", Number((await val(`select count(*)::int n from public.music_payouts`)).n) === 2);
await reset(); await earn(U.artist, 1000);
check("the migration re-applies cleanly after a rollback, and is idempotent", (await errOf(() => db.exec(MIGRATION))) === null && (await errOf(() => db.exec(MIGRATION))) === null && await refused(() => interleavedMusic()));
check("the verification script is a single read-only SELECT", !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(VERIFY.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "")));

const failed = results.filter((r) => !r.pass);
console.log(`\npayout_concurrency.adversarial: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map((f) => f.name).join("\n - ")); process.exit(1); }
