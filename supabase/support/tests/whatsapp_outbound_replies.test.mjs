// Test for supabase/migrations/2026-12-08_whatsapp_outbound_replies.sql (Phase 7: the database side of human WhatsApp replies).
//
// Scratch in-memory PostgreSQL (PGlite) only: no Supabase, no network, no credentials, no production ids. Applies the REAL Phase 4 migration
// and then the REAL Phase 7 migration, preflight, verify and rollback files, and checks:
//   * additive: three functions, nothing else; verify passes; rollback removes exactly those; re-applies cleanly
//   * prepare: one queued row per client_request_id, recipient + business number read from the database, ownership re-derived in SQL,
//     replays return the original row, conflicts are refused, the 24-hour window and disabled accounts are enforced, races are safe
//   * complete / fail: wamid storage, early status events attached, status ranking, conversation counters
//   * the Phase 4 webhook status path still behaves (sent, delivered, read, failed, late sent, late failed, duplicate, before-message, unknown, foreign)
//   * privileges: service_role only
//
//   Run:  node supabase/support/tests/whatsapp_outbound_replies.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const PHASE4 = read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql");
const MIGRATION = read("supabase/migrations/2026-12-08_whatsapp_outbound_replies.sql");
const PREFLIGHT = read("supabase/support/2026-12-08_whatsapp_outbound_replies.preflight.sql");
const VERIFY = read("supabase/support/2026-12-08_whatsapp_outbound_replies.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-08_whatsapp_outbound_replies.rollback.sql");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;   // client_request_ids
const alice = { user: U(1), profile: P(1) }, bob = { user: U(2), profile: P(2) }, carol = { user: U(3) };
const PH_A = "1110000000001", PH_B = "9990000000001";

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
  insert into public.profiles values ('${alice.profile}','${alice.user}','alice'), ('${bob.profile}','${bob.user}','bob');
`);
await db.exec(PHASE4);
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '1110000000002'), ('${bob.profile}', '${PH_B}', '9990000000002')`);

const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const sq = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const svc = async (sql) => (await as("service_role", null, sql)).rows[0]?.r;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', ${sq(o.text ?? "hi")}, ${sq(o.name ?? null)}, null, null, null, null, null, null, null)`);
const prep = (actor, conv, req, body) => svc(`select public.inbox_prepare_outbound_text(${sq(actor)}, ${sq(conv)}, ${sq(req)}, ${sq(body)}) as r`);
const complete = (actor, msg, wamid) => svc(`select public.inbox_complete_outbound(${sq(actor)}, ${sq(msg)}, ${sq(wamid)}) as r`);
const failMsg = (actor, msg, codes) => svc(`select public.inbox_fail_outbound(${sq(actor)}, ${sq(msg)}, ${codes === null ? "null" : `'{${codes.join(",")}}'::integer[]`}) as r`);
const status = (o) => svc(`select public.inbox_ingest_whatsapp_status(${sq(o.phone ?? PH_A)}, null, ${sq(o.id)}, ${sq(o.status)}, ${sq(o.ts ?? hoursAgo(0.01))}::timestamptz, ${o.codes ? `'{${o.codes.join(",")}}'::integer[]` : "null"}) as r`);
const msgRow = async (id) => (await q1(`select * from public.inbox_messages where id = ${sq(id)}`))[0];
const convRow = async (id) => (await q1(`select * from public.inbox_conversations where id = ${sq(id)}`))[0];

// conversations: alice has an open window (customer wrote 1h ago), an expired one (30h ago), one with no inbound at all; bob has his own
await ingest({ phone: PH_A, id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), name: "Customer One" });
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(30), name: "Customer Two" });
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer" });
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), convB = await convOf("237611111111");
await db.exec(`insert into public.inbox_contacts (id, profile_id, channel, external_id) values ('d0000000-0000-4000-8000-000000000009', '${alice.profile}', 'whatsapp', '237600000009')`);
const acctA = (await q1(`select id from public.wa_accounts where profile_id = '${alice.profile}'`))[0].id;
await db.exec(`insert into public.inbox_conversations (id, profile_id, channel, account_id, contact_id) values ('f0000000-0000-4000-8000-000000000009', '${alice.profile}', 'whatsapp', '${acctA}', 'd0000000-0000-4000-8000-000000000009')`);
const convNoInbound = "f0000000-0000-4000-8000-000000000009";

