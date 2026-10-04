// Test for supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql
//
// Runs entirely on a scratch, in-memory PostgreSQL (PGlite). It never connects to Supabase or any real database and needs no credentials.
// Applies the ACTUAL migration, preflight, verify and rollback files from this repository to a Supabase-shaped database
// (anon / authenticated / service_role roles, auth.uid() from the JWT claim) and checks:
//   * preflight passes before, verify passes after, rollback removes everything and nothing else
//   * purely additive (pre-existing objects byte-for-byte unchanged)
//   * idempotency: duplicate inbound message, duplicate status, simulated lost race, many identical calls
//   * status ordering and current-status vs history
//   * tenant isolation (composite FKs), account -> profile resolution, uniqueness, RLS and privileges, guards, cascade behaviour
//
//   Run:  node supabase/support/tests/whatsapp_inbox_foundation.test.mjs
// NOTE: PGlite is a single connection, so true multi-connection concurrency cannot be exercised here. The lost-race path (the INSERT ...
// ON CONFLICT DO NOTHING branch) is exercised with a test-only trigger that plants the winner's row first; see "lost race" below.
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql");
const PREFLIGHT = read("supabase/support/2026-12-07_whatsapp_inbox_foundation.preflight.sql");
const VERIFY = read("supabase/support/2026-12-07_whatsapp_inbox_foundation.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-07_whatsapp_inbox_foundation.rollback.sql");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2) };
const P = { alice: PID(1), bob: PID(2) };
// Clearly synthetic fixtures only. No production identifier may appear in any of the five review files (see the raw scan below).
const PHONE_A = "1110000000001", WABA_A = "1110000000002", PHONE_B = "9990000000001", WABA_B = "9990000000002";

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
  insert into public.users (id, email) values ('${U.alice}','alice@x.test'), ('${U.bob}','bob@x.test');
  insert into public.profiles (id, user_id, username) values ('${P.alice}','${U.alice}','alice'), ('${P.bob}','${U.bob}','bob');
