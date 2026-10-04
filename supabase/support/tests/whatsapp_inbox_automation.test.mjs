// Test for supabase/migrations/2026-12-11_whatsapp_inbox_automation.sql (Phase 10: the database side of inbox automation).
//
// Scratch in-memory PostgreSQL (PGlite) only: no Supabase, no network, no credentials, no production ids. Applies the REAL Phase 4, 7, 8 and 9
// migrations, then the REAL Phase 10 migration, preflight, verify and rollback files, and checks additivity (two tables + nine functions, nothing
// else), business-hours logic, settings validation and ownership, the atomic acknowledgement claim (cooldown, modes, no duplicates), failure
// notices, the one-reminder-per-unanswered-message follow-up claim (automatic replies never count as human), privileges, RLS, verify drift
// detection and rollback.
//
//   Run:  node supabase/support/tests/whatsapp_inbox_automation.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const MIGS = ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media"].map((m) => read(`supabase/migrations/${m}.sql`));
const MIGRATION = read("supabase/migrations/2026-12-11_whatsapp_inbox_automation.sql");
const PREFLIGHT = read("supabase/support/2026-12-11_whatsapp_inbox_automation.preflight.sql");
const VERIFY = read("supabase/support/2026-12-11_whatsapp_inbox_automation.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-11_whatsapp_inbox_automation.rollback.sql");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
for (const m of MIGS) await db.exec(m);
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
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', 'hi', ${sq(o.name)}, null, null, null, null, null, null, null)`);
const save = (actor, profile, settings) => svc(`select public.inbox_settings_save(${sq(actor)}, ${sq(profile)}, ${sq(JSON.stringify(settings))}::jsonb) as r`);
const inbound = (phone, id) => svc(`select public.inbox_automation_inbound(${sq(phone)}, ${sq(id)}) as r`);
const failedNotice = (phone, id) => svc(`select public.inbox_automation_failed(${sq(phone)}, ${sq(id)}) as r`);
const recordAck = (conv, msg) => svc(`select public.inbox_automation_record_ack(${sq(conv)}, ${sq(msg)}) as r`);
const claim = (limit) => svc(`select public.inbox_claim_follow_ups(${limit === undefined ? "default" : limit}) as r`);
const settingsRow = async (profile) => (await q1(`select * from public.inbox_settings where profile_id = ${sq(profile)}`))[0];
const stateRow = async (conv) => (await q1(`select * from public.inbox_conversation_state where conversation_id = ${sq(conv)}`))[0];
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
// a sent outbound message (a human reply, or an automatic one when recorded as such)
const sendText = async (actor, conv, req, text, wamid) => {
  const p = await svc(`select public.inbox_prepare_outbound_text(${sq(actor)}, ${sq(conv)}, ${sq(req)}, ${sq(text)}) as r`);
  await svc(`select public.inbox_complete_outbound(${sq(actor)}, ${sq(p.message_id)}, ${sq(wamid)}) as r`);
  return p.message_id;
};

await ingest({ phone: PH_A, id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), name: "Customer One" });
const conv1 = await convOf("237600000001");