// ------------------------------------------------------------------ preflight / apply / verify / additivity
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const firstStatement = (sql) => strip(sql).split(/;[ \t]*\n/)[0];
const objectsBefore = JSON.stringify((await q1(`select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal union all select 'pol:' || policyname from pg_policies order by 1`)).map((r) => r.x));
const pre = await q1(firstStatement(PREFLIGHT));
check("preflight: every row ok before the migration", pre.length >= 9 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
const bare = strip(MIGRATION);
check("migration: functions only (no create table / alter table / drop / index / trigger / policy / grant on tables)", !/\b(create\s+table|alter\s+table|drop\s+|create\s+(unique\s+)?index|create\s+trigger|create\s+policy|grant\s+select)/i.test(bare.replace(/revoke all on function/gi, "").replace(/'drop'/gi, "")), "");
check("migration: no hard-coded ids, tokens or phone numbers", !/[0-9]{12,}|EAA[A-Za-z0-9]{10,}|Bearer/.test(bare));
await db.exec(MIGRATION);
check("migration applies", true);
check("migration is idempotent (re-run)", (await errOf(() => db.exec(MIGRATION))) === null);
const objectsAfter = JSON.parse(JSON.stringify((await q1(`select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal union all select 'pol:' || policyname from pg_policies order by 1`)).map((r) => r.x)));
const added = objectsAfter.filter((x) => !JSON.parse(objectsBefore).includes(x));
check("exactly three new objects, all functions (no table, column, index, trigger or policy added)", added.length === 3 && added.every((x) => /^fn:inbox_(prepare_outbound_text|complete_outbound|fail_outbound)$/.test(x)), added.join());
const ver = await q1(firstStatement(VERIFY));
check("verify: every row ok", ver.length >= 10 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));

// ------------------------------------------------------------------ prepare
const r1 = await prep(alice.user, conv1, R(1), "  Hello, how can we help?  ");
check("prepare: created, with the recipient and business number READ FROM THE DATABASE", r1.result === "created" && r1.to === "237600000001" && r1.phone_number_id === PH_A && typeof r1.message_id === "string", JSON.stringify(r1));
const m1 = await msgRow(r1.message_id);
check("prepare: ONE queued outbound row (trimmed body, request id, sender, no wamid yet)", m1.direction === "outbound" && m1.status === "queued" && m1.type === "text" && m1.body === "Hello, how can we help?" && m1.client_request_id === R(1) && m1.sent_by_user_id === alice.user && m1.provider_message_id === null && m1.profile_id === alice.profile && m1.conversation_id === conv1 && m1.channel === "whatsapp");
const c0 = await convRow(conv1);
check("prepare: conversation counters are NOT touched yet (only a confirmed send moves them)", c0.last_outbound_at === null && c0.unread_count === 1);
const rep1 = await prep(alice.user, conv1, R(1), "Hello, how can we help?");
check("replay with the same request id returns the ORIGINAL row (existing), never a second message", rep1.result === "existing" && rep1.message_id === r1.message_id && rep1.status === "queued" && (await count("inbox_messages", "direction = 'outbound'")) === 1, JSON.stringify(rep1));
check("replay never exposes a recipient or phone number id", rep1.to === undefined && rep1.phone_number_id === undefined);
check("the same request id with a different body is a conflict", (await prep(alice.user, conv1, R(1), "Something else")).result === "conflict");
check("the same request id on a different conversation is a conflict", (await prep(alice.user, conv2, R(1), "Hello, how can we help?")).result === "conflict" && (await count("inbox_messages", "direction = 'outbound'")) === 1);

