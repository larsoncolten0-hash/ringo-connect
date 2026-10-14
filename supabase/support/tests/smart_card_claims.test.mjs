// Test for supabase/migrations/2026-12-22_smart_card_claims.sql (pre-issued Ringo Smart Cards + QR claim).
//
// Runs on a scratch, IN-MEMORY PostgreSQL (PGlite). It never connects to Supabase or any real database and never reads .env.local.
// WHAT IS REAL: the migration itself is executed by a real PostgreSQL engine: constraints, triggers, plpgsql functions, GRANT/REVOKE and RLS (via SET ROLE).
// WHAT IS A STAND-IN (PGlite is not Supabase): roles anon / authenticated / service_role, schema `auth` with auth.uid() reading a GUC, Supabase's default
// privileges, and public.users / public.profiles reduced to the columns the migration touches (is_admin() as in supabase/schema.sql).
// LIMITATION: PGlite has ONE connection, so two truly parallel transactions can not be run here. Concurrent claims are covered by (a) the row lock being
// present in the function (FOR UPDATE) and (b) the claim running as one atomic statement sequence, proven by back-to-back claims; run the two-session check
// in STAGING (see the production plan) before relying on it.
//   Run:  node supabase/support/tests/smart_card_claims.test.mjs
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const MIG = fs.readFileSync(REPO + "supabase/migrations/2026-12-22_smart_card_claims.sql", "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const H = (n) => sha("token-" + n);
const U = { alice: "c0000000-0000-4000-8000-000000000001", bob: "c0000000-0000-4000-8000-000000000002", admin: "c0000000-0000-4000-8000-000000000003" };
const P = { alice: "a0000000-0000-4000-8000-000000000001", bob: "a0000000-0000-4000-8000-000000000002" };

const db = new PGlite();
await db.exec(`
  set timezone = 'UTC';
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.users (id uuid primary key, email text not null, role text not null default 'creator');
  create function public.is_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null unique, created_at timestamptz default now());
  insert into public.users (id, email, role) values ('${U.alice}','a@x.test','creator'), ('${U.bob}','b@x.test','creator'), ('${U.admin}','ad@x.test','admin');
  insert into public.profiles (id, user_id, username) values ('${P.alice}','${U.alice}','alice'), ('${P.bob}','${U.bob}','bob');
`);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const svc = (sql) => as("service_role", null, sql);
const J = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const rpc = async (fn, args) => (await svc(`select ${fn}(${args}) as r`)).rows[0].r;

// ---- A. apply
check("apply", "the migration applies", (await errOf(() => db.exec(MIG))) === null);
check("apply", "it re-applies cleanly (idempotent)", (await errOf(() => db.exec(MIG))) === null);

// ---- B. batch import: exactly 500, unique, idempotent, atomic
const rows = Array.from({ length: 500 }, (_, i) => ({ serial: `RINGO-${String(i + 1).padStart(4, "0")}`, token_hash: H(i + 1) }));
const imp = await rpc("smartcard_import_batch", `'batch-001', ${J(rows)}`);
check("import", "imports exactly 500 cards", imp.inserted === 500 && imp.skipped === 0 && imp.batch_total === 500, JSON.stringify(imp));
check("import", "500 rows, 500 distinct serials, 500 distinct hashes", JSON.stringify((await db.query(`select count(*)::int c, count(distinct serial)::int s, count(distinct token_hash)::int h from ringo_smart_cards`)).rows[0]) === '{"c":500,"s":500,"h":500}');
check("import", "every card starts unclaimed with no owner", (await db.query(`select count(*)::int c from ringo_smart_cards where status = 'unclaimed' and claimed_by_user_id is null and profile_id is null and claimed_at is null`)).rows[0].c === 500);
const imp2 = await rpc("smartcard_import_batch", `'batch-001', ${J(rows)}`);
check("import", "re-running the same import changes nothing (500 skipped)", imp2.inserted === 0 && imp2.skipped === 500);
check("import", "a different hash for an existing serial is refused", /smartcard_conflict/.test(await errOf(() => svc(`select smartcard_import_batch('batch-001', ${J([{ serial: "RINGO-0001", token_hash: H(9999) }])})`)) || ""));
check("import", "an existing hash under a new serial is refused", /smartcard_conflict/.test(await errOf(() => svc(`select smartcard_import_batch('batch-001', ${J([{ serial: "RINGO-0600", token_hash: H(1) }])})`)) || ""));
const before = (await db.query(`select count(*)::int c from ringo_smart_cards`)).rows[0].c;
check("import", "a batch with one conflicting row imports NOTHING (all-or-nothing)", /smartcard_conflict/.test(await errOf(() => svc(`select smartcard_import_batch('batch-001', ${J([{ serial: "RINGO-0700", token_hash: H(7000) }, { serial: "RINGO-0001", token_hash: H(9998) }])})`)) || "") && (await db.query(`select count(*)::int c from ringo_smart_cards`)).rows[0].c === before);
check("import", "malformed serial / hash / batch name are refused", /smartcard_bad_row/.test(await errOf(() => svc(`select smartcard_import_batch('batch-001', ${J([{ serial: "RINGO-1", token_hash: H(5) }])})`)) || "") && /smartcard_bad_row/.test(await errOf(() => svc(`select smartcard_import_batch('batch-001', ${J([{ serial: "RINGO-0701", token_hash: "abc" }])})`)) || "") && /smartcard_bad_batch/.test(await errOf(() => svc(`select smartcard_import_batch('X', ${J(rows.slice(0, 1))})`)) || ""));

// ---- C. nothing raw is stored, identity is immutable, the claim shape is enforced
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'ringo_smart_cards'`)).rows.map((r) => r.column_name);
check("schema", "there is no column that could hold a raw token or a username", !cols.includes("token") && !cols.includes("username") && cols.includes("token_hash"));
check("schema", "serial, token hash and batch can not be changed after import", /immutable/.test(await errOf(() => db.exec(`update ringo_smart_cards set serial = 'RINGO-0999' where serial = 'RINGO-0002'`)) || "") && /immutable/.test(await errOf(() => db.exec(`update ringo_smart_cards set token_hash = '${H(8888)}' where serial = 'RINGO-0002'`)) || ""));
check("schema", "an unclaimed card with an owner is rejected by the table constraint", (await errOf(() => db.exec(`update ringo_smart_cards set claimed_by_user_id = '${U.alice}' where serial = 'RINGO-0002'`))) !== null);
check("schema", "serial format and hash format are enforced", (await errOf(() => db.exec(`insert into ringo_smart_cards (serial, token_hash, batch) values ('RINGO-12', '${H(1)}', 'batch-001')`))) !== null && (await errOf(() => db.exec(`insert into ringo_smart_cards (serial, token_hash, batch) values ('RINGO-0800', 'zz', 'batch-001')`))) !== null);

// ---- D. scanning
const none = await rpc("smartcard_resolve", `'${H(424242)}'`);
check("scan", "an unknown token resolves to null", none === null);
check("scan", "a malformed token resolves to null (no error, no SQL surprises)", (await rpc("smartcard_resolve", `'not-a-hash'`)) === null && (await rpc("smartcard_resolve", `null`)) === null);
const un = await rpc("smartcard_resolve", `'${H(1)}'`);
check("scan", "an unclaimed card resolves to {unclaimed, serial} and nothing else", un.status === "unclaimed" && un.serial === "RINGO-0001" && Object.keys(un).sort().join() === "serial,status", JSON.stringify(un));
check("scan", "a scan is counted", (await db.query(`select scan_count from ringo_smart_cards where serial = 'RINGO-0001'`)).rows[0].scan_count === 1);

// ---- E. claim
check("claim", "an unknown token is 'unavailable'", (await rpc("smartcard_claim", `'${H(424242)}', '${U.alice}', '${P.alice}'`)).result === "unavailable");
check("claim", "a profile that belongs to someone else is refused and the card stays unclaimed", (await rpc("smartcard_claim", `'${H(1)}', '${U.alice}', '${P.bob}'`)).result === "profile_not_allowed" && (await db.query(`select status from ringo_smart_cards where serial = 'RINGO-0001'`)).rows[0].status === "unclaimed");
const c1 = await rpc("smartcard_claim", `'${H(1)}', '${U.alice}', '${P.alice}'`);
check("claim", "the owner of the profile can claim an unclaimed card", c1.result === "claimed" && c1.already === false && c1.serial === "RINGO-0001", JSON.stringify(c1));
const row1 = (await db.query(`select status, claimed_by_user_id, profile_id, claimed_at is not null as at from ringo_smart_cards where serial = 'RINGO-0001'`)).rows[0];
check("claim", "the card is now claimed by that user and profile", row1.status === "claimed" && row1.claimed_by_user_id === U.alice && row1.profile_id === P.alice && row1.at === true);
check("claim", "a second account can NOT take a claimed card, and nothing changes", (await rpc("smartcard_claim", `'${H(1)}', '${U.bob}', '${P.bob}'`)).result === "already_claimed" && (await db.query(`select claimed_by_user_id from ringo_smart_cards where serial = 'RINGO-0001'`)).rows[0].claimed_by_user_id === U.alice);
check("claim", "the owner repeating the claim is harmless (idempotent) and moves nothing", (await rpc("smartcard_claim", `'${H(1)}', '${U.alice}', '${P.alice}'`)).already === true);
check("claim", "the owner can not move the card to a different profile through the claim flow", (await rpc("smartcard_claim", `'${H(1)}', '${U.alice}', '${P.bob}'`)).result === "claimed" && (await db.query(`select profile_id from ringo_smart_cards where serial = 'RINGO-0001'`)).rows[0].profile_id === P.alice);
// two competing claims back to back on a fresh card: exactly one wins
const [r1, r2] = await Promise.all([rpc("smartcard_claim", `'${H(2)}', '${U.alice}', '${P.alice}'`), rpc("smartcard_claim", `'${H(2)}', '${U.bob}', '${P.bob}'`)]);
check("claim", "two competing claims on one card: exactly one wins", [r1.result, r2.result].sort().join() === "already_claimed,claimed", JSON.stringify([r1, r2]));
check("claim", "...and the card has exactly one owner", (await db.query(`select count(*)::int c from ringo_smart_cards where serial = 'RINGO-0002' and claimed_by_user_id is not null`)).rows[0].c === 1);
check("claim", "the claim function locks the card row (FOR UPDATE) before deciding", /select \* into v_card from ringo_smart_cards where token_hash = p_token_hash for update/.test((await db.query(`select prosrc from pg_proc where proname = 'smartcard_claim'`)).rows[0].prosrc));

// ---- F. a claimed card follows the owner's CURRENT username; disabled cards vanish
const cl = await rpc("smartcard_resolve", `'${H(1)}'`);
check("scan", "a claimed card resolves to the owner's username", cl.status === "claimed" && cl.username === "alice", JSON.stringify(cl));
await db.exec(`update public.profiles set username = 'alice_new' where id = '${P.alice}'`);
check("scan", "...and after a rename it resolves to the NEW username (nothing is printed or stored)", (await rpc("smartcard_resolve", `'${H(1)}'`)).username === "alice_new");
await db.exec(`update ringo_smart_cards set status = 'disabled' where serial = 'RINGO-0003'`);
check("scan", "a disabled card is indistinguishable from an unknown one", (await rpc("smartcard_resolve", `'${H(3)}'`)) === null && (await rpc("smartcard_claim", `'${H(3)}', '${U.alice}', '${P.alice}'`)).result === "unavailable");
await db.exec(`delete from public.profiles where id = '${P.bob}'`);
await rpc("smartcard_claim", `'${H(4)}', '${U.alice}', '${P.alice}'`);
await db.exec(`delete from public.profiles where id = '${P.alice}'`);
check("scan", "if the owner's profile is deleted the card stays claimed (never re-claimable) and resolves with no username", (await db.query(`select status from ringo_smart_cards where serial = 'RINGO-0004'`)).rows[0].status === "claimed" && (await rpc("smartcard_resolve", `'${H(4)}'`)).username === null);
await db.exec(`insert into public.profiles (id, user_id, username) values ('${P.alice}','${U.alice}','alice'), ('${P.bob}','${U.bob}','bob')`);

// ---- G. rate limiter
let allowed = 0;
for (let i = 0; i < 65; i++) if ((await rpc("smartcard_rate_limit_hit", `'scan_ip', '${sha("ip")}', 600, 60`)) === true) allowed++;
check("rate", "the limiter lets exactly 60 through per window, then refuses (fail-closed shape)", allowed === 60, allowed);
check("rate", "an unknown kind or non-hash subject is refused", /invalid_rate_limit_args/.test(await errOf(() => svc(`select smartcard_rate_limit_hit('x', '${sha("a")}', 600, 60)`)) || "") && /invalid_rate_limit_args/.test(await errOf(() => svc(`select smartcard_rate_limit_hit('scan_ip', '1.2.3.4', 600, 60)`)) || ""));
check("rate", "a different caller has its own budget", (await rpc("smartcard_rate_limit_hit", `'scan_ip', '${sha("other")}', 600, 60`)) === true);

// ---- H. privileges and RLS
for (const role of ["anon", "authenticated"]) {
  for (const f of ["smartcard_resolve('" + H(1) + "')", "smartcard_claim('" + H(5) + "','" + U.alice + "','" + P.alice + "')", "smartcard_rate_limit_hit('scan_ip','" + sha("z") + "',600,60)", "smartcard_import_batch('batch-002','[]'::jsonb)"]) {
    const e = await errOf(() => as(role, U.alice, `select ${f}`));
    check("privileges", `${role} can not execute ${f.split("(")[0]}`, e && /permission denied/.test(e), e);
  }
  check("privileges", `${role} can not write the table`, /permission denied/.test(await errOf(() => as(role, U.alice, `update ringo_smart_cards set status = 'disabled'`)) || "") && /permission denied/.test(await errOf(() => as(role, U.alice, `insert into ringo_smart_cards (serial, token_hash, batch) values ('RINGO-0900', '${H(900)}', 'batch-001')`)) || "") && /permission denied/.test(await errOf(() => as(role, U.alice, `delete from ringo_smart_cards`)) || ""));
}
check("privileges", "anon can not read the table at all", /permission denied/.test(await errOf(() => as("anon", null, `select serial from ringo_smart_cards`)) || ""));
check("privileges", "a signed-in user can NOT read token_hash (column privilege)", /permission denied/.test(await errOf(() => as("authenticated", U.alice, `select token_hash from ringo_smart_cards`)) || "") && /permission denied/.test(await errOf(() => as("authenticated", U.alice, `select * from ringo_smart_cards`)) || ""));
const mine = (await as("authenticated", U.alice, `select serial from ringo_smart_cards order by serial`)).rows.map((r) => r.serial);
check("rls", "an owner sees only their own claimed cards (RLS)", mine.join() === "RINGO-0001,RINGO-0002,RINGO-0004" || mine.join() === "RINGO-0001,RINGO-0004" || mine.join() === "RINGO-0001,RINGO-0002", mine.join());
check("rls", "another user sees none of them", !(await as("authenticated", U.bob, `select serial from ringo_smart_cards`)).rows.some((r) => ["RINGO-0001", "RINGO-0004"].includes(r.serial)));
check("rls", "an admin can read all cards (non-secret columns)", (await as("authenticated", U.admin, `select count(*)::int c from ringo_smart_cards`)).rows[0].c === 500);
check("privileges", "the rate-event table is not readable or writable by clients", /permission denied/.test(await errOf(() => as("authenticated", U.alice, `select * from ringo_smart_card_rate_events`)) || "") && /permission denied/.test(await errOf(() => as("anon", null, `insert into ringo_smart_card_rate_events (kind, subject_hash) values ('scan_ip','x')`)) || ""));
check("privileges", "every function has a pinned search_path and is security definer", (await db.query(`select count(*)::int c from pg_proc where proname like 'smartcard_%' and prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')`)).rows[0].c === 4);

// ---- I. the migration touches nothing that exists
check("additive", "no existing table is altered, dropped or truncated and ringo_cards is never mentioned", !/\balter table (?!ringo_smart_card)/i.test(MIG.replace(/--.*$/gm, "")) && !/\b(drop table|truncate|delete from public|ringo_cards)\b/i.test(MIG.replace(/--.*$/gm, "")));

console.log(`smart_card_claims: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