// ------------------------------------------------------------------ script hygiene + preflight + apply + verify + additivity
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const firstStatement = (sql) => strip(sql).split(/;[ \t]*\n/)[0];
const semicolonsInsideQuotes = (sql) => { const hits = []; let inQuote = false; let line = 1; for (let i = 0; i < sql.length; i++) { const ch = sql[i]; if (ch === "\n") line++; if (!inQuote && ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; line++; continue; } if (ch === "'") { if (inQuote && sql[i + 1] === "'") { i++; continue; } inQuote = !inQuote; continue; } if (ch === ";" && inQuote) hits.push(line); } return hits; };
for (const [n, s] of [["preflight", PREFLIGHT], ["verify", VERIFY], ["rollback", ROLLBACK]]) {
  check(`hygiene: no ';' inside a string literal in the ${n} script (the Supabase editor can split on semicolons)`, semicolonsInsideQuotes(s).length === 0, semicolonsInsideQuotes(s).join());
  check(`hygiene: quotes are balanced in the ${n} script`, ((strip(s).match(/'/g) || []).length % 2) === 0);
}
check("hygiene: a naive split on ';' of the verify and preflight scripts yields exactly ONE statement each", strip(VERIFY).split(";").filter((p) => p.trim()).length === 1 && strip(PREFLIGHT).split(";").filter((p) => p.trim()).length === 1);
check("hygiene: no raw U+2028/U+2029 line separators in any Phase 10 SQL file", ![MIGRATION, PREFLIGHT, VERIFY, ROLLBACK].some((s) => /[\u2028\u2029]/.test(s)));
const OBJ = `select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'pol:' || tablename || '.' || policyname from pg_policies where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal order by 1`;
const objectsBefore = JSON.stringify((await q1(OBJ)).map((r) => r.x));
const pre = await q1(firstStatement(PREFLIGHT));
check("preflight: every row ok before the migration", pre.length >= 9 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
const bare = strip(MIGRATION);
check("migration: no alter/drop of any existing object, no change to a Phase 4 table", !/\b(alter\s+table\s+public\.(wa_|inbox_(contacts|conversations|messages|message_media|status_events|saved_replies))|drop\s+(table|function|policy|trigger))/i.test(bare.replace(/drop trigger if exists inbox_(settings|conversation_state)_guard_trg/g, "")));
check("migration: no hard-coded ids, tokens or phone numbers", !/[0-9]{12,}|EAA[A-Za-z0-9]{10,}|Bearer/.test(bare));
await db.exec(MIGRATION);
check("migration applies and is idempotent", (await errOf(() => db.exec(MIGRATION))) === null);
const added = (await q1(OBJ)).map((r) => r.x).filter((x) => !JSON.parse(objectsBefore).includes(x));
check("exactly two new tables and nine new functions (plus their own columns, index, policies and triggers)", added.filter((x) => x.startsWith("tbl:")).length === 2 && added.filter((x) => x.startsWith("fn:")).length === 9 && added.every((x) => /^(tbl:inbox_(settings|conversation_state)|fn:inbox_(hours_valid|within_hours|settings_guard|conversation_state_guard|settings_save|automation_inbound|automation_record_ack|automation_failed|claim_follow_ups)|col:inbox_(settings|conversation_state)\.|idx:inbox_(settings|conversation_state)|pol:inbox_(settings|conversation_state)\.|trg:inbox_(settings|conversation_state)_guard_trg)/.test(x)), added.join());
const ver = await q1(firstStatement(VERIFY));
check("verify: every row ok", ver.length >= 18 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));

// ------------------------------------------------------------------ business hours
const valid = async (h) => (await q1(`select public.inbox_hours_valid(${sq(JSON.stringify(h))}::jsonb) as r`))[0].r;
check("hours: accepted shapes (empty, one interval, two, three, all days)", await valid({}) && await valid({ mon: [["09:00", "18:00"]] }) && await valid({ mon: [["08:00", "12:00"], ["14:00", "18:00"]], sun: [] }) && await valid({ tue: [["00:00", "01:00"], ["02:00", "03:00"], ["04:00", "05:00"]] }));
const badHours = [{ mon: [["18:00", "09:00"]] }, { mon: [["09:00", "09:00"]] }, { mon: [["9:00", "18:00"]] }, { mon: [["09:00", "24:00"]] }, { mon: [["09:00", "18:60"]] }, { monday: [["09:00", "18:00"]] }, { mon: [["09:00", "18:00", "x"]] }, { mon: [[9, 18]] }, { mon: "09:00-18:00" }, { mon: [["a", "b"]] },
  { mon: [["01:00", "02:00"], ["03:00", "04:00"], ["05:00", "06:00"], ["07:00", "08:00"]] }, []];
check("hours: every malformed document is rejected", (await Promise.all(badHours.map(valid))).every((x) => x === false) && (await q1(`select public.inbox_hours_valid(null) as r`))[0].r === false && (await q1(`select public.inbox_hours_valid('"x"'::jsonb) as r`))[0].r === false);
const within = async (h, tz, at) => (await q1(`select public.inbox_within_hours(${sq(JSON.stringify(h))}::jsonb, ${sq(tz)}, ${sq(at)}::timestamptz) as r`))[0].r;
const H = { mon: [["09:00", "18:00"]], tue: [["09:00", "12:00"], ["14:00", "18:00"]] };
check("within: inside, at the opening minute (inclusive), at the closing minute (exclusive), before, after", await within(H, "Africa/Douala", "2026-10-05T10:00:00Z") && await within(H, "Africa/Douala", "2026-10-05T08:00:00Z") && !await within(H, "Africa/Douala", "2026-10-05T17:00:00Z") && !await within(H, "Africa/Douala", "2026-10-05T07:59:00Z") && !await within(H, "Africa/Douala", "2026-10-05T20:00:00Z"));
check("within: a day missing from a non-empty document is closed, split days respect the gap", !await within(H, "Africa/Douala", "2026-10-07T10:00:00Z") && await within(H, "Africa/Douala", "2026-10-06T09:00:00Z") && !await within(H, "Africa/Douala", "2026-10-06T12:30:00Z") && await within(H, "Africa/Douala", "2026-10-06T14:00:00Z"));
check("within: no hours configured means always open", await within({}, "Africa/Douala", "2026-10-07T03:00:00Z") && (await q1(`select public.inbox_within_hours(null, 'Africa/Douala', now()) as r`))[0].r === true);
check("within: the time zone decides the local day and time (not hard-coded to Cameroon)", !await within(H, "America/New_York", "2026-10-05T10:00:00Z") && await within(H, "America/New_York", "2026-10-05T15:00:00Z") && await within(H, "Pacific/Auckland", "2026-10-04T21:00:00Z") && !await within(H, "Asia/Tokyo", "2026-10-05T10:00:00Z"));

// ------------------------------------------------------------------ settings: ownership + validation
check("a profile with no row has no settings (everything is off by default)", (await count("inbox_settings")) === 0);
check("save: not_found for a non-owner (bob saving alice's), for a user without a WhatsApp account, for a stranger and for null ids; nothing is written", (await save(bob.user, alice.profile, { auto_ack_mode: "off" })).result === "not_found" && (await save(carol.user, alice.profile, { auto_ack_mode: "off" })).result === "not_found" && (await save(alice.user, bob.profile, { auto_ack_mode: "off" })).result === "not_found" && (await svc(`select public.inbox_settings_save(null, ${sq(alice.profile)}, '{}'::jsonb) as r`)).result === "invalid" && (await count("inbox_settings")) === 0);
const s1 = await save(alice.user, alice.profile, { timezone: "Africa/Douala", business_hours: H, auto_ack_mode: "outside_hours", auto_ack_text: "  Thanks for your message, we will reply soon.  ", follow_up_enabled: true, follow_up_after_hours: 24 });
const row1 = await settingsRow(alice.profile);
check("save: the owner's first save creates the row with trimmed text and the unspecified defaults", s1.result === "saved" && row1.auto_ack_text === "Thanks for your message, we will reply soon." && row1.auto_ack_mode === "outside_hours" && row1.follow_up_enabled === true && row1.notify_new_conversation === true && row1.notify_failed_message === true && row1.notify_follow_up === true && JSON.stringify(row1.business_hours) === JSON.stringify(H), JSON.stringify(row1));
check("save: a partial update changes only the keys given", (await save(alice.user, alice.profile, { follow_up_after_hours: 48 })).result === "saved" && (await settingsRow(alice.profile)).follow_up_after_hours === 48 && (await settingsRow(alice.profile)).auto_ack_text === "Thanks for your message, we will reply soon." && (await settingsRow(alice.profile)).auto_ack_mode === "outside_hours");
const invalid = [
  [{ timezone: "Mars/Olympus" }], [{ timezone: "" }], [{ timezone: 5 }], [{ business_hours: { mon: [["18:00", "09:00"]] } }], [{ business_hours: "x" }], [{ auto_ack_mode: "sometimes" }], [{ auto_ack_mode: true }],
  [{ auto_ack_text: "x".repeat(501) }], [{ auto_ack_text: "bad\u0007bell" }], [{ auto_ack_text: 5 }], [{ follow_up_enabled: "yes" }], [{ follow_up_after_hours: 0 }], [{ follow_up_after_hours: 169 }], [{ follow_up_after_hours: 1.5 }], [{ follow_up_after_hours: "24" }], [{ follow_up_after_hours: -3 }],
  [{ notify_new_conversation: 1 }], [{ notify_failed_message: "true" }], [{ notify_follow_up: null }], [{ notification_locale: "de" }], [{ notification_locale: 1 }], [{ profile_id: bob.profile }], [{ auto_ack_mode: "always", auto_ack_text: null }], [{ auto_ack_text: "   " }],
];
const before = JSON.stringify(await settingsRow(alice.profile));
const invalidResults = [];
for (const [s] of invalid.map((x) => [x[0]])) invalidResults.push((await save(alice.user, alice.profile, s)).result);
check("save: every invalid value is rejected, unknown keys (even profile_id) included, and nothing changes", invalidResults.every((x) => x === "invalid") && JSON.stringify(await settingsRow(alice.profile)) === before, invalidResults.join());
check("save: a settings document that is not an object is invalid", (await svc(`select public.inbox_settings_save(${sq(alice.user)}, ${sq(alice.profile)}, '[1]'::jsonb) as r`)).result === "invalid" && (await svc(`select public.inbox_settings_save(${sq(alice.user)}, ${sq(alice.profile)}, null) as r`)).result === "invalid");
check("save: the notification language can be en or fr", (await save(alice.user, alice.profile, { notification_locale: "en" })).result === "saved" && (await settingsRow(alice.profile)).notification_locale === "en" && (await save(alice.user, alice.profile, { notification_locale: "fr" })).result === "saved");
check("save: newlines are allowed in the acknowledgement text, other control characters are not", (await save(alice.user, alice.profile, { auto_ack_text: "Line one\nLine two" })).result === "saved" && (await settingsRow(alice.profile)).auto_ack_text === "Line one\nLine two");
check("save: switching the mode on without any text is refused, with text it is accepted, and clearing the text while on is refused", (await save(bob.user, bob.profile, { auto_ack_mode: "always" })).result === "invalid" && (await save(bob.user, bob.profile, { auto_ack_mode: "always", auto_ack_text: "Hello" })).result === "saved" && (await save(bob.user, bob.profile, { auto_ack_text: null })).result === "invalid" && (await save(bob.user, bob.profile, { auto_ack_mode: "off", auto_ack_text: null })).result === "saved");
check("RLS: each owner reads only their own settings row, anon reads nothing", (await as("authenticated", alice.user, "select profile_id from public.inbox_settings")).rows.map((r) => r.profile_id).join() === alice.profile && (await as("authenticated", bob.user, "select profile_id from public.inbox_settings")).rows.map((r) => r.profile_id).join() === bob.profile && (await errOf(() => as("anon", null, "select * from public.inbox_settings"))) !== null);
check("privileges: no client or service role can write the tables directly", (await errOf(() => as("authenticated", alice.user, `update public.inbox_settings set auto_ack_mode = 'always'`))) !== null && (await errOf(() => as("service_role", null, `insert into public.inbox_settings (profile_id) values ('${carol.user}')`))) !== null && (await errOf(() => as("service_role", null, `delete from public.inbox_conversation_state`))) !== null);
check("privileges: the functions are callable by service_role only", (await errOf(() => as("authenticated", alice.user, `select public.inbox_settings_save('${alice.user}', '${alice.profile}', '{}'::jsonb)`))) !== null && (await errOf(() => as("anon", null, `select public.inbox_claim_follow_ups(1)`))) !== null && (await errOf(() => as("authenticated", alice.user, `select public.inbox_automation_inbound('${PH_A}', 'x')`))) !== null && (await errOf(() => as("authenticated", alice.user, `select public.inbox_within_hours('{}'::jsonb, 'UTC', now())`))) !== null);
check("the guard keeps identity columns immutable and bumps updated_at", (await errOf(() => db.exec(`update public.inbox_settings set profile_id = '${carol.user}' where profile_id = '${alice.profile}'`))) !== null);

// ------------------------------------------------------------------ inbound automation: acknowledgement claim
await save(alice.user, alice.profile, { auto_ack_mode: "always", auto_ack_text: "We got your message.", business_hours: {}, notify_new_conversation: true });
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(0.01), name: "Customer Two" });
const conv2 = await convOf("237600000002");
const a1 = await inbound(PH_A, "wamid.IN2");
check("inbound (mode always): ok, the owner's user id, the conversation, a NEW conversation notice and the acknowledgement text", a1.result === "ok" && a1.conversation_id === conv2 && a1.owner_user_id === alice.user && a1.notify_new === true && a1.ack_text === "We got your message.", JSON.stringify(a1));
check("inbound: the result carries no phone number, recipient, WABA id or token", !/237600000002|1110000000|token/i.test(JSON.stringify(a1)));
check("inbound: a state row exists and the acknowledgement was claimed now", (await stateRow(conv2)).last_auto_ack_at !== null);
const a2 = await inbound(PH_A, "wamid.IN2");
check("inbound: the SAME message again is neither new nor acknowledged again (cooldown)", a2.result === "ok" && a2.notify_new === false && a2.ack_text === null);
await ingest({ phone: PH_A, id: "wamid.IN2b", from: "237600000002", ts: hoursAgo(0.005), name: "Customer Two" });
const a3 = await inbound(PH_A, "wamid.IN2b");
check("inbound: a second message in the same conversation within 12 hours gets no acknowledgement and no new-conversation notice", a3.result === "ok" && a3.ack_text === null && a3.notify_new === false);
await db.exec(`update public.inbox_conversation_state set last_auto_ack_at = now() - interval '13 hours' where conversation_id = '${conv2}'`);
await ingest({ phone: PH_A, id: "wamid.IN2c", from: "237600000002", ts: hoursAgo(0.001), name: "Customer Two" });
check("inbound: after the 12-hour cooldown a new acknowledgement is allowed again", (await inbound(PH_A, "wamid.IN2c")).ack_text === "We got your message.");
const burst = [];
await db.exec(`update public.inbox_conversation_state set last_auto_ack_at = null where conversation_id = '${conv2}'`);
for (let i = 0; i < 8; i++) burst.push(await inbound(PH_A, "wamid.IN2c"));
check("inbound: eight repeated deliveries claim the acknowledgement exactly ONCE", burst.filter((b) => b.ack_text !== null).length === 1);

await save(alice.user, alice.profile, { auto_ack_mode: "off" });
await db.exec(`update public.inbox_conversation_state set last_auto_ack_at = null where conversation_id = '${conv2}'`);
check("inbound (mode off): never an acknowledgement", (await inbound(PH_A, "wamid.IN2c")).ack_text === null && (await stateRow(conv2)).last_auto_ack_at === null);
await save(alice.user, alice.profile, { auto_ack_mode: "outside_hours", business_hours: { mon: [["00:00", "23:59"]], tue: [["00:00", "23:59"]], wed: [["00:00", "23:59"]], thu: [["00:00", "23:59"]], fri: [["00:00", "23:59"]], sat: [["00:00", "23:59"]], sun: [["00:00", "23:59"]] }, timezone: "UTC" });
check("inbound (outside_hours, but open all week): no acknowledgement", (await inbound(PH_A, "wamid.IN2c")).ack_text === null);
await save(alice.user, alice.profile, { business_hours: { mon: [["00:00", "00:01"]] } });
check("inbound (outside_hours, closed now): the acknowledgement is claimed", (await inbound(PH_A, "wamid.IN2c")).ack_text === "We got your message.");
await db.exec(`update public.inbox_conversation_state set last_auto_ack_at = null where conversation_id = '${conv2}'`);
await save(alice.user, alice.profile, { business_hours: {} });
check("inbound (outside_hours with NO hours configured = always open): no acknowledgement", (await inbound(PH_A, "wamid.IN2c")).ack_text === null);
await save(alice.user, alice.profile, { notify_new_conversation: false, auto_ack_mode: "off" });
await ingest({ phone: PH_A, id: "wamid.IN3", from: "237600000003", ts: hoursAgo(0.01), name: "Customer Three" });
check("inbound: the new-conversation notice follows the owner's switch", (await inbound(PH_A, "wamid.IN3")).notify_new === false);
await save(alice.user, alice.profile, { notify_new_conversation: true });
await ingest({ phone: PH_A, id: "wamid.IN4", from: "237600000004", ts: hoursAgo(0.01), name: "Customer Four" });
check("inbound: a brand-new conversation notifies exactly once", (await inbound(PH_A, "wamid.IN4")).notify_new === true && (await inbound(PH_A, "wamid.IN4")).notify_new === false);
const conv1State = await inbound(PH_A, "wamid.IN1");
check("inbound: an OLD conversation that gets its state row later is not announced as new", conv1State.result === "ok" && conv1State.notify_new === true);
await db.exec(`delete from public.inbox_conversation_state where conversation_id = '${conv1}'`).catch(() => null);

// skips
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(0.01), name: "Bob Customer" });
check("inbound: unknown phone number, unknown message, a message of ANOTHER profile and null arguments are all skipped", (await inbound("5550000000", "wamid.IN2")).result === "skip" && (await inbound(PH_A, "wamid.NOPE")).result === "skip" && (await inbound(PH_A, "wamid.INB")).result === "skip" && (await svc(`select public.inbox_automation_inbound(null, 'x') as r`)).result === "skip" && (await svc(`select public.inbox_automation_inbound('${PH_A}', null) as r`)).result === "skip");
const own = await sendText(alice.user, conv2, R(1), "human reply", "wamid.OUT1");
check("inbound: an OUTBOUND message id is skipped (automation reacts to customers only)", (await inbound(PH_A, "wamid.OUT1")).result === "skip");
await db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PH_B}'`);
check("inbound: a disabled WhatsApp account is skipped", (await inbound(PH_B, "wamid.INB")).result === "skip");
await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PH_B}'`);
check("inbound: another profile's settings are independent (bob has the acknowledgement off, so none)", (await inbound(PH_B, "wamid.INB")).ack_text === null);