// ownership is decided in SQL
const before = await count("inbox_messages");
check("another profile's owner cannot prepare on a guessed conversation id -> not_found, nothing created", (await prep(bob.user, conv1, R(2), "hi")).result === "not_found" && (await count("inbox_messages")) === before);
check("a user who owns no profile -> not_found", (await prep(carol.user, conv1, R(3), "hi")).result === "not_found");
check("a missing conversation is indistinguishable from someone else's", (await prep(alice.user, "f0000000-0000-4000-8000-0000000000aa", R(4), "hi")).result === "not_found");
check("bob can send in his own conversation (control)", (await prep(bob.user, convB, R(5), "Hi Bob customer")).result === "created");
check("alice cannot reuse bob's client_request_id namespace: the unique key is per profile", (await prep(alice.user, conv1, R(5), "Another")).result === "created");

// validation
check("empty / whitespace / null body -> invalid", (await prep(alice.user, conv1, R(6), "   ")).result === "invalid" && (await prep(alice.user, conv1, R(6), null)).result === "invalid");
check("null ids -> invalid", (await svc(`select public.inbox_prepare_outbound_text(null, ${sq(conv1)}, ${sq(R(7))}, 'x') as r`)).result === "invalid" && (await svc(`select public.inbox_prepare_outbound_text(${sq(alice.user)}, ${sq(conv1)}, null, 'x') as r`)).result === "invalid");
check("4097 characters -> invalid; exactly 4096 is accepted", (await prep(alice.user, conv1, R(8), "x".repeat(4097))).result === "invalid" && (await prep(alice.user, conv1, R(9), "x".repeat(4096))).result === "created");
check("invalid requests created no row", (await count("inbox_messages", `client_request_id in (${sq(R(6))}, ${sq(R(7))}, ${sq(R(8))})`)) === 0);

// window + account
check("24-hour window closed (customer wrote 30h ago) -> window_closed, nothing created", (await prep(alice.user, conv2, R(10), "hi")).result === "window_closed" && (await count("inbox_messages", `client_request_id = ${sq(R(10))}`)) === 0);
check("a conversation with no inbound message at all -> window_closed", (await prep(alice.user, convNoInbound, R(11), "hi")).result === "window_closed");
await db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PH_A}'`);
check("disabled account -> account_disabled, nothing created", (await prep(alice.user, conv1, R(12), "hi")).result === "account_disabled" && (await count("inbox_messages", `client_request_id = ${sq(R(12))}`)) === 0);
check("...but a replay of an earlier request still returns its original row", (await prep(alice.user, conv1, R(1), "Hello, how can we help?")).result === "existing");
await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PH_A}'`);

// concurrency / races
const burst = await Promise.all(Array.from({ length: 20 }, () => prep(alice.user, conv1, R(20), "burst message")));
check("20 simultaneous identical requests -> exactly one created, the rest existing, ONE row", burst.filter((r) => r.result === "created").length === 1 && burst.filter((r) => r.result === "existing").length === 19 && (await count("inbox_messages", `client_request_id = ${sq(R(20))}`)) === 1);
await db.exec(`
  create function pg_temp.plant() returns trigger language plpgsql as $$ begin
    if pg_trigger_depth() = 1 and new.client_request_id = '${R(21)}' then
      insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id)
      values (new.profile_id, new.conversation_id, new.channel, 'outbound', 'text', new.body, 'queued', new.sent_by_user_id, new.client_request_id);
    end if; return new; end $$;
  create trigger zz_plant before insert on public.inbox_messages for each row execute function pg_temp.plant();`);
const lost = await prep(alice.user, conv1, R(21), "lost race message");
check("lost race (an identical request committed first) -> existing, still ONE row", lost.result === "existing" && (await count("inbox_messages", `client_request_id = ${sq(R(21))}`)) === 1, JSON.stringify(lost));
await db.exec(`drop trigger zz_plant on public.inbox_messages`);

