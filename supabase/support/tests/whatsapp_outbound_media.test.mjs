// Test for supabase/migrations/2026-12-10_whatsapp_outbound_media.sql (Phase 9: the database side of sending media from the Inbox).
//
// Scratch in-memory PostgreSQL (PGlite) only: no Supabase, no network, no credentials, no production ids. Applies the REAL Phase 4, 7 and 8
// migrations, then the REAL Phase 9 migration, preflight, verify and rollback files, and checks additivity (two functions, nothing else),
// ownership, validation, idempotency, the metadata row, status ranking after the send, privileges, verify drift detection and rollback.
//
//   Run:  node supabase/support/tests/whatsapp_outbound_media.test.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");
const MIGS = ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools"].map((m) => read(`supabase/migrations/${m}.sql`));
const MIGRATION = read("supabase/migrations/2026-12-10_whatsapp_outbound_media.sql");
const PREFLIGHT = read("supabase/support/2026-12-10_whatsapp_outbound_media.preflight.sql");
const VERIFY = read("supabase/support/2026-12-10_whatsapp_outbound_media.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-10_whatsapp_outbound_media.rollback.sql");

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
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from ${t.startsWith("pg_") ? "" : "public."}${t} where ${w}`))[0].n);
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const sq = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const svc = async (sql) => (await as("service_role", null, sql)).rows[0]?.r;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', 'hi', ${sq(o.name)}, null, null, null, null, null, null, null)`);
const prep = (actor, conv, req, kind, caption) => svc(`select public.inbox_prepare_outbound_media(${sq(actor)}, ${sq(conv)}, ${sq(req)}, ${sq(kind)}, ${sq(caption)}) as r`);
const complete = (actor, msg, wamid, media, mime, file, sha) => svc(`select public.inbox_complete_outbound_media(${sq(actor)}, ${sq(msg)}, ${sq(wamid)}, ${sq(media)}, ${sq(mime)}, ${sq(file)}, ${sq(sha)}) as r`);
const failMsg = (actor, msg, codes) => svc(`select public.inbox_fail_outbound(${sq(actor)}, ${sq(msg)}, ${codes === null ? "null" : `'{${codes.join(",")}}'::integer[]`}) as r`);
const status = (o) => svc(`select public.inbox_ingest_whatsapp_status(${sq(o.phone ?? PH_A)}, null, ${sq(o.id)}, ${sq(o.status)}, now(), ${o.codes ? `'{${o.codes.join(",")}}'::integer[]` : "null"}) as r`);
const msgRow = async (id) => (await q1(`select * from public.inbox_messages where id = ${sq(id)}`))[0];
const mediaRow = async (id) => (await q1(`select * from public.inbox_message_media where message_id = ${sq(id)}`))[0];

await ingest({ phone: PH_A, id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), name: "Customer One" });
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(30), name: "Customer Two" });
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer" });
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), convB = await convOf("237611111111");