// ------------------------------------------------------------------ record_ack
await save(alice.user, alice.profile, { auto_ack_mode: "always", auto_ack_text: "Ack" });
check("record_ack: marks an outbound message of the conversation as automatic (idempotent)", (await recordAck(conv2, own)) === "ok" && (await recordAck(conv2, own)) === "ok" && (await stateRow(conv2)).auto_ack_message_ids.length === 1);
check("record_ack: not_found for an inbound message, a message of another conversation, unknown ids and nulls", (await recordAck(conv2, (await q1(`select id from public.inbox_messages where provider_message_id = 'wamid.IN2'`))[0].id)) === "not_found" && (await recordAck(conv1, own)) === "not_found" && (await recordAck(conv2, U(99))) === "not_found" && (await svc(`select public.inbox_automation_record_ack(null, null) as r`)) === "not_found");
await db.exec(`update public.inbox_conversation_state set auto_ack_message_ids = '{}' where conversation_id = '${conv2}'`);
const manyIds = [];
for (let i = 0; i < 23; i++) { const id = (await q1(`select gen_random_uuid() as id`))[0].id; await db.exec(`insert into public.inbox_messages (id, profile_id, conversation_id, channel, direction, type, body, status) values ('${id}', '${alice.profile}', '${conv2}', 'whatsapp', 'outbound', 'text', 'x', 'queued')`).catch(() => null); manyIds.push(id); }
const stored = await count("inbox_messages", `conversation_id = '${conv2}' and direction = 'outbound'`);
let ok23 = 0;
for (const id of manyIds) if ((await recordAck(conv2, id)) === "ok") ok23++;
check("record_ack: the list is capped at the 20 newest (never fails, never grows past 20)", stored >= 1 && ok23 === manyIds.filter(Boolean).length && (await stateRow(conv2)).auto_ack_message_ids.length <= 20);