// ------------------------------------------------------------------ complete
const WAM = "wamid.OUT.A";
check("complete by a non-owner -> not_found; unknown message -> not_found", (await complete(bob.user, r1.message_id, WAM)) === "not_found" && (await complete(alice.user, "f0000000-0000-4000-8000-0000000000bb", WAM)) === "not_found");
check("complete with an empty / oversize wamid -> invalid", (await complete(alice.user, r1.message_id, "  ")) === "invalid" && (await complete(alice.user, r1.message_id, "w".repeat(257))) === "invalid");
check("complete -> ok", (await complete(alice.user, r1.message_id, WAM)) === "ok");
const m1b = await msgRow(r1.message_id);
check("complete: wamid stored, status 'sent', still outbound with its request id", m1b.provider_message_id === WAM && m1b.status === "sent" && m1b.direction === "outbound" && m1b.client_request_id === R(1));
const c1 = await convRow(conv1);
check("complete: last_outbound_at and last_message_at updated, conversation open, unread untouched", c1.last_outbound_at !== null && new Date(c1.last_message_at) >= new Date(c1.last_outbound_at) && c1.status === "open" && c1.unread_count === 1);
check("complete again with the same wamid -> duplicate; with a different wamid -> conflict (wamid unchanged)", (await complete(alice.user, r1.message_id, WAM)) === "duplicate" && (await complete(alice.user, r1.message_id, "wamid.OTHER")) === "conflict" && (await msgRow(r1.message_id)).provider_message_id === WAM);
const rOther = await prep(alice.user, conv1, R(30), "second message");
check("a wamid already used by another message -> conflict, the message stays queued", (await complete(alice.user, rOther.message_id, WAM)) === "conflict" && (await msgRow(rOther.message_id)).status === "queued" && (await msgRow(rOther.message_id)).provider_message_id === null);
check("replay after completion returns the original row with its wamid and status", await (async () => { const r = await prep(alice.user, conv1, R(1), "Hello, how can we help?"); return r.result === "existing" && r.status === "sent" && r.provider_message_id === WAM; })());
check("a closed conversation reopens on a confirmed send", await (async () => { await db.exec(`update public.inbox_conversations set status = 'closed' where id = '${conv1}'`); const r = await prep(alice.user, conv1, R(31), "after close"); await complete(alice.user, r.message_id, "wamid.OUT.C"); return (await convRow(conv1)).status === "open"; })());

// ------------------------------------------------------------------ status events after the send (the Phase 4 webhook path)
check("webhook status 'delivered' then 'read' advance the current status", (await status({ id: WAM, status: "delivered" })) === "created" && (await status({ id: WAM, status: "read" })) === "created" && (await msgRow(r1.message_id)).status === "read");
check("a late 'sent' (new event row) after 'read' does not downgrade", (await status({ id: WAM, status: "sent" })) === "created" && (await msgRow(r1.message_id)).status === "read");
check("a late 'failed' after 'read' does not overwrite it, but is kept in the history", (await status({ id: WAM, status: "failed", codes: [131026] })) === "created" && (await msgRow(r1.message_id)).status === "read" && (await count("inbox_status_events", `provider_message_id = ${sq(WAM)} and status = 'failed'`)) === 1);
check("a duplicate status delivery is a no-op", (await status({ id: WAM, status: "read" })) === "duplicate" && (await count("inbox_status_events", `provider_message_id = ${sq(WAM)} and status = 'read'`)) === 1);
check("status history is separate from the current status: 4 events, 1 current value", (await count("inbox_status_events", `provider_message_id = ${sq(WAM)}`)) === 4 && (await msgRow(r1.message_id)).status === "read");
check("a status for an unknown provider message is stored unattached and invents no message", (await status({ id: "wamid.NOBODY", status: "delivered" })) === "created" && (await q1(`select message_id from public.inbox_status_events where provider_message_id = 'wamid.NOBODY'`))[0].message_id === null && (await count("inbox_messages", "provider_message_id = 'wamid.NOBODY'")) === 0);
const rZ = await prep(alice.user, conv1, R(70), "foreign status target"); await complete(alice.user, rZ.message_id, "wamid.OUT.Z");
check("a status through ANOTHER profile's phone number never touches this profile's message (stored unattached under the other profile)", (await status({ phone: PH_B, id: "wamid.OUT.Z", status: "read" })) === "created" && (await msgRow(rZ.message_id)).status === "sent" && (await q1(`select message_id, profile_id from public.inbox_status_events where provider_message_id = 'wamid.OUT.Z' and status = 'read'`))[0].message_id === null);
check("a status for an unknown phone number is ignored", (await status({ phone: "5550001111", id: WAM, status: "read" })) === "unknown_account");