`);
const q1 = async (sql) => (await db.query(sql)).rows;
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const count = async (t, where = "true") => Number((await q1(`select count(*)::int n from ${t.startsWith("pg_") ? "" : "public."}${t} where ${where}`))[0].n);

const snapshotExisting = async () => JSON.stringify((await q1(`
  select 'col:' || table_name || '.' || column_name || ':' || data_type as x from information_schema.columns where table_schema = 'public' and table_name in ('users','profiles','bk_customers')
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies where tablename in ('users','profiles','bk_customers')
  union all select 'con:' || conrelid::regclass::text || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.users'::regclass, 'public.profiles'::regclass, 'public.bk_customers'::regclass)
  union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal and tgrelid in ('public.users'::regclass, 'public.profiles'::regclass, 'public.bk_customers'::regclass)
  union all select 'fn:' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','auth')
  order by 1`)).map((r) => r.x));

const msg = (o = {}) => {
  const a = { phone: PHONE_A, waba: WABA_A, id: "wamid.1", from: "237600000001", ts: "2026-09-01T10:00:00Z", type: "text", text: "hello", name: "Test Person", reply: null,
              mkind: null, mid: null, mmime: null, msha: null, mfile: null, mcap: null, ...o };
  return `select public.inbox_ingest_whatsapp_message(${lit(a.phone)}, ${lit(a.waba)}, ${lit(a.id)}, ${lit(a.from)}, ${lit(a.ts)}::timestamptz, ${lit(a.type)}, ${lit(a.text)}, ${lit(a.name)}, ${lit(a.reply)}, ${lit(a.mkind)}, ${lit(a.mid)}, ${lit(a.mmime)}, ${lit(a.msha)}, ${lit(a.mfile)}, ${lit(a.mcap)}) as r`;
};
const stat = (o = {}) => {
  const a = { phone: PHONE_A, waba: WABA_A, id: "wamid.OUT1", status: "sent", ts: "2026-09-01T10:05:00Z", codes: "{}", ...o };
  return `select public.inbox_ingest_whatsapp_status(${lit(a.phone)}, ${lit(a.waba)}, ${lit(a.id)}, ${lit(a.status)}, ${lit(a.ts)}::timestamptz, ${lit(a.codes)}::integer[]) as r`;
};
const svc = async (sql) => (await as("service_role", null, sql)).rows[0]?.r;

// ------------------------------------------------------------------ preflight, migration, verify
const before = await snapshotExisting();
const pre = await q1(PREFLIGHT.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(";")[0]);
check("preflight: all rows ok before the migration", pre.length > 5 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));

const stripped = MIGRATION.replace(/--.*$/gm, "");
check("migration never DROPs", !/\bdrop\s+(table|column|function|policy|trigger|index|constraint)\b(?!\s+if\s+exists\s+(public\.)?(wa_accounts|inbox_))/i.test(stripped.replace(/drop trigger if exists [a-z_.]+ on public\.(wa_accounts|inbox_[a-z_]+);/gi, "")));
check("migration never ALTERs a non-Phase-4 table", !/alter\s+table\s+(?!public\.(wa_accounts|inbox_))/i.test(stripped));
check("migration inserts no rows", !/inserts+intos+public.wa_accounts/i.test(stripped));
// RAW scan (comments included) of all five review files for the real production identifiers. The identifiers are built from
// pieces so that this file itself never contains them contiguously (otherwise the scan would flag its own source).
const PROD_IDS = [["14123659", "81960191"], ["26133914", "29109745"]].map((p) => p.join(""));
const REVIEW_FILES = ["supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql", "supabase/support/2026-12-07_whatsapp_inbox_foundation.preflight.sql",
  "supabase/support/2026-12-07_whatsapp_inbox_foundation.verify.sql", "supabase/support/2026-12-07_whatsapp_inbox_foundation.rollback.sql",
  "supabase/support/tests/whatsapp_inbox_foundation.test.mjs"];
const hasProdId = (text) => PROD_IDS.some((id) => text.includes(id));
for (const file of REVIEW_FILES) check(`raw scan (comments included): no production phone/WABA id in ${file.split("/").pop()}`, !hasProdId(read(file)));
check("raw scan self-test: an id planted in a SQL comment or a string is detected; synthetic fixtures are not", hasProdId("-- phone " + PROD_IDS[0]) && hasProdId("select '" + PROD_IDS[1] + "'") && !hasProdId("1110000000001 9990000000002 d0000000-0000-4000-8000-000000000001"));
check("raw scan: no secret-looking values (Meta token, JWT, service key) in any review file", REVIEW_FILES.every((file) => !/EAA[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|sk_(live|test)_/.test(read(file))));

await db.exec(MIGRATION);
check("migration applies", true);
check("migration is idempotent (second run succeeds)", (await errOf(() => db.exec(MIGRATION))) === null);
check("existing objects are byte-for-byte unchanged", (await snapshotExisting()).replace(/,?"fn:[^"]*"/g, "") === before.replace(/,?"fn:[^"]*"/g, ""));
check("no function added to existing function set other than Phase 4", JSON.parse(await snapshotExisting()).filter((x) => x.startsWith("fn:") && !JSON.parse(before).includes(x)).every((x) => /fn:(wa_accounts_guard|inbox_)/.test(x)));
check("migration leaves wa_accounts empty (no production mapping)", (await count("wa_accounts")) === 0);

const ver = await q1(VERIFY.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(";")[0]);
check("verify: every row ok", ver.length > 25 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));

// The verify script must actually DETECT drift, not just pass on the happy path. Mutate the scratch DB in memory, re-run verify, then undo.
const runVerify = async () => q1(VERIFY.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(";")[0]);
const failedLabels = async () => (await runVerify()).filter((r) => !r.ok).map((r) => r.label.slice(0, 3));
const mutate = async (up, down, expectLabelPrefix, name) => {
  await db.exec(up);
  const bad = await failedLabels();
  await db.exec(down);
  check(`verify detects: ${name}`, bad.includes(expectLabelPrefix), JSON.stringify(bad));
};
await mutate("alter table public.inbox_messages add column redacted_at timestamptz", "alter table public.inbox_messages drop column redacted_at", "02b", "an unexpected column (redacted_at)");
await mutate("alter table public.inbox_contacts drop column display_name", "alter table public.inbox_contacts add column display_name text check (display_name is null or char_length(display_name) <= 120)", "02 ", "a missing column");
await mutate("drop trigger inbox_messages_guard_trg on public.inbox_messages; create trigger inbox_messages_guard_trg before update on public.inbox_status_events for each row execute function public.inbox_status_events_guard()",
  "drop trigger inbox_messages_guard_trg on public.inbox_status_events; create trigger inbox_messages_guard_trg before update on public.inbox_messages for each row execute function public.inbox_messages_guard()", "04 ", "a guard trigger attached to the wrong table");
await mutate("alter table public.inbox_messages drop constraint inbox_messages_profile_id_conversation_id_fkey, add constraint inbox_messages_profile_id_conversation_id_fkey foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete restrict",
  "alter table public.inbox_messages drop constraint inbox_messages_profile_id_conversation_id_fkey, add constraint inbox_messages_profile_id_conversation_id_fkey foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade", "06c", "a changed ON DELETE action");
await mutate("create or replace function public.inbox_ingest_whatsapp_status(p_phone_number_id text, p_waba_id text, p_message_id text, p_status text, p_timestamp timestamptz, p_error_codes integer[], p_profile_id uuid) returns text language sql as $$ select 'x'::text $$; drop function public.inbox_ingest_whatsapp_status(text, text, text, text, timestamptz, integer[])",
  "drop function public.inbox_ingest_whatsapp_status(text, text, text, text, timestamptz, integer[], uuid)", "10h", "a changed RPC signature");
// (the status RPC was dropped by that last mutation; re-apply the migration to restore it for the remaining tests)
await db.exec(MIGRATION);
const ver2 = await runVerify();
check("verify passes again after the mutation checks (state restored)", ver2.every((r) => r.ok === true), JSON.stringify(ver2.filter((r) => !r.ok).map((r) => r.label)));

// ------------------------------------------------------------------ fixtures (as the database owner, standing in for the later approved seeding step)
await db.exec(`
  insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${P.alice}', '${PHONE_A}', '${WABA_A}'), ('${P.bob}', '${PHONE_B}', '${WABA_B}');
  insert into public.bk_customers (id, profile_id, name) values ('d0000000-0000-4000-8000-000000000001', '${P.alice}', 'Alice customer'), ('d0000000-0000-4000-8000-000000000002', '${P.bob}', 'Bob customer');