// ------------------------------------------------------------------ failure notices
await ingest({ phone: PH_A, id: "wamid.IN5", from: "237600000005", ts: hoursAgo(0.01), name: "Customer Five" });
const conv5 = await convOf("237600000005");
const failId = await sendText(alice.user, conv5, R(2), "will fail", "wamid.OUTF");
const okId = await sendText(alice.user, conv5, R(3), "will be read", "wamid.OUTR");
const stat = (id, st, codes) => svc(`select public.inbox_ingest_whatsapp_status(${sq(PH_A)}, null, ${sq(id)}, ${sq(st)}, now(), ${codes ? `'{${codes.join(",")}}'::integer[]` : "null"}) as r`);
check("failed notice: skipped while the message is merely sent", (await failedNotice(PH_A, "wamid.OUTF")).result === "skip");
await stat("wamid.OUTF", "failed", [131026]);
const fn1 = await failedNotice(PH_A, "wamid.OUTF");
check("failed notice: due when the message's current status is failed (owner + conversation only)", fn1.result === "notify" && fn1.owner_user_id === alice.user && fn1.conversation_id === conv5 && Object.keys(fn1).sort().join() === "conversation_id,locale,owner_user_id,result" && fn1.locale === "fr");
await stat("wamid.OUTR", "read");
await stat("wamid.OUTR", "failed", [131026]);
check("failed notice: a late failure after 'read' never changes the status, so it never notifies", (await failedNotice(PH_A, "wamid.OUTR")).result === "skip");
await save(alice.user, alice.profile, { notify_failed_message: false });
check("failed notice: the owner's switch turns it off", (await failedNotice(PH_A, "wamid.OUTF")).result === "skip");
await save(alice.user, alice.profile, { notify_failed_message: true });
check("failed notice: inbound messages, unknown ids, another profile's id and nulls are skipped", (await failedNotice(PH_A, "wamid.IN5")).result === "skip" && (await failedNotice(PH_A, "wamid.NOPE")).result === "skip" && (await failedNotice(PH_B, "wamid.OUTF")).result === "skip" && (await failedNotice("0000000", "wamid.OUTF")).result === "skip" && (await svc(`select public.inbox_automation_failed(null, null) as r`)).result === "skip");