// early events: the webhook can be faster than the database write that stores the wamid
const rE = await prep(alice.user, conv1, R(40), "early events");
await status({ id: "wamid.EARLY", status: "delivered" }); await status({ id: "wamid.EARLY", status: "read" });
check("early events are stored unattached", (await count("inbox_status_events", "provider_message_id = 'wamid.EARLY' and message_id is null")) === 2);
check("complete attaches the early events and takes the highest-ranked status ('read')", (await complete(alice.user, rE.message_id, "wamid.EARLY")) === "ok" && (await msgRow(rE.message_id)).status === "read" && (await count("inbox_status_events", `message_id = ${sq(rE.message_id)}`)) === 2);
const rF = await prep(alice.user, conv1, R(41), "early failure");
await status({ id: "wamid.EARLYF", status: "failed", codes: [131047] });
check("an early 'failed' event makes the completed message 'failed' with its codes", (await complete(alice.user, rF.message_id, "wamid.EARLYF")) === "ok" && (await msgRow(rF.message_id)).status === "failed" && JSON.stringify((await msgRow(rF.message_id)).error_codes) === "[131047]");
await status({ id: "wamid.EARLYF", status: "delivered" });
check("...and a later 'delivered' replaces 'failed' (the ranking rule)", (await msgRow(rF.message_id)).status === "delivered");

// ------------------------------------------------------------------ fail
const rX = await prep(alice.user, conv1, R(50), "will be rejected");
check("fail by a non-owner -> not_found", (await failMsg(bob.user, rX.message_id, [131047])) === "not_found");
check("fail -> ok: status 'failed', numeric codes stored, no wamid", (await failMsg(alice.user, rX.message_id, [131047])) === "ok" && (await msgRow(rX.message_id)).status === "failed" && JSON.stringify((await msgRow(rX.message_id)).error_codes) === "[131047]" && (await msgRow(rX.message_id)).provider_message_id === null);
check("fail again -> noop; fail on a message that has a wamid -> noop (it never moves a delivered message)", (await failMsg(alice.user, rX.message_id, [1])) === "noop" && (await failMsg(alice.user, r1.message_id, [1])) === "noop" && (await msgRow(r1.message_id)).status === "read");
check("fail with null codes is accepted (empty array)", await (async () => { const r = await prep(alice.user, conv1, R(51), "x"); return (await failMsg(alice.user, r.message_id, null)) === "ok" && (await msgRow(r.message_id)).error_codes.length === 0; })());
check("a failed message's request id replays as 'existing' with status failed (the caller must not re-send)", (await prep(alice.user, conv1, R(50), "will be rejected")).status === "failed");
check("fail never targets an inbound message", (await failMsg(alice.user, (await q1(`select id from public.inbox_messages where provider_message_id = 'wamid.IN1'`))[0].id, [1])) === "not_found");

// ------------------------------------------------------------------ privileges
const denied = async (role, sub, sql) => /permission denied/i.test((await errOf(() => as(role, sub, sql))) || "");
check("anon and authenticated cannot execute any of the three functions", await denied("anon", null, `select public.inbox_prepare_outbound_text('${alice.user}', '${conv1}', '${R(60)}', 'x')`) && await denied("authenticated", alice.user, `select public.inbox_prepare_outbound_text('${alice.user}', '${conv1}', '${R(60)}', 'x')`)
  && await denied("authenticated", alice.user, `select public.inbox_complete_outbound('${alice.user}', '${r1.message_id}', 'w')`) && await denied("authenticated", alice.user, `select public.inbox_fail_outbound('${alice.user}', '${r1.message_id}', null)`));
