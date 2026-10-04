// Test for supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql (Phase 8: saved replies + close/reopen, database side).
//
// Scratch in-memory PostgreSQL (PGlite) only: no Supabase, no network, no credentials, no production ids. Applies the REAL Phase 4 and Phase 7
// migrations, then the REAL Phase 8 migration, preflight, verify and rollback files, and checks additivity, owner isolation, validation,
// the 50-reply limit, uniqueness, close/reopen semantics, privileges, RLS, cascade, verify drift detection and rollback.
//
//   Run:  node supabase/support/tests/whatsapp_inbox_tools.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const PHASE4 = read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql");
const PHASE7 = read("supabase/migrations/2026-12-08_whatsapp_outbound_replies.sql");
const MIGRATION = read("supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql");
const PREFLIGHT = read("supabase/support/2026-12-09_whatsapp_inbox_tools.preflight.sql");
const VERIFY = read("supabase/support/2026-12-09_whatsapp_inbox_tools.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-09_whatsapp_inbox_tools.rollback.sql");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: P(1) }, bob = { user: U(2), profile: P(2) }, carol = { user: U(3), profile: P(3) };   // carol: a profile WITHOUT a WhatsApp account

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.users (id uuid primary key, email text not null);
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (true);
  create table public.bk_customers (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict, name text not null, unique (profile_id, id));
  insert into public.users values ('${alice.user}','a@x.test'), ('${bob.user}','b@x.test'), ('${carol.user}','c@x.test');
  insert into public.profiles values ('${alice.profile}','${alice.user}','alice'), ('${bob.profile}','${bob.user}','bob'), ('${carol.profile}','${carol.user}','carol');
`);
await db.exec(PHASE4);
await db.exec(PHASE7);
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '1110000000001', '1110000000002'), ('${bob.profile}', '9990000000001', '9990000000002')`);