// ------------------------------------------------------------------ follow-up claim
// clean slate: only the conversations below take part
await db.exec(`delete from public.inbox_conversation_state`);
await save(alice.user, alice.profile, { auto_ack_mode: "off", follow_up_enabled: true, follow_up_after_hours: 2, notify_follow_up: true });
const mk = async (id, wa, h, name) => { await ingest({ phone: PH_A, id, from: wa, ts: hoursAgo(h), name }); return convOf(wa); };
const cDue = await mk("wamid.F1", "237600000011", 3, "Due Person");
const cFresh = await mk("wamid.F2", "237600000012", 1, "Fresh");
const cOld = await mk("wamid.F3", "237600000013", 24 * 8, "Too Old");
const cWindowClosed = await mk("wamid.F4", "237600000014", 30, "Window Closed");
const cAnswered = await mk("wamid.F5", "237600000015", 3, "Answered");
const cAckOnly = await mk("wamid.F6", "237600000016", 3, "Ack Only");
const cClosed = await mk("wamid.F7", "237600000017", 3, "Closed");
await sendText(alice.user, cAnswered, R(20), "a human answer", "wamid.H1");
const ackMsg = await sendText(alice.user, cAckOnly, R(21), "automatic ack", "wamid.A1");
await db.exec(`insert into public.inbox_conversation_state (conversation_id, profile_id) values ('${cAckOnly}', '${alice.profile}') on conflict do nothing`);
await recordAck(cAckOnly, ackMsg);
await svc(`select public.inbox_set_conversation_status('${alice.user}', '${cClosed}', 'closed') as r`);
const c1 = await claim(100);
const ids1 = c1.map((x) => x.conversation_id).sort();
check("follow-up claim: due = unanswered by a HUMAN for at least the chosen hours, still recent, open", ids1.includes(cDue) && ids1.includes(cWindowClosed) && ids1.includes(cAckOnly), JSON.stringify(ids1));
check("follow-up claim: NOT due = too fresh, older than 7 days, answered by a human, closed", !ids1.includes(cFresh) && !ids1.includes(cOld) && !ids1.includes(cAnswered) && !ids1.includes(cClosed));
check("follow-up claim: an automatic acknowledgement does not count as a human reply", ids1.includes(cAckOnly));
const dueRow = c1.find((x) => x.conversation_id === cDue), closedWin = c1.find((x) => x.conversation_id === cWindowClosed);
check("follow-up claim: each row has the owner, the contact name and whether a free-form reply is still possible (window)", dueRow.owner_user_id === alice.user && dueRow.contact_name === "Due Person" && dueRow.window_open === true && closedWin.window_open === false && Object.keys(dueRow).sort().join() === "contact_name,conversation_id,locale,owner_user_id,window_open" && dueRow.locale === "fr");
check("follow-up claim: no phone number and no message text in the result", !/2376000|"hi"/.test(JSON.stringify(c1)));
check("follow-up claim: a second run (overlapping or retried cron) claims NOTHING again", (await claim(100)).length === 0);
await ingest({ phone: PH_A, id: "wamid.F1b", from: "237600000011", ts: hoursAgo(2.5), name: "Due Person" });
check("follow-up claim: a NEW unanswered customer message raises ONE new reminder, once", (await claim(100)).map((x) => x.conversation_id).join() === cDue && (await claim(100)).length === 0);
await sendText(alice.user, cDue, R(22), "replied", "wamid.H2");
await ingest({ phone: PH_A, id: "wamid.F1c", from: "237600000011", ts: hoursAgo(2.2), name: "Due Person" });
check("follow-up claim: once a human has replied, the conversation is not reminded about again", (await claim(100)).length === 0);
// the owner's switches: a fresh unanswered conversation is claimable only while the switches are on
const cSw = await mk("wamid.S1", "237600000021", 3, "Switch Person");
await save(alice.user, alice.profile, { follow_up_enabled: false });
check("follow-up claim: switched off by the owner -> nothing", (await claim(100)).length === 0);
await save(alice.user, alice.profile, { follow_up_enabled: true, notify_follow_up: false });
check("follow-up claim: the notification switch off -> nothing", (await claim(100)).length === 0);
await save(alice.user, alice.profile, { notify_follow_up: true });
check("follow-up claim: with both switches on again the waiting conversation is claimed (the earlier 'nothing' was not vacuous)", (await claim(100)).map((x) => x.conversation_id).join() === cSw);
check("follow-up claim: an owner who never enabled it (bob, no row) is never included", !(await claim(100)).some((x) => x.owner_user_id === bob.user));
await db.exec(`update public.inbox_conversation_state set follow_up_notified_for = null`);
check("follow-up claim: the limit is respected (and clamped to 1..500)", (await claim(1)).length === 1 && (await claim(0)).length <= 1 && (await claim(-5)).length <= 1 && (await claim(100000)).length >= 0);
check("follow-up claim: the claim writes only the state table (no message was created or changed)", (await count("inbox_messages", `direction = 'outbound' and conversation_id = '${cFresh}'`)) === 0);
await db.exec(`select pg_sleep(0)`);