// ------------------------------------------------------------------ script hygiene + apply + verify + additivity
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const firstStatement = (sql) => strip(sql).split(/;[ \t]*\n/)[0];
const semicolonsInsideQuotes = (sql) => { const hits = []; let inQuote = false; let line = 1; for (let i = 0; i < sql.length; i++) { const ch = sql[i]; if (ch === "\n") line++; if (!inQuote && ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; line++; continue; } if (ch === "'") { if (inQuote && sql[i + 1] === "'") { i++; continue; } inQuote = !inQuote; continue; } if (ch === ";" && inQuote) hits.push(line); } return hits; };
for (const [n, s] of [["preflight", PREFLIGHT], ["verify", VERIFY], ["rollback", ROLLBACK]]) {
  check(`hygiene: no ';' inside a string literal in the ${n} script (the Supabase editor can split on semicolons)`, semicolonsInsideQuotes(s).length === 0, semicolonsInsideQuotes(s).join());
  check(`hygiene: quotes are balanced in the ${n} script`, ((strip(s).match(/'/g) || []).length % 2) === 0);
}
check("hygiene: a naive split on ';' of the verify and preflight scripts yields exactly ONE statement each", strip(VERIFY).split(";").filter((p) => p.trim()).length === 1 && strip(PREFLIGHT).split(";").filter((p) => p.trim()).length === 1);
const OBJ = `select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal union all select 'pol:' || policyname from pg_policies order by 1`;
const objectsBefore = JSON.stringify((await q1(OBJ)).map((r) => r.x));
const pre = await q1(firstStatement(PREFLIGHT));
check("preflight: every row ok before the migration", pre.length >= 10 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
const bare = strip(MIGRATION);
check("migration: functions only (no table, column, index, trigger, policy, alter or drop)", !/\b(create\s+table|alter\s+table|drop\s+|create\s+(unique\s+)?index|create\s+trigger|create\s+policy|grant\s+select)/i.test(bare.replace(/revoke all on function/gi, "")));
check("migration: no hard-coded ids, tokens or phone numbers", !/[0-9]{12,}|EAA[A-Za-z0-9]{10,}|Bearer/.test(bare));
await db.exec(MIGRATION);
check("migration applies and is idempotent", (await errOf(() => db.exec(MIGRATION))) === null);
const added = (await q1(OBJ)).map((r) => r.x).filter((x) => !JSON.parse(objectsBefore).includes(x));
check("exactly two new objects, both functions", added.length === 2 && added.every((x) => /^fn:inbox_(prepare_outbound_media|complete_outbound_media)$/.test(x)), added.join());
const ver = await q1(firstStatement(VERIFY));
check("verify: every row ok", ver.length >= 14 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));

// ------------------------------------------------------------------ prepare
const r1 = await prep(alice.user, conv1, R(1), "image", "  Our price list  ");
check("prepare image: created, with the recipient and business number READ FROM THE DATABASE", r1.result === "created" && r1.to === "237600000001" && r1.phone_number_id === PH_A && typeof r1.message_id === "string", JSON.stringify(r1));
const m1 = await msgRow(r1.message_id);
check("prepare: ONE queued outbound row, type = kind, caption in body (trimmed), request id, sender, no wamid", m1.direction === "outbound" && m1.status === "queued" && m1.type === "image" && m1.body === "Our price list" && m1.client_request_id === R(1) && m1.sent_by_user_id === alice.user && m1.provider_message_id === null && m1.profile_id === alice.profile && m1.conversation_id === conv1);
check("prepare: no media row yet and the conversation counters are untouched", (await mediaRow(r1.message_id)) === undefined && (await q1(`select last_outbound_at from public.inbox_conversations where id = '${conv1}'`))[0].last_outbound_at === null);
check("every media kind can be prepared; audio only WITHOUT a caption", (await prep(alice.user, conv1, R(2), "video", "clip")).result === "created" && (await prep(alice.user, conv1, R(3), "document", "invoice")).result === "created" && (await prep(alice.user, conv1, R(4), "audio", null)).result === "created" && (await prep(alice.user, conv1, R(5), "image", null)).result === "created");
check("audio with a caption -> invalid", (await prep(alice.user, conv1, R(6), "audio", "caption")).result === "invalid" && (await count("inbox_messages", `client_request_id = ${sq(R(6))}`)) === 0);
check("unsupported or malformed kinds -> invalid (sticker, text, empty, null, injection)", ["sticker", "text", "", "IMAGE", "image'; drop table x;--"].every(async () => true) && (await prep(alice.user, conv1, R(7), "sticker", null)).result === "invalid" && (await prep(alice.user, conv1, R(7), "text", null)).result === "invalid" && (await prep(alice.user, conv1, R(7), "", null)).result === "invalid" && (await prep(alice.user, conv1, R(7), null, null)).result === "invalid" && (await prep(alice.user, conv1, R(7), "image'; drop table x;--", null)).result === "invalid" && (await count("inbox_messages", `client_request_id = ${sq(R(7))}`)) === 0);
check("caption 1025 characters -> invalid, exactly 1024 accepted; whitespace-only caption is treated as none", (await prep(alice.user, conv1, R(8), "image", "c".repeat(1025))).result === "invalid" && (await prep(alice.user, conv1, R(9), "image", "c".repeat(1024))).result === "created" && (await msgRow((await prep(alice.user, conv1, R(10), "document", "   ")).message_id)).body === null);
check("null ids -> invalid", (await svc(`select public.inbox_prepare_outbound_media(null, ${sq(conv1)}, ${sq(R(11))}, 'image', null) as r`)).result === "invalid" && (await svc(`select public.inbox_prepare_outbound_media(${sq(alice.user)}, ${sq(conv1)}, null, 'image', null) as r`)).result === "invalid");

// idempotency
const rep1 = await prep(alice.user, conv1, R(1), "image", "Our price list");
check("replay with the same request id returns the ORIGINAL row (existing), never a second message", rep1.result === "existing" && rep1.message_id === r1.message_id && rep1.status === "queued" && (await count("inbox_messages", `client_request_id = ${sq(R(1))}`)) === 1, JSON.stringify(rep1));
check("a replay never exposes a recipient or phone number id", rep1.to === undefined && rep1.phone_number_id === undefined);
check("the same request id with another kind, caption or conversation is a conflict", (await prep(alice.user, conv1, R(1), "document", "Our price list")).result === "conflict" && (await prep(alice.user, conv1, R(1), "image", "Other")).result === "conflict" && (await prep(alice.user, conv2, R(1), "image", "Our price list")).result === "conflict");
check("a request id already used by a TEXT message is a conflict for media", await (async () => { await svc(`select public.inbox_prepare_outbound_text(${sq(alice.user)}, ${sq(conv1)}, ${sq(R(12))}, 'plain text') as r`); return (await prep(alice.user, conv1, R(12), "image", null)).result === "conflict"; })());
const burst = await Promise.all(Array.from({ length: 15 }, () => prep(alice.user, conv1, R(20), "image", "burst")));
check("15 simultaneous identical requests -> exactly one created, the rest existing, ONE row", burst.filter((r) => r.result === "created").length === 1 && burst.filter((r) => r.result === "existing").length === 14 && (await count("inbox_messages", `client_request_id = ${sq(R(20))}`)) === 1);
await db.exec(`
  create function pg_temp.plant() returns trigger language plpgsql as $$ begin
    if pg_trigger_depth() = 1 and new.client_request_id = '${R(21)}' then
      insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id)
      values (new.profile_id, new.conversation_id, new.channel, 'outbound', new.type, new.body, 'queued', new.sent_by_user_id, new.client_request_id);
    end if; return new; end $$;
  create trigger zz_plant before insert on public.inbox_messages for each row execute function pg_temp.plant();`);
check("lost race (an identical request committed first) -> existing, still ONE row", (await prep(alice.user, conv1, R(21), "video", "race")).result === "existing" && (await count("inbox_messages", `client_request_id = ${sq(R(21))}`)) === 1);
await db.exec(`drop trigger zz_plant on public.inbox_messages`);

// ownership / window / account
const before = await count("inbox_messages");
check("another profile's owner cannot prepare on a guessed conversation id -> not_found, nothing created", (await prep(bob.user, conv1, R(30), "image", null)).result === "not_found" && (await count("inbox_messages")) === before);
check("a user who owns no profile, and a missing conversation -> not_found", (await prep(carol.user, conv1, R(31), "image", null)).result === "not_found" && (await prep(alice.user, "f0000000-0000-4000-8000-0000000000aa", R(32), "image", null)).result === "not_found");
check("bob can send in his own conversation (control)", (await prep(bob.user, convB, R(33), "image", null)).result === "created");
check("24-hour window closed -> window_closed, nothing created", (await prep(alice.user, conv2, R(34), "image", null)).result === "window_closed" && (await count("inbox_messages", `client_request_id = ${sq(R(34))}`)) === 0);
await db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PH_A}'`);
check("disabled account -> account_disabled, nothing created; a replay still returns its original row", (await prep(alice.user, conv1, R(35), "image", null)).result === "account_disabled" && (await prep(alice.user, conv1, R(1), "image", "Our price list")).result === "existing");
await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PH_A}'`);

// ------------------------------------------------------------------ complete
const WAM = "wamid.OUTMEDIA.A";
check("complete by a non-owner -> not_found; unknown message -> not_found; a TEXT message -> not_found", (await complete(bob.user, r1.message_id, WAM, "MEDIA1", "image/jpeg", "a.jpg", "sha")) === "not_found" && (await complete(alice.user, "f0000000-0000-4000-8000-0000000000bb", WAM, "MEDIA1", "image/jpeg", "a.jpg", "sha")) === "not_found" && await (async () => { const t = await svc(`select public.inbox_prepare_outbound_text(${sq(alice.user)}, ${sq(conv1)}, ${sq(R(40))}, 'text msg') as r`); return (await complete(alice.user, t.message_id, "wamid.T1", "MEDIA1", "image/jpeg", "a.jpg", "sha")) === "not_found"; })());
check("complete with a blank / oversize media id or null ids -> invalid, nothing changed", (await complete(alice.user, r1.message_id, WAM, "  ", "image/jpeg", "a.jpg", "sha")) === "invalid" && (await complete(alice.user, r1.message_id, WAM, "m".repeat(257), "image/jpeg", "a.jpg", "sha")) === "invalid" && (await mediaRow(r1.message_id)) === undefined && (await msgRow(r1.message_id)).provider_message_id === null);
check("complete -> ok", (await complete(alice.user, r1.message_id, WAM, "META_MEDIA_ID_1", "image/jpeg", "price-list.jpg", "abc123")) === "ok");
const m1b = await msgRow(r1.message_id);
check("complete: wamid stored, status 'sent' (Phase 7 logic), request id kept", m1b.provider_message_id === WAM && m1b.status === "sent" && m1b.client_request_id === R(1) && m1b.type === "image");
const media1 = await mediaRow(r1.message_id);
check("complete: ONE metadata row (kind, Meta media id, mime, filename, sha256, caption from the message) and no stored copy", media1 && media1.kind === "image" && media1.media_id === "META_MEDIA_ID_1" && media1.mime_type === "image/jpeg" && media1.filename === "price-list.jpg" && media1.sha256 === "abc123" && media1.caption === "Our price list" && media1.storage_status === "not_downloaded" && media1.storage_ref === null && media1.profile_id === alice.profile);
const cv = (await q1(`select * from public.inbox_conversations where id = '${conv1}'`))[0];
check("complete: last_outbound_at / last_message_at updated, unread untouched (Phase 7 logic)", cv.last_outbound_at !== null && cv.unread_count === 1 && cv.status === "open");
check("complete again (same wamid) -> duplicate and still exactly one media row; a different wamid -> conflict", (await complete(alice.user, r1.message_id, WAM, "META_MEDIA_ID_1", "image/jpeg", "price-list.jpg", "abc123")) === "duplicate" && (await complete(alice.user, r1.message_id, "wamid.OTHER", "META_MEDIA_ID_9", "image/jpeg", "x.jpg", "x")) === "conflict" && (await count("inbox_message_media", `message_id = ${sq(r1.message_id)}`)) === 1 && (await mediaRow(r1.message_id)).media_id === "META_MEDIA_ID_1");
const rB = await prep(alice.user, conv1, R(41), "document", "doc");
check("a wamid already used by another message -> conflict, no media row, message stays queued", (await complete(alice.user, rB.message_id, WAM, "M2", "application/pdf", "d.pdf", "s")) === "conflict" && (await mediaRow(rB.message_id)) === undefined && (await msgRow(rB.message_id)).status === "queued");
check("a document keeps its filename; an audio message has no caption and no filename", await (async () => { const d = await prep(alice.user, conv1, R(42), "document", null); await complete(alice.user, d.message_id, "wamid.DOC1", "MD", "application/pdf", "report.pdf", "s1"); const a = await prep(alice.user, conv1, R(43), "audio", null); await complete(alice.user, a.message_id, "wamid.AUD1", "MA", "audio/ogg", null, "s2"); const md = await mediaRow(d.message_id), ma = await mediaRow(a.message_id); return md.filename === "report.pdf" && md.caption === null && ma.filename === null && ma.caption === null && ma.kind === "audio"; })());
check("replay after completion returns the original row with its wamid and status", await (async () => { const r = await prep(alice.user, conv1, R(1), "image", "Our price list"); return r.result === "existing" && r.status === "sent" && r.provider_message_id === WAM; })());

// early status events then complete
const rE = await prep(alice.user, conv1, R(50), "video", "early");
await status({ id: "wamid.EARLY.V", status: "delivered" }); await status({ id: "wamid.EARLY.V", status: "read" });
check("early events are attached by complete, the highest rank wins ('read'), and the media row is stored", (await complete(alice.user, rE.message_id, "wamid.EARLY.V", "MV", "video/mp4", "c.mp4", "s")) === "ok" && (await msgRow(rE.message_id)).status === "read" && (await count("inbox_status_events", `message_id = ${sq(rE.message_id)}`)) === 2 && (await mediaRow(rE.message_id)).kind === "video");
// status ranking after the send (the Phase 4 webhook path, unchanged)
check("webhook statuses after the send: delivered then read advance; a late sent or failed never downgrades; duplicates change nothing", (await status({ id: WAM, status: "delivered" })) === "created" && (await status({ id: WAM, status: "read" })) === "created" && (await status({ id: WAM, status: "sent" })) === "created" && (await status({ id: WAM, status: "failed", codes: [131026] })) === "created" && (await status({ id: WAM, status: "read" })) === "duplicate" && (await msgRow(r1.message_id)).status === "read");

// failure path: nothing is left 'sent'
const rF = await prep(alice.user, conv1, R(60), "image", "will fail");
check("a rejected upload or send is recorded with the existing fail function: status failed, codes kept, NO media row, never 'sent'", (await failMsg(alice.user, rF.message_id, [131053])) === "ok" && (await msgRow(rF.message_id)).status === "failed" && JSON.stringify((await msgRow(rF.message_id)).error_codes) === "[131053]" && (await mediaRow(rF.message_id)) === undefined && (await msgRow(rF.message_id)).provider_message_id === null);
check("a failed media request replays as 'existing' with status failed (the caller must not upload again)", (await prep(alice.user, conv1, R(60), "image", "will fail")).status === "failed");
check("fail by a non-owner -> not_found", (await failMsg(bob.user, rF.message_id, [1])) === "not_found");

// privileges
const denied = async (role, sub, sql) => /permission denied/i.test((await errOf(() => as(role, sub, sql))) || "");
check("anon and authenticated cannot execute either function", await denied("anon", null, `select public.inbox_prepare_outbound_media('${alice.user}', '${conv1}', '${R(70)}', 'image', null)`) && await denied("authenticated", alice.user, `select public.inbox_prepare_outbound_media('${alice.user}', '${conv1}', '${R(70)}', 'image', null)`)
  && await denied("authenticated", alice.user, `select public.inbox_complete_outbound_media('${alice.user}', '${r1.message_id}', 'w', 'm', 'image/jpeg', 'a', 's')`) && await denied("anon", null, `select public.inbox_complete_outbound_media('${alice.user}', '${r1.message_id}', 'w', 'm', 'image/jpeg', 'a', 's')`));
check("nobody can write the media table directly (service_role, authenticated, anon)", await denied("service_role", null, `insert into public.inbox_message_media (message_id, profile_id, kind, media_id) values ('${r1.message_id}', '${alice.profile}', 'image', 'x')`) && await denied("authenticated", alice.user, `insert into public.inbox_message_media (message_id, profile_id, kind, media_id) values ('${r1.message_id}', '${alice.profile}', 'image', 'x')`) && await denied("anon", null, `delete from public.inbox_message_media`));
check("the owner reads her outbound media metadata through RLS, bob cannot (Phase 6 reads unchanged)", Number((await as("authenticated", alice.user, `select count(*)::int n from public.inbox_message_media where message_id = '${r1.message_id}'`)).rows[0].n) === 1 && Number((await as("authenticated", bob.user, `select count(*)::int n from public.inbox_message_media where message_id = '${r1.message_id}'`)).rows[0].n) === 0);

// verify detects drift, rollback
const failedLabels = async () => (await q1(firstStatement(VERIFY))).filter((r) => !r.ok).map((r) => r.label.slice(0, 3));
await db.exec(`create or replace function public.inbox_complete_outbound_media(p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text, p_media_id text, p_mime_type text, p_filename text, p_sha256 text) returns text language sql security definer set search_path = public, pg_temp as $$ select 'ok'::text $$`);
check("verify detects a weakened complete function", (await failedLabels()).includes("08b"));
await db.exec(MIGRATION);
await db.exec(`create table public.inbox_stray (id int)`);
check("verify detects an unexpected extra table", (await failedLabels()).includes("07 "));
await db.exec(`drop table public.inbox_stray`);
await db.exec(`create function public.inbox_stray_fn() returns int language sql as $$ select 1 $$`);
check("verify detects an unexpected extra function", (await failedLabels()).includes("10 "));
await db.exec(`drop function public.inbox_stray_fn()`);
check("verify is clean again", (await q1(firstStatement(VERIFY))).every((r) => r.ok));
const mediaRowsBefore = await count("inbox_message_media"), msgsBefore = await count("inbox_messages");
check("rollback runs and is re-runnable", (await errOf(() => db.exec(ROLLBACK))) === null && (await errOf(() => db.exec(ROLLBACK))) === null);
check("rollback removed exactly the two functions and kept every message and media row", (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_media', 'inbox_complete_outbound_media')`))[0].n === 0 && (await count("inbox_message_media")) === mediaRowsBefore && (await count("inbox_messages")) === msgsBefore);
check("the Phase 7 functions are intact after the rollback", (await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound')`))[0].n === 3);
check("the objects list after rollback equals the list before the migration", JSON.stringify((await q1(OBJ)).map((r) => r.x)) === objectsBefore);
check("the migration re-applies cleanly after a rollback", (await errOf(() => db.exec(MIGRATION))) === null);

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.name); process.exit(1); }