const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from ${t.startsWith("pg_") ? "" : "public."}${t} where ${w}`))[0].n);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const sq = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const svc = async (sql) => (await as("service_role", null, sql)).rows[0]?.r;
const save = (actor, profile, id, title, body) => svc(`select public.inbox_saved_reply_save(${sq(actor)}, ${sq(profile)}, ${sq(id)}, ${sq(title)}, ${sq(body)}) as r`);
const del = (actor, profile, id) => svc(`select public.inbox_saved_reply_delete(${sq(actor)}, ${sq(profile)}, ${sq(id)}) as r`);
const setStatus = (actor, conv, st) => svc(`select public.inbox_set_conversation_status(${sq(actor)}, ${sq(conv)}, ${sq(st)}) as r`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', 'hi', ${sq(o.name)}, null, null, null, null, null, null, null)`);
await ingest({ phone: "1110000000001", id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), name: "Customer One" });
await ingest({ phone: "1110000000001", id: "wamid.IN1b", from: "237600000001", ts: hoursAgo(0.5), name: "Customer One" });
await ingest({ phone: "9990000000001", id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer" });
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), convB = await convOf("237611111111");

// ------------------------------------------------------------------ script hygiene: no ';' inside a string literal
// The Supabase SQL editor can split a pasted script on semicolons, so a ';' inside a label ('... ; ...') corrupts the quoting from that point on
// (a later label such as '... foreign key into it' is then read as SQL: `relation "it" does not exist`). Every owner-run script must therefore
// keep ';' for statement ends only. This lexer walks each script (comments skipped, '' escapes honoured) and reports any ';' inside quotes.
const semicolonsInsideQuotes = (sql) => {
  const hits = []; let inQuote = false; let line = 1;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "\n") line++;
    if (!inQuote && ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; line++; continue; }
    if (ch === "'") { if (inQuote && sql[i + 1] === "'") { i++; continue; } inQuote = !inQuote; continue; }
    if (ch === ";" && inQuote) hits.push(line);
  }
  return hits;
};
const OWNER_SCRIPTS = fs.readdirSync(REPO + "supabase/support").filter((f) => /^2026-12-0[789]_whatsapp_.*\.(verify|preflight|rollback)\.sql$/.test(f));
check("hygiene: the owner-run WhatsApp verify / preflight / rollback scripts of Phases 4, 7 and 8 are found (9)", OWNER_SCRIPTS.length === 9, OWNER_SCRIPTS.join());
for (const f of OWNER_SCRIPTS) {
  const sql = read("supabase/support/" + f);
  const hits = semicolonsInsideQuotes(sql);
  check(`hygiene: no ';' inside a string literal in ${f}`, hits.length === 0, "lines " + hits.join());
  check(`hygiene: quotes are balanced in ${f}`, ((sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").match(/'/g) || []).length % 2) === 0);
}
check("hygiene: the lexer itself catches the bug (a label with a semicolon, and the original wording)", semicolonsInsideQuotes("select 'a; b', 'c';").length === 1 && semicolonsInsideQuotes("select 'it''s; x';").length === 1 && semicolonsInsideQuotes("select 'ok'; -- 'x;'\n").length === 0);
check("hygiene: a naive split on ';' of the Phase 8 verify script yields exactly ONE statement", VERIFY.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").filter((p) => p.trim()).length === 1);

// ------------------------------------------------------------------ preflight / apply / verify / additivity
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const firstStatement = (sql) => strip(sql).split(/;[ \t]*\n/)[0];
const OBJ = `select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal union all select 'pol:' || policyname from pg_policies order by 1`;
const objectsBefore = JSON.stringify((await q1(OBJ)).map((r) => r.x));
const pre = await q1(firstStatement(PREFLIGHT));
check("preflight: every row ok before the migration", pre.length >= 10 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
const bare = strip(MIGRATION);
check("migration: no ALTER of an existing table, no DROP of anything but its own trigger, no grant on Phase 4/7 objects", !/alter\s+table\s+(?!public\.inbox_saved_replies)/i.test(bare) && !/\bdrop\s+(?!trigger if exists inbox_saved_replies_guard_trg)(table|function|policy|index|column|constraint)/i.test(bare));
check("migration: no hard-coded ids, tokens or phone numbers", !/[0-9]{12,}|EAA[A-Za-z0-9]{10,}|Bearer/.test(bare));
await db.exec(MIGRATION);
check("migration applies", true);
check("migration is idempotent (re-run)", (await errOf(() => db.exec(MIGRATION))) === null);
const added = JSON.parse(JSON.stringify((await q1(OBJ)).map((r) => r.x))).filter((x) => !JSON.parse(objectsBefore).includes(x));
check("exactly the intended new objects: 1 table, its 6 columns, 2 indexes (pkey + title), 1 trigger, 1 policy, 4 functions; nothing else changed",
  added.filter((x) => x.startsWith("tbl:")).length === 1 && added.filter((x) => x.startsWith("col:")).length === 6 && added.filter((x) => x.startsWith("idx:")).length === 2 && added.filter((x) => x.startsWith("trg:")).length === 1
  && added.filter((x) => x.startsWith("pol:")).length === 1 && added.filter((x) => x.startsWith("fn:")).length === 4 && added.length === 15, added.join());
const ver = await q1(firstStatement(VERIFY));
check("verify: every row ok", ver.length >= 20 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));

// ------------------------------------------------------------------ saved replies: create / update / delete
const c1 = await save(alice.user, alice.profile, null, "  Welcome  ", "  Hello! Thanks for contacting us.  ");
check("create -> created with an id", c1.result === "created" && typeof c1.id === "string", JSON.stringify(c1));
const row = (await q1(`select * from public.inbox_saved_replies where id = '${c1.id}'`))[0];
check("stored trimmed, under the owner's profile", row.title === "Welcome" && row.body === "Hello! Thanks for contacting us." && row.profile_id === alice.profile);
check("a duplicate title (any case/spacing of case) -> duplicate_title, nothing created", (await save(alice.user, alice.profile, null, "WELCOME", "Another")).result === "duplicate_title" && (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)) === 1);
check("another profile may use the same title (uniqueness is per profile)", (await save(bob.user, bob.profile, null, "Welcome", "Bob's welcome")).result === "created");
const c2 = await save(alice.user, alice.profile, null, "Opening hours", "Mon-Fri 8-18");
check("a second reply is created", c2.result === "created");
check("update -> updated; title/body changed, identity unchanged, updated_at moved", await (async () => { const before = (await q1(`select updated_at, created_at from public.inbox_saved_replies where id = '${c2.id}'`))[0]; await new Promise((r) => setTimeout(r, 15)); const u = await save(alice.user, alice.profile, c2.id, "Hours", "Mon-Sat 8-19"); const after = (await q1(`select * from public.inbox_saved_replies where id = '${c2.id}'`))[0]; return u.result === "updated" && u.id === c2.id && after.title === "Hours" && after.body === "Mon-Sat 8-19" && after.profile_id === alice.profile && String(after.created_at) === String(before.created_at) && new Date(after.updated_at) > new Date(before.updated_at); })());
check("update to a title another reply already has -> duplicate_title", (await save(alice.user, alice.profile, c2.id, "welcome", "x")).result === "duplicate_title" && (await q1(`select title from public.inbox_saved_replies where id = '${c2.id}'`))[0].title === "Hours");
check("updating without renaming (same title, new body) works", (await save(alice.user, alice.profile, c2.id, "Hours", "Mon-Sun 8-20")).result === "updated");

// ------------------------------------------------------------------ ownership / isolation
const bobReply = (await q1(`select id from public.inbox_saved_replies where profile_id = '${bob.profile}'`))[0].id;
check("bob cannot update alice's reply (not_found), nothing changed", (await save(bob.user, bob.profile, c1.id, "Hacked", "Hacked")).result === "not_found" && (await q1(`select title from public.inbox_saved_replies where id = '${c1.id}'`))[0].title === "Welcome");
check("bob cannot target alice's profile (not_found): the profile must belong to the actor", (await save(bob.user, alice.profile, null, "Injected", "x")).result === "not_found" && (await save(bob.user, alice.profile, c1.id, "Injected", "x")).result === "not_found" && (await count("inbox_saved_replies", `title = 'Injected'`)) === 0);
check("a profile WITHOUT a WhatsApp account cannot hold saved replies (not_found)", (await save(carol.user, carol.profile, null, "Nope", "x")).result === "not_found");
check("an unknown user / null ids are refused", (await save(U(99), alice.profile, null, "x", "x")).result === "not_found" && (await svc(`select public.inbox_saved_reply_save(null, ${sq(alice.profile)}, null, 'x', 'x') as r`)).result === "invalid" && (await svc(`select public.inbox_saved_reply_save(${sq(alice.user)}, null, null, 'x', 'x') as r`)).result === "invalid");
check("a reply id from another profile combined with MY profile id is not_found (cannot reach across)", (await save(alice.user, alice.profile, bobReply, "Mine now", "x")).result === "not_found" && (await q1(`select profile_id from public.inbox_saved_replies where id = '${bobReply}'`))[0].profile_id === bob.profile);

// ------------------------------------------------------------------ validation
check("empty / whitespace title or body -> invalid", (await save(alice.user, alice.profile, null, "   ", "x")).result === "invalid" && (await save(alice.user, alice.profile, null, "t", "  ")).result === "invalid" && (await save(alice.user, alice.profile, null, null, "x")).result === "invalid");
check("title 61 / body 4097 -> invalid; exactly 60 / 4096 accepted", (await save(alice.user, alice.profile, null, "t".repeat(61), "x")).result === "invalid" && (await save(alice.user, alice.profile, null, "t", "b".repeat(4097))).result === "invalid" && (await save(alice.user, alice.profile, null, "t".repeat(60), "b".repeat(4096))).result === "created");
check("table checks also protect direct writes (title 0 / body 0)", /check|violates/i.test(await errOf(() => db.exec(`insert into public.inbox_saved_replies (profile_id, title, body) values ('${alice.profile}', '', 'x')`)) || ""));

// ------------------------------------------------------------------ limit and concurrency
const have = await count("inbox_saved_replies", `profile_id = '${alice.profile}'`);
for (let i = have; i < 50; i++) await save(alice.user, alice.profile, null, `Reply ${i}`, "body");
check("exactly 50 replies are allowed per profile", (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)) === 50);
check("the 51st -> limit_reached; editing an existing one still works at the limit", (await save(alice.user, alice.profile, null, "One too many", "x")).result === "limit_reached" && (await save(alice.user, alice.profile, c2.id, "Hours", "still editable")).result === "updated");
check("bob's limit is independent", (await save(bob.user, bob.profile, null, "Another for bob", "x")).result === "created");
const lastId = (await q1(`select id from public.inbox_saved_replies where title = 'Reply 49'`))[0].id;
check("delete frees a slot", (await del(alice.user, alice.profile, lastId)) === "ok" && (await save(alice.user, alice.profile, null, "Fits again", "x")).result === "created");
const race = await Promise.all(Array.from({ length: 6 }, () => save(bob.user, bob.profile, null, "Race title", "x")));
check("simultaneous creates of the same title -> exactly one created, the rest duplicate_title", race.filter((r) => r.result === "created").length === 1 && race.filter((r) => r.result === "duplicate_title").length === 5 && (await count("inbox_saved_replies", `profile_id = '${bob.profile}' and lower(title) = 'race title'`)) === 1);

// ------------------------------------------------------------------ delete
check("delete by the owner -> ok, then not_found", (await del(bob.user, bob.profile, bobReply)) === "ok" && (await del(bob.user, bob.profile, bobReply)) === "not_found" && (await count("inbox_saved_replies", `id = '${bobReply}'`)) === 0);
check("alice cannot delete bob's reply, with her own or his profile id", await (async () => { const b2 = (await q1(`select id from public.inbox_saved_replies where profile_id = '${bob.profile}' limit 1`))[0].id; return (await del(alice.user, alice.profile, b2)) === "not_found" && (await del(alice.user, bob.profile, b2)) === "not_found" && (await count("inbox_saved_replies", `id = '${b2}'`)) === 1; })());
check("delete with null ids -> invalid", (await svc(`select public.inbox_saved_reply_delete(${sq(alice.user)}, ${sq(alice.profile)}, null) as r`)) === "invalid");

// ------------------------------------------------------------------ guard, RLS, privileges, cascade
check("guard: id / profile_id / created_at are immutable", (await errOf(() => db.exec(`update public.inbox_saved_replies set profile_id = '${bob.profile}' where id = '${c1.id}'`))) !== null && (await errOf(() => db.exec(`update public.inbox_saved_replies set created_at = now() where id = '${c1.id}'`))) !== null);
const vis = async (role, sub) => Number((await as(role, sub, `select count(*)::int n from public.inbox_saved_replies`)).rows[0].n);
check("RLS: each owner reads only her own saved replies", (await vis("authenticated", alice.user)) === (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)) && (await vis("authenticated", bob.user)) === (await count("inbox_saved_replies", `profile_id = '${bob.profile}'`)) && (await vis("authenticated", carol.user)) === 0);
check("RLS: anon cannot read", /permission denied/i.test((await errOf(() => vis("anon", null))) || ""));
const denied = async (role, sub, sql) => /permission denied/i.test((await errOf(() => as(role, sub, sql))) || "");
check("no direct writes for authenticated, anon or service_role", await denied("authenticated", alice.user, `insert into public.inbox_saved_replies (profile_id, title, body) values ('${alice.profile}', 'x', 'y')`) && await denied("authenticated", alice.user, `update public.inbox_saved_replies set body = 'z'`) && await denied("authenticated", alice.user, `delete from public.inbox_saved_replies`)
  && await denied("anon", null, `insert into public.inbox_saved_replies (profile_id, title, body) values ('${alice.profile}', 'x', 'y')`) && await denied("service_role", null, `insert into public.inbox_saved_replies (profile_id, title, body) values ('${alice.profile}', 'x', 'y')`) && await denied("service_role", null, `delete from public.inbox_saved_replies`));
check("the four functions are not executable by anon or authenticated; the guard is executable by nobody", await denied("anon", null, `select public.inbox_saved_reply_save('${alice.user}', '${alice.profile}', null, 't', 'b')`) && await denied("authenticated", alice.user, `select public.inbox_saved_reply_save('${alice.user}', '${alice.profile}', null, 't', 'b')`)
  && await denied("authenticated", alice.user, `select public.inbox_saved_reply_delete('${alice.user}', '${alice.profile}', '${c1.id}')`) && await denied("authenticated", alice.user, `select public.inbox_set_conversation_status('${alice.user}', '${conv1}', 'closed')`) && await denied("service_role", null, `select public.inbox_saved_replies_guard()`));

// ------------------------------------------------------------------ close / reopen
const snap = async () => (await q1(`select unread_count, last_message_at, last_inbound_at, last_outbound_at, channel, account_id, contact_id from public.inbox_conversations where id = '${conv1}'`))[0];
const msgsBefore = JSON.stringify(await q1(`select id, status, body, provider_message_id from public.inbox_messages order by id`));
const s0 = await snap();
check("close -> ok; the status is 'closed'", (await setStatus(alice.user, conv1, "closed")) === "ok" && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "closed");
check("close again -> noop (idempotent)", (await setStatus(alice.user, conv1, "closed")) === "noop");
const s1 = await snap();
check("closing changes ONLY the status: unread_count and every timestamp/identity are untouched", JSON.stringify(s0) === JSON.stringify(s1) && s1.unread_count === 2, JSON.stringify([s0, s1]));
check("closing never touches a message or any provider status", JSON.stringify(await q1(`select id, status, body, provider_message_id from public.inbox_messages order by id`)) === msgsBefore);
check("reopen -> ok, then noop", (await setStatus(alice.user, conv1, "open")) === "ok" && (await setStatus(alice.user, conv1, "open")) === "noop" && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "open");
check("another owner cannot close or reopen alice's conversation (not_found), nothing changed", (await setStatus(bob.user, conv1, "closed")) === "not_found" && (await setStatus(carol.user, conv1, "closed")) === "not_found" && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "open");
check("a missing conversation is indistinguishable from someone else's", (await setStatus(alice.user, "f0000000-0000-4000-8000-0000000000aa", "closed")) === "not_found");
check("invalid status / null ids -> invalid", (await setStatus(alice.user, conv1, "archived")) === "invalid" && (await setStatus(alice.user, conv1, null)) === "invalid" && (await svc(`select public.inbox_set_conversation_status(null, ${sq(conv1)}, 'open') as r`)) === "invalid");
check("a new inbound message still reopens a closed conversation (existing Phase 4 behaviour)", await (async () => { await setStatus(alice.user, conv1, "closed"); await ingest({ phone: "1110000000001", id: "wamid.IN2", from: "237600000001", ts: hoursAgo(0.1), name: "Customer One" }); const c = (await q1(`select status, unread_count from public.inbox_conversations where id = '${conv1}'`))[0]; return c.status === "open" && c.unread_count === 3; })());
check("closing does not block the Phase 7 reply path (the window rule decides, not the status)", await (async () => { await setStatus(alice.user, conv1, "closed"); const r = await svc(`select public.inbox_prepare_outbound_text(${sq(alice.user)}, ${sq(conv1)}, 'e0000000-0000-4000-8000-000000000001', 'reply while closed') as r`); return r.result === "created"; })());

// ------------------------------------------------------------------ cascade
await db.exec(`delete from public.bk_customers where profile_id = '${bob.profile}'`);
await db.exec(`delete from public.profiles where id = '${bob.profile}'`);
check("deleting a profile cascades to its saved replies; alice's are untouched", (await count("inbox_saved_replies", `profile_id = '${bob.profile}'`)) === 0 && (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)) > 0);