check("service_role still has no direct write on the tables (the functions are the only path)", await denied("service_role", null, `insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status) values ('${alice.profile}', '${conv1}', 'whatsapp', 'outbound', 'queued')`) && await denied("service_role", null, `update public.inbox_messages set status = 'read'`));
check("an authenticated user cannot forge a send by writing the table", await denied("authenticated", alice.user, `insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status) values ('${alice.profile}', '${conv1}', 'whatsapp', 'outbound', 'queued')`));
check("the owner can still READ her outbound rows through RLS (Phase 6 unchanged); bob cannot", Number((await as("authenticated", alice.user, `select count(*)::int n from public.inbox_messages where direction = 'outbound'`)).rows[0].n) > 0 && Number((await as("authenticated", bob.user, `select count(*)::int n from public.inbox_messages where profile_id = '${alice.profile}'`)).rows[0].n) === 0);

// ------------------------------------------------------------------ verify detects drift, rollback
const failedLabels = async () => (await q1(firstStatement(VERIFY))).filter((r) => !r.ok).map((r) => r.label.slice(0, 3));
await db.exec(`create or replace function public.inbox_fail_outbound(p_actor_user_id uuid, p_message_id uuid, p_error_codes integer[], p_profile_id uuid) returns text language sql as $$ select 'x'::text $$`);
check("verify detects a changed signature / extra profile parameter", (await failedLabels()).some((l) => ["01 ", "02c", "05 "].includes(l)));
await db.exec(`drop function public.inbox_fail_outbound(uuid, uuid, integer[], uuid)`);
await db.exec(MIGRATION);
check("verify passes again after restoring", (await q1(firstStatement(VERIFY))).every((r) => r.ok));
// the behaviour-marker and object-set checks must catch a weakened function and a stray object
await db.exec(`create or replace function public.inbox_complete_outbound(p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text) returns text language sql security definer set search_path = public, pg_temp as $$ select 'ok'::text $$`);
check("verify detects a weakened function body (ownership / ranking markers missing)", (await failedLabels()).some((l) => ["09 ", "09c", "08 "].includes(l)) || (await failedLabels()).includes("09 "), JSON.stringify(await failedLabels()));
await db.exec(MIGRATION);
await db.exec(`create function public.inbox_stray_helper() returns int language sql as $$ select 1 $$`);
check("verify detects an unexpected extra inbox function", (await failedLabels()).includes("10 "), JSON.stringify(await failedLabels()));
await db.exec(`drop function public.inbox_stray_helper()`);
await db.exec(`create trigger stray_trg before update on public.inbox_messages for each row execute function public.inbox_messages_guard()`);
check("verify detects an unexpected extra trigger on a Phase 4 table", (await failedLabels()).includes("10b"), JSON.stringify(await failedLabels()));
await db.exec(`drop trigger stray_trg on public.inbox_messages`);
check("verify is clean again after removing the strays", (await q1(firstStatement(VERIFY))).every((r) => r.ok));

const rowsBeforeRollback = await count("inbox_messages");
check("rollback runs and is re-runnable", (await errOf(() => db.exec(ROLLBACK))) === null && (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback removed exactly the three functions", (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound')`))[0].n === 0);
check("rollback kept every stored message and left Phase 4 intact (6 tables, ingestion functions, rank helper)", (await count("inbox_messages")) === rowsBeforeRollback && (await q1(`select count(*)::int n from pg_tables where schemaname = 'public' and (tablename like 'inbox\\_%' or tablename = 'wa_accounts')`))[0].n === 6
  && (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status', 'inbox_status_rank')`))[0].n === 3);
check("the objects list after rollback equals the list before the migration", JSON.stringify((await q1(`select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal union all select 'pol:' || policyname from pg_policies order by 1`)).map((r) => r.x)) === objectsBefore);
check("the migration re-applies cleanly after a rollback", (await errOf(() => db.exec(MIGRATION))) === null);

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.name); process.exit(1); }