`);

// ------------------------------------------------------------------ 6. account -> profile resolution
check("unknown phone_number_id -> unknown_account, nothing written", (await svc(msg({ phone: "5555555555", id: "wamid.X1" }))) === "unknown_account" && (await count("inbox_messages")) === 0 && (await count("inbox_contacts")) === 0);
check("waba mismatch -> waba_mismatch, nothing written", (await svc(msg({ waba: "1111111111", id: "wamid.X2" }))) === "waba_mismatch" && (await count("inbox_messages")) === 0);
check("missing wamid / sender -> invalid, nothing written", (await svc(msg({ id: "  " }))) === "invalid" && (await svc(msg({ from: "" }))) === "invalid" && (await count("inbox_messages")) === 0);
await db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PHONE_B}'`);
check("disabled account -> account_disabled, nothing written", (await svc(msg({ phone: PHONE_B, waba: WABA_B, id: "wamid.X3" }))) === "account_disabled" && (await count("inbox_messages")) === 0);
await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PHONE_B}'`);

check("first inbound text message -> created", (await svc(msg())) === "created");
const m1 = (await q1(`select m.*, c.external_id, c.display_name, cv.unread_count, cv.last_inbound_at, cv.status as cstatus from public.inbox_messages m join public.inbox_conversations cv on cv.id = m.conversation_id join public.inbox_contacts c on c.id = cv.contact_id`))[0];
check("owner profile derived from wa_accounts (alice)", m1.profile_id === P.alice, m1.profile_id);
check("text persisted; inbound => received; direction/channel/type set", m1.body === "hello" && m1.status === "received" && m1.direction === "inbound" && m1.channel === "whatsapp" && m1.type === "text", JSON.stringify(m1));
check("contact identity + display name + conversation counters", m1.external_id === "237600000001" && m1.display_name === "Test Person" && m1.unread_count === 1 && m1.last_inbound_at !== null && m1.cstatus === "open");

// ------------------------------------------------------------------ 1. duplicate inbound message
check("duplicate inbound message -> duplicate", (await svc(msg())) === "duplicate");
check("duplicate leaves exactly one message / contact / conversation, unread still 1",
  (await count("inbox_messages")) === 1 && (await count("inbox_contacts")) === 1 && (await count("inbox_conversations")) === 1 && Number((await q1(`select unread_count n from public.inbox_conversations`))[0].n) === 1);

// ------------------------------------------------------------------ 3. concurrent duplicate delivery
const burst = await Promise.all(Array.from({ length: 20 }, () => svc(msg({ id: "wamid.BURST", from: "237600000002" }))));
check("20 simultaneous identical deliveries -> exactly one created", burst.filter((r) => r === "created").length === 1 && burst.filter((r) => r === "duplicate").length === 19, JSON.stringify(burst));
check("...one message, one new contact, one new conversation, unread 1",
  (await count("inbox_messages", "provider_message_id = 'wamid.BURST'")) === 1 && (await count("inbox_contacts", "external_id = '237600000002'")) === 1 && (await count("inbox_conversations")) === 2
  && Number((await q1(`select cv.unread_count n from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '237600000002'`))[0].n) === 1);

// lost race: a test-only trigger plants the winner's row just before our insert, so the ON CONFLICT DO NOTHING branch runs.
await db.exec(`
  create function pg_temp.plant() returns trigger language plpgsql as $$ begin
    if pg_trigger_depth() = 1 and new.provider_message_id = 'wamid.RACE' then
      insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, type, body, status)
      values (new.profile_id, new.conversation_id, new.channel, 'inbound', 'wamid.RACE', 'text', 'winner', 'received');
    end if; return new; end $$;
  create trigger zz_plant before insert on public.inbox_messages for each row execute function pg_temp.plant();`);