// ------------------------------------------------------------------ verify detects drift
const failedLabels = async () => (await q1(firstStatement(VERIFY))).filter((r) => !r.ok).map((r) => r.label.slice(0, 3));
await db.exec(`alter table public.inbox_saved_replies add column redacted_at timestamptz`);
check("verify detects an unexpected column", (await failedLabels()).includes("02 "));
await db.exec(`alter table public.inbox_saved_replies drop column redacted_at`);
await db.exec(`create policy stray_write on public.inbox_saved_replies for insert to authenticated with check (true)`);
check("verify detects a write policy", (await failedLabels()).includes("03 "));
await db.exec(`drop policy stray_write on public.inbox_saved_replies`);
await db.exec(`grant insert on public.inbox_saved_replies to authenticated`);
check("verify detects a write grant", (await failedLabels()).includes("04 "));
await db.exec(`revoke insert on public.inbox_saved_replies from authenticated`);
await db.exec(`create or replace function public.inbox_set_conversation_status(p_actor_user_id uuid, p_conversation_id uuid, p_status text) returns text language sql security definer set search_path = public, pg_temp as $$ select 'ok'::text $$`);
check("verify detects a weakened status function", (await failedLabels()).some((l) => ["11b"].includes(l)));
await db.exec(MIGRATION);
check("verify is clean again after restoring", (await q1(firstStatement(VERIFY))).every((r) => r.ok), JSON.stringify((await q1(firstStatement(VERIFY))).filter((r) => !r.ok)));

// ------------------------------------------------------------------ rollback
const msgsBeforeRb = await count("inbox_messages"), acctsBeforeRb = await count("wa_accounts");
check("rollback runs and is re-runnable", (await errOf(() => db.exec(ROLLBACK))) === null && (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback removed the table and the four functions only", (await count("pg_tables", "schemaname = 'public' and tablename = 'inbox_saved_replies'")) === 0 && (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_saved_replies_guard', 'inbox_saved_reply_save', 'inbox_saved_reply_delete', 'inbox_set_conversation_status')`))[0].n === 0);
check("rollback kept every message and WhatsApp account, and the Phase 4 + Phase 7 objects", (await count("inbox_messages")) === msgsBeforeRb && (await count("wa_accounts")) === acctsBeforeRb && (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound', 'inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status')`))[0].n === 5);
check("a status already changed before the rollback stays changed (it is ordinary Phase 4 data)", (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "closed");
check("the objects list after rollback equals the list before the migration, apart from rows", JSON.stringify((await q1(OBJ)).map((r) => r.x)) === objectsBefore);
check("the migration re-applies cleanly after a rollback", (await errOf(() => db.exec(MIGRATION))) === null);

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.name); process.exit(1); }