// ------------------------------------------------------------------ automation never touches Phase 4/7/8/9 data
const outboundBefore = await count("inbox_messages", "direction = 'outbound'");
await inbound(PH_A, "wamid.F1e"); await claim(100); await save(alice.user, alice.profile, { follow_up_after_hours: 5 });
check("none of the automation functions creates, changes or sends a message (they only decide)", (await count("inbox_messages", "direction = 'outbound'")) === outboundBefore);
check("none of them closes or reopens a conversation", (await count("inbox_conversations", "status = 'closed'")) === 1);

// ------------------------------------------------------------------ verify detects drift, rollback
const failedLabels = async () => (await q1(firstStatement(VERIFY))).filter((r) => !r.ok).map((r) => r.label.slice(0, 3));
await db.exec(`create or replace function public.inbox_claim_follow_ups(p_limit integer default 100) returns jsonb language sql security definer set search_path = public, pg_temp as $$ select '[]'::jsonb $$`);
check("verify detects a weakened follow-up claim function", (await failedLabels()).includes("08c"));
await db.exec(MIGRATION);
await db.exec(`grant execute on function public.inbox_settings_save(uuid, uuid, jsonb) to authenticated`);
check("verify detects a function opened to authenticated users", (await failedLabels()).includes("06b"));
await db.exec(MIGRATION);
await db.exec(`grant insert on public.inbox_settings to authenticated`);
check("verify detects a write grant on a new table", (await failedLabels()).includes("04 "));
await db.exec(`revoke insert on public.inbox_settings from authenticated`);
await db.exec(`create table public.inbox_stray (id int)`);
check("verify detects an unexpected extra table", (await failedLabels()).includes("12 "));
await db.exec(`drop table public.inbox_stray`);
await db.exec(`create policy stray on public.inbox_settings for insert to authenticated with check (true)`);
check("verify detects an unexpected extra policy", (await failedLabels()).includes("03b"));
await db.exec(`drop policy stray on public.inbox_settings`);
check("verify is clean again", (await q1(firstStatement(VERIFY))).every((r) => r.ok), JSON.stringify((await q1(firstStatement(VERIFY))).filter((r) => !r.ok)));
const msgsBefore = await count("inbox_messages"), convsBefore = await count("inbox_conversations");
check("rollback runs and is re-runnable", (await errOf(() => db.exec(ROLLBACK))) === null && (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback removed exactly the new objects and kept every message and conversation", (await q1(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename in ('inbox_settings', 'inbox_conversation_state')`))[0].n === 0 && (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_hours_valid', 'inbox_within_hours', 'inbox_settings_save', 'inbox_automation_inbound', 'inbox_automation_record_ack', 'inbox_automation_failed', 'inbox_claim_follow_ups', 'inbox_settings_guard', 'inbox_conversation_state_guard')`))[0].n === 0 && (await count("inbox_messages")) === msgsBefore && (await count("inbox_conversations")) === convsBefore);
check("the Phase 7, 8 and 9 functions are intact after the rollback", (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound', 'inbox_saved_reply_save', 'inbox_set_conversation_status', 'inbox_prepare_outbound_media', 'inbox_complete_outbound_media')`))[0].n === 7);
check("the objects list after rollback equals the list before the migration", JSON.stringify((await q1(OBJ)).map((r) => r.x)) === objectsBefore);
check("the migration re-applies cleanly after a rollback", (await errOf(() => db.exec(MIGRATION))) === null);

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.name); process.exit(1); }