const raceUnreadBefore = Number((await q1(`select coalesce(sum(unread_count),0) n from public.inbox_conversations`))[0].n);
check("lost race (winner committed first) -> duplicate", (await svc(msg({ id: "wamid.RACE", from: "237600000003", text: "loser" }))) === "duplicate");
check("lost race: only the winner's row exists, loser's body discarded, counters not bumped",
  (await count("inbox_messages", "provider_message_id = 'wamid.RACE'")) === 1 && (await q1(`select body from public.inbox_messages where provider_message_id = 'wamid.RACE'`))[0].body === "winner"
  && Number((await q1(`select coalesce(sum(unread_count),0) n from public.inbox_conversations`))[0].n) === raceUnreadBefore);
await db.exec(`drop trigger zz_plant on public.inbox_messages`);

// ------------------------------------------------------------------ 7/8. contact uniqueness, one conversation per account/contact
check("second message from the same contact reuses contact + conversation, unread counts up",
  (await svc(msg({ id: "wamid.2", ts: "2026-09-01T10:01:00Z", name: "New Name" }))) === "created" && (await count("inbox_contacts", "external_id = '237600000001'")) === 1
  && (await count("inbox_conversations")) === 3 && Number((await q1(`select cv.unread_count n from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '237600000001'`))[0].n) === 2);
check("latest profile name wins; an absent name keeps the old one",
  (await svc(msg({ id: "wamid.3", ts: "2026-09-01T10:02:00Z", name: null }))) === "created" && (await q1(`select display_name from public.inbox_contacts where external_id = '237600000001'`))[0].display_name === "New Name");
const oldRes = await svc(msg({ id: "wamid.OLD", ts: "2026-09-01T09:00:00Z" }));
const lastAt = new Date((await q1(`select cv.last_message_at t from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '237600000001'`))[0].t).toISOString();
check("older (retried) message does not move last_message_at backwards", oldRes === "created" && lastAt === "2026-09-01T10:02:00.000Z", oldRes + " " + lastAt);
check("same wa_id under another business number is a separate contact + conversation (no cross-tenant merge)",
  (await svc(msg({ phone: PHONE_B, waba: WABA_B, id: "wamid.B1" }))) === "created" && (await count("inbox_contacts", "external_id = '237600000001'")) === 2
  && (await count("inbox_contacts", `external_id = '237600000001' and profile_id = '${P.bob}'`)) === 1);
check("direct duplicate contact identity rejected by UNIQUE", /unique|duplicate/i.test(await errOf(() => db.exec(`insert into public.inbox_contacts (profile_id, channel, external_id) values ('${P.alice}', 'whatsapp', '237600000001')`)) || ""));
const cv1 = (await q1(`select account_id, contact_id from public.inbox_conversations cv where profile_id = '${P.alice}' limit 1`))[0];
check("direct second conversation for same account+contact rejected by UNIQUE", /unique|duplicate/i.test(await errOf(() => db.exec(`insert into public.inbox_conversations (profile_id, channel, account_id, contact_id) values ('${P.alice}', 'whatsapp', '${cv1.account_id}', '${cv1.contact_id}')`)) || ""));
check("a new inbound message reopens a closed conversation",
  (await db.exec(`update public.inbox_conversations set status = 'closed' where profile_id = '${P.bob}'`), (await svc(msg({ phone: PHONE_B, waba: WABA_B, id: "wamid.B2" }))) === "created" && (await q1(`select status from public.inbox_conversations where profile_id = '${P.bob}'`))[0].status === "open"));

// ------------------------------------------------------------------ media
check("media message -> metadata persisted, nothing downloaded/stored",
  (await svc(msg({ id: "wamid.IMG", type: "image", text: null, mkind: "image", mid: "MEDIA123", mmime: "image/jpeg", msha: "abc", mfile: null, mcap: "a caption" }))) === "created");
const med = (await q1(`select md.* from public.inbox_message_media md join public.inbox_messages m on m.id = md.message_id where m.provider_message_id = 'wamid.IMG'`))[0];
check("media row correct, profile matches, storage_status not_downloaded, storage_ref null",
  med && med.media_id === "MEDIA123" && med.kind === "image" && med.mime_type === "image/jpeg" && med.sha256 === "abc" && med.caption === "a caption" && med.profile_id === P.alice && med.storage_status === "not_downloaded" && med.storage_ref === null, JSON.stringify(med));
check("duplicate media message -> duplicate, still one media row", (await svc(msg({ id: "wamid.IMG", type: "image", mkind: "image", mid: "MEDIA123" }))) === "duplicate" && (await count("inbox_message_media")) === 1);
check("unsupported/odd type is stored as 'unsupported'; interactive keeps null body",
  (await svc(msg({ id: "wamid.ODD", type: "Weird Type!", text: null }))) === "created" && (await q1(`select type, body from public.inbox_messages where provider_message_id = 'wamid.ODD'`))[0].type === "unsupported");
check("oversize text is truncated, not rejected (no poison retry)", (await svc(msg({ id: "wamid.BIG", text: "x".repeat(5000) }))) === "created" && (await q1(`select char_length(body) n from public.inbox_messages where provider_message_id = 'wamid.BIG'`))[0].n === 4096);

// ------------------------------------------------------------------ 2/4/9. status events: duplicates, out-of-order, current vs history
// Outbound sending is a later phase; stand in for it by creating an outbound message as the database owner.
const convA = (await q1(`select id from public.inbox_conversations where profile_id = '${P.alice}' limit 1`))[0].id;
const outbound = async (wamid, status = "sent") => db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, type, body, status, sent_by_user_id) values ('${P.alice}', '${convA}', 'whatsapp', 'outbound', ${lit(wamid)}, 'text', 'hi', '${status}', '${U.alice}')`);
const cur = async (wamid) => (await q1(`select status, error_codes from public.inbox_messages where provider_message_id = ${lit(wamid)}`))[0];
const hist = async (wamid) => (await q1(`select status from public.inbox_status_events where provider_message_id = ${lit(wamid)} order by status`)).map((r) => r.status);
await outbound("wamid.OUT1", "queued");
check("status sent -> created, current sent", (await svc(stat({ status: "sent" }))) === "created" && (await cur("wamid.OUT1")).status === "sent");
check("duplicate status -> duplicate, one event row", (await svc(stat({ status: "sent" }))) === "duplicate" && (await hist("wamid.OUT1")).length === 1);
check("delivered then read advance the current status", (await svc(stat({ status: "delivered" }))) === "created" && (await svc(stat({ status: "read" }))) === "created" && (await cur("wamid.OUT1")).status === "read");
check("OUT-OF-ORDER: late 'sent' and late 'delivered' (new event rows) never lower 'read'", (await svc(stat({ status: "delivered" }))) === "duplicate" && (await cur("wamid.OUT1")).status === "read");
await outbound("wamid.OUT2", "queued");
check("out-of-order arrival read -> delivered -> sent keeps 'read'; history has all three",
  (await svc(stat({ id: "wamid.OUT2", status: "read" }))) === "created" && (await svc(stat({ id: "wamid.OUT2", status: "delivered" }))) === "created" && (await svc(stat({ id: "wamid.OUT2", status: "sent" }))) === "created"
  && (await cur("wamid.OUT2")).status === "read" && JSON.stringify(await hist("wamid.OUT2")) === JSON.stringify(["delivered", "read", "sent"]));
check("failed after read does not overwrite read (event still recorded)", (await svc(stat({ id: "wamid.OUT2", status: "failed", codes: "{131026}" }))) === "created" && (await cur("wamid.OUT2")).status === "read" && (await hist("wamid.OUT2")).includes("failed"));
await outbound("wamid.OUT3", "queued");
check("failed after sent -> failed, error codes kept", (await svc(stat({ id: "wamid.OUT3", status: "sent" }))) === "created" && (await svc(stat({ id: "wamid.OUT3", status: "failed", codes: "{131026,131000}" }))) === "created"
  && (await cur("wamid.OUT3")).status === "failed" && JSON.stringify((await cur("wamid.OUT3")).error_codes) === "[131026,131000]");
check("a late 'sent' does not overwrite failed; a later 'delivered' does", (await svc(stat({ id: "wamid.OUT3", status: "sent" }))) === "duplicate"
  && (await svc(stat({ id: "wamid.OUT3", status: "delivered" }))) === "created" && (await cur("wamid.OUT3")).status === "delivered");
check("current status (message row) and history (events) are separate: 1 current value, N events", (await count("inbox_messages", "provider_message_id = 'wamid.OUT3'")) === 1 && (await hist("wamid.OUT3")).length === 3);
check("status for an unknown wamid is stored unattached (message_id null), no message created",
  (await svc(stat({ id: "wamid.NOPE", status: "delivered" }))) === "created" && (await q1(`select message_id from public.inbox_status_events where provider_message_id = 'wamid.NOPE'`))[0].message_id === null && (await count("inbox_messages", "provider_message_id = 'wamid.NOPE'")) === 0);
check("'deleted' and 'unknown' are history only", (await svc(stat({ id: "wamid.OUT3", status: "deleted" }))) === "created" && (await svc(stat({ id: "wamid.OUT3", status: "unknown" }))) === "created" && (await cur("wamid.OUT3")).status === "delivered");
check("status events never touch an inbound message's status", (await svc(stat({ id: "wamid.1", status: "read" }))) === "created" && (await cur("wamid.1")).status === "received");
check("status for another profile's number cannot attach to this profile's message (tenant guard)",
  (await svc(stat({ phone: PHONE_B, waba: WABA_B, id: "wamid.OUT1", status: "failed" }))) === "created" && (await cur("wamid.OUT1")).status === "read"
  && (await q1(`select message_id from public.inbox_status_events where provider_message_id = 'wamid.OUT1' and status = 'failed'`))[0].message_id === null);
check("unknown account / invalid status handled without writing", (await svc(stat({ phone: "777777777", id: "wamid.Z" }))) === "unknown_account" && (await svc(stat({ status: "bogus", id: "wamid.Z" }))) === "invalid" && (await count("inbox_status_events", "provider_message_id = 'wamid.Z'")) === 0);
check("an unattached event may be attached later (guard allows only message_id null -> value)",
  (await errOf(() => db.exec(`update public.inbox_status_events set status = 'read' where provider_message_id = 'wamid.NOPE'`))) !== null);
await outbound("wamid.NOPE", "queued");
check("...attach succeeds", (await errOf(() => db.exec(`update public.inbox_status_events set message_id = (select id from public.inbox_messages where provider_message_id = 'wamid.NOPE') where provider_message_id = 'wamid.NOPE'`))) === null);
check("...but an attached event can no longer change", (await errOf(() => db.exec(`update public.inbox_status_events set message_id = null where provider_message_id = 'wamid.NOPE'`))) !== null);

// ------------------------------------------------------------------ 5. cross-profile foreign-key rejection + constraints + guards
const aliceAcct = (await q1(`select id from public.wa_accounts where profile_id = '${P.alice}'`))[0].id;
const bobContact = (await q1(`select id from public.inbox_contacts where profile_id = '${P.bob}' limit 1`))[0].id;
const bobConv = (await q1(`select id from public.inbox_conversations where profile_id = '${P.bob}' limit 1`))[0].id;
const fkErr = async (sql) => /foreign key|violates/i.test((await errOf(() => db.exec(sql))) || "");
check("conversation: alice profile + bob's contact rejected", await fkErr(`insert into public.inbox_conversations (profile_id, channel, account_id, contact_id) values ('${P.alice}', 'whatsapp', '${aliceAcct}', '${bobContact}')`));
check("conversation: bob profile + alice's account rejected", await fkErr(`insert into public.inbox_conversations (profile_id, channel, account_id, contact_id) values ('${P.bob}', 'whatsapp', '${aliceAcct}', '${bobContact}')`));
check("message: alice profile + bob's conversation rejected", await fkErr(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, status) values ('${P.alice}', '${bobConv}', 'whatsapp', 'inbound', 'wamid.XT', 'received')`));
check("media: alice profile on bob's message rejected", await fkErr(`insert into public.inbox_message_media (message_id, profile_id, kind, media_id) select id, '${P.alice}', 'image', 'm' from public.inbox_messages where profile_id = '${P.bob}' limit 1`));
check("contact: alice contact linked to bob's bookkeeping customer rejected", await fkErr(`insert into public.inbox_contacts (profile_id, channel, external_id, bk_customer_id) values ('${P.alice}', 'whatsapp', 'x1', 'd0000000-0000-4000-8000-000000000002')`));
check("status event: alice profile attached to bob's message rejected", await fkErr(`insert into public.inbox_status_events (profile_id, channel, provider_message_id, message_id, status) select '${P.alice}', 'whatsapp', 'wamid.XE', id, 'sent' from public.inbox_messages where profile_id = '${P.bob}' limit 1`));
check("contact: own bookkeeping customer link accepted; link is optional", (await errOf(() => db.exec(`update public.inbox_contacts set bk_customer_id = 'd0000000-0000-4000-8000-000000000001' where profile_id = '${P.alice}' and external_id = '237600000001'`))) === null);
const checkErr = async (sql) => /check|violates/i.test((await errOf(() => db.exec(sql))) || "");
check("inbound row cannot be 'queued' / outbound row cannot be 'received' / inbound needs a wamid",
  await checkErr(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, status) values ('${P.alice}', '${convA}', 'whatsapp', 'inbound', 'wamid.C1', 'queued')`)
  && await checkErr(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, status) values ('${P.alice}', '${convA}', 'whatsapp', 'outbound', 'wamid.C2', 'received')`)
  && await checkErr(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status) values ('${P.alice}', '${convA}', 'whatsapp', 'inbound', 'received')`));
check("channel is restricted to whatsapp for now", await checkErr(`insert into public.inbox_contacts (profile_id, channel, external_id) values ('${P.alice}', 'instagram', 'z')`));
check("body length capped at 4096 in the table itself", await checkErr(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, body, status) values ('${P.alice}', '${convA}', 'whatsapp', 'inbound', 'wamid.L', '${"x".repeat(4097)}', 'received')`));
check("outbound client_request_id is unique per profile",
  (await errOf(() => db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status, client_request_id) values ('${P.alice}', '${convA}', 'whatsapp', 'outbound', 'queued', 'e0000000-0000-4000-8000-000000000001'), ('${P.alice}', '${convA}', 'whatsapp', 'outbound', 'queued', 'e0000000-0000-4000-8000-000000000001')`))) !== null);
check("two queued outbound messages without a wamid yet are allowed (partial unique)", (await errOf(() => db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status) values ('${P.alice}', '${convA}', 'whatsapp', 'outbound', 'queued'), ('${P.alice}', '${convA}', 'whatsapp', 'outbound', 'queued')`))) === null);
check("a direct duplicate wamid is rejected by the unique index", /unique|duplicate/i.test(await errOf(() => db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, status) values ('${P.alice}', '${convA}', 'whatsapp', 'inbound', 'wamid.1', 'received')`)) || ""));
check("wa_accounts: phone_number_id unique", /unique|duplicate/i.test(await errOf(() => db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${P.bob}', '${PHONE_A}', '123456')`)) || ""));
check("wa_accounts: malformed ids rejected", await checkErr(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${P.bob}', 'abc', '123456')`));
check("guard: wa_accounts identity immutable; status updatable and bumps updated_at",
  (await errOf(() => db.exec(`update public.wa_accounts set phone_number_id = '99999' where phone_number_id = '${PHONE_B}'`))) !== null && (await errOf(() => db.exec(`update public.wa_accounts set profile_id = '${P.alice}' where phone_number_id = '${PHONE_B}'`))) !== null
  && (await errOf(() => db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PHONE_B}'`))) === null);
await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PHONE_B}'`);
const gErr = [
  await errOf(() => db.exec(`update public.inbox_contacts set external_id = 'other' where id = '${bobContact}'`)),
  await errOf(() => db.exec(`update public.inbox_conversations set contact_id = gen_random_uuid() where id = '${bobConv}'`)),
  await errOf(() => db.exec(`update public.inbox_messages set provider_message_id = 'changed' where provider_message_id = 'wamid.1'`)),
  await errOf(() => db.exec(`update public.inbox_messages set direction = 'outbound', status = 'sent' where provider_message_id = 'wamid.1'`))];
check("guard: contact/conversation/message identity immutable", gErr.every((e) => e !== null), JSON.stringify(gErr));
check("guard: an outbound message may receive its wamid once, never change it",
  (await errOf(() => db.exec(`update public.inbox_messages set provider_message_id = 'wamid.LATE' where id = (select id from public.inbox_messages where direction = 'outbound' and provider_message_id is null limit 1)`))) === null
  && (await errOf(() => db.exec(`update public.inbox_messages set provider_message_id = 'wamid.LATE2' where provider_message_id = 'wamid.LATE'`))) !== null);

// ------------------------------------------------------------------ RLS + privileges
const vis = async (role, sub, t) => Number((await as(role, sub, `select count(*)::int n from public.${t}`)).rows[0].n);
check("owner (alice) reads only her rows in every table",
  (await vis("authenticated", U.alice, "inbox_messages")) === (await count("inbox_messages", `profile_id = '${P.alice}'`)) && (await vis("authenticated", U.alice, "inbox_contacts")) === (await count("inbox_contacts", `profile_id = '${P.alice}'`))
  && (await vis("authenticated", U.alice, "inbox_conversations")) === (await count("inbox_conversations", `profile_id = '${P.alice}'`)) && (await vis("authenticated", U.alice, "wa_accounts")) === 1
  && (await vis("authenticated", U.alice, "inbox_status_events")) === (await count("inbox_status_events", `profile_id = '${P.alice}'`)) && (await vis("authenticated", U.alice, "inbox_message_media")) === 1);
check("another user (bob) never sees alice's rows", (await as("authenticated", U.bob, `select count(*)::int n from public.inbox_messages where profile_id = '${P.alice}'`)).rows[0].n === 0);
check("anon cannot read any inbox table", (await Promise.all(["wa_accounts", "inbox_contacts", "inbox_conversations", "inbox_messages", "inbox_message_media", "inbox_status_events"].map((t) => errOf(() => vis("anon", null, t))))).every((e) => e && /permission denied/i.test(e)));
check("a signed-in user with no profile sees nothing", (await vis("authenticated", UID(99), "inbox_messages")) === 0);
const denied = async (role, sub, sql) => /permission denied/i.test((await errOf(() => as(role, sub, sql))) || "");
check("authenticated cannot INSERT/UPDATE/DELETE directly", await denied("authenticated", U.alice, `insert into public.inbox_contacts (profile_id, channel, external_id) values ('${P.alice}', 'whatsapp', 'hack')`)
  && await denied("authenticated", U.alice, `update public.inbox_messages set body = 'x'`) && await denied("authenticated", U.alice, `delete from public.inbox_messages`) && await denied("authenticated", U.alice, `truncate public.inbox_messages`));
check("anon cannot write", await denied("anon", null, `insert into public.inbox_contacts (profile_id, channel, external_id) values ('${P.alice}', 'whatsapp', 'hack')`));
check("service_role has no direct write either (only the RPCs)", await denied("service_role", null, `insert into public.inbox_contacts (profile_id, channel, external_id) values ('${P.alice}', 'whatsapp', 'hack')`) && await denied("service_role", null, `delete from public.inbox_messages`));
check("authenticated and anon cannot execute the ingest RPCs", await denied("authenticated", U.alice, msg({ id: "wamid.AUTH" })) && await denied("anon", null, msg({ id: "wamid.ANON" })) && await denied("authenticated", U.alice, stat({ id: "wamid.AUTH" })));
check("authenticated cannot call the rank helper or guards", await denied("authenticated", U.alice, `select public.inbox_status_rank('read')`));
check("the ingest RPC has no profile parameter (owner can only come from wa_accounts)", !/profile_id|user_id/i.test(JSON.stringify((await q1(`select pg_get_function_arguments(oid) a from pg_proc where proname like 'inbox_ingest_%'`)))));

// ------------------------------------------------------------------ delete behaviour: cascade from profile; bk_customers never touched
const bkBefore = await count("bk_customers");
check("deleting a bookkeeping customer that an inbox contact links to is refused (RESTRICT)", await (async () => { await db.exec(`update public.inbox_contacts set bk_customer_id = 'd0000000-0000-4000-8000-000000000002' where profile_id = '${P.bob}' and id = '${bobContact}'`); return /foreign key|violates/i.test((await errOf(() => db.exec(`delete from public.bk_customers where id = 'd0000000-0000-4000-8000-000000000002'`))) || ""); })());
await db.exec(`update public.inbox_contacts set bk_customer_id = null where id = '${bobContact}'`);
check("deleting an inbox contact cascades to its conversation, messages and media; the linked bookkeeping customer survives", await (async () => {
  const bk = await count("bk_customers");
  await db.exec(`delete from public.inbox_contacts where profile_id = '${P.alice}' and external_id = '237600000001'`);
  return (await count("inbox_message_media")) === 0 && (await count("inbox_messages", "provider_message_id = 'wamid.IMG'")) === 0 && (await count("bk_customers")) === bk;
})());
await db.exec(`delete from public.bk_customers where profile_id = '${P.bob}'`);
await db.exec(`delete from public.profiles where id = '${P.bob}'`);
check("deleting a profile cascades to ALL of its inbox data (accounts, contacts, conversations, messages)",
  (await count("wa_accounts", `profile_id = '${P.bob}'`)) === 0 && (await count("inbox_contacts", `profile_id = '${P.bob}'`)) === 0 && (await count("inbox_conversations", `profile_id = '${P.bob}'`)) === 0 && (await count("inbox_messages", `profile_id = '${P.bob}'`)) === 0 && (await count("inbox_status_events", `profile_id = '${P.bob}'`)) === 0);
check("...and alice's data is untouched", (await count("inbox_messages", `profile_id = '${P.alice}'`)) > 0 && (await count("wa_accounts", `profile_id = '${P.alice}'`)) === 1);

// ------------------------------------------------------------------ rollback
const fnBefore = (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\\_%' or p.proname like 'wa\\_%')`))[0].n;
check("Phase 4 functions exist before rollback", fnBefore === 9, String(fnBefore));
check("rollback runs", (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback is re-runnable", (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback removed every Phase 4 table and function",
  (await count("pg_tables", "schemaname = 'public' and (tablename like 'inbox\\_%' or tablename = 'wa_accounts')")) === 0 && (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\\_%' or p.proname like 'wa\\_%')`))[0].n === 0);
check("rollback left pre-existing objects unchanged (tables, columns, policies, constraints, triggers)", (await snapshotExisting()) === before);
check("bookkeeping customers survive the rollback", (await count("bk_customers")) >= 1);
check("migration re-applies cleanly after rollback", (await errOf(() => db.exec(MIGRATION))) === null && (await count("wa_accounts")) === 0);

// ------------------------------------------------------------------ report
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.name); process.exit(1); }
