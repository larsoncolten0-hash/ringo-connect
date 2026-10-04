// WhatsApp webhook -> Phase 4 persistence, end to end: the REAL route handler (signature check, parse, account allowlist) calling the REAL
// ingestion functions from supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql on a scratch in-memory PostgreSQL (PGlite).
// No Supabase, no network, no credentials, no production identifiers (every id below is synthetic).
//   Run:  node scripts/tests/whatsappIngest.test.mjs
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };

// ---- scratch database with the real migration applied ------------------------------------------------------------------------------
const MIGRATION = fs.readFileSync(path.join(REPO, "supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql"), "utf8").replace(/\r\n/g, "\n");
const db = new PGlite();
const OWNER = "a0000000-0000-4000-8000-000000000001", OTHER = "a0000000-0000-4000-8000-000000000002";
const PHONE = "1110000000001", WABA = "1110000000002", PHONE2 = "9990000000001", WABA2 = "9990000000002";
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
  insert into public.users values ('c0000000-0000-4000-8000-000000000001', 'o@x.test'), ('c0000000-0000-4000-8000-000000000002', 'p@x.test');
  insert into public.profiles values ('${OWNER}', 'c0000000-0000-4000-8000-000000000001', 'owner'), ('${OTHER}', 'c0000000-0000-4000-8000-000000000002', 'other');
`);
await db.exec(MIGRATION);
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const lit = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : `'${String(v).replace(/'/g, "''")}'`);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };

// ---- admin-client stand-in: the route's createAdminClient() resolves to this ---------------------------------------------------------
let mode = "ok";
let calls = [];
globalThis.__admin = () => {
  if (mode === "no_client") throw new Error("supabaseUrl is required");
  return {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (mode === "throw") throw new Error("network down SECRET BODY TEXT");
      if (mode === "rpc_error" || (mode === "fail_status" && fn.includes("status"))) return { data: null, error: { code: "XX000", message: "row contains SECRET BODY TEXT 237600000001" } };
      if (mode === "weird") return { data: "bogus", error: null };
      const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; }
      catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
    },
  };
};
const serverStub = path.join(os.tmpdir(), `wa_ingest_server_${process.pid}.cjs`);
fs.writeFileSync(serverStub, "module.exports = { createAdminClient: () => globalThis.__admin() };");
process.on("exit", () => { try { fs.unlinkSync(serverStub); } catch {} });
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false, requireCache: false });
const route = jiti(path.join(SRC, "app/api/integrations/whatsapp/webhook/route.ts"));
const { ingestEvent, messageRpcArgs, statusRpcArgs, IngestFailure } = jiti(path.join(SRC, "lib/whatsapp/ingest.ts"));
const { parseWhatsAppWebhook } = jiti(path.join(SRC, "lib/whatsapp/parseWebhook.ts"));

// ---- request helpers -----------------------------------------------------------------------------------------------------------------
const SECRET = "test-app-secret";
const sign = (b, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(b).digest("hex");
const env = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
env("WHATSAPP_APP_SECRET", SECRET); env("META_APP_SECRET", undefined); env("WHATSAPP_PHONE_NUMBER_ID", PHONE); env("WHATSAPP_WABA_ID", WABA);
const payload = (value, { phone = PHONE, waba = WABA } = {}) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: waba, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone }, ...value } }] }] });
const text = (id = "wamid.IN1", body = "SECRET BODY TEXT", extra = {}) => ({ contacts: [{ profile: { name: "Test Customer" }, wa_id: "237600000001" }], messages: [{ from: "237600000001", id, timestamp: "1700000000", type: "text", text: { body }, ...extra }] });
const status = (id, st, errors) => ({ statuses: [{ id, status: st, timestamp: "1700000100", recipient_id: "237600000001", errors }] });
const logs = []; const errs = []; const everyLog = [];   // everyLog is never cleared: the hygiene check at the end covers the whole run
const origInfo = console.info, origErr = console.error;
console.info = (...a) => { logs.push(a.join(" ")); everyLog.push(a.join(" ")); }; console.error = (...a) => { errs.push(a.join(" ")); everyLog.push(a.join(" ")); };
const post = (raw, headers = { "x-hub-signature-256": sign(raw) }) => route.POST(new Request("http://localhost/api/integrations/whatsapp/webhook", { method: "POST", body: raw, headers }));
const reset = () => { calls = []; logs.length = 0; errs.length = 0; mode = "ok"; };
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${OWNER}', '${PHONE}', '${WABA}')`);

try {
  // ---- successful inbound text ----
  reset();
  let r = await post(payload(text()));
  check("inbound text -> 200", r.status === 200 && (await r.json()).received === true);
  const m = (await q1(`select m.profile_id, m.body, m.type, m.direction, m.status, m.provider_message_id, c.external_id, c.display_name, cv.unread_count from public.inbox_messages m join public.inbox_conversations cv on cv.id = m.conversation_id join public.inbox_contacts c on c.id = cv.contact_id`))[0];
  check("stored under the profile the DATABASE derived from phone_number_id", m && m.profile_id === OWNER, JSON.stringify(m));
  check("text, type, direction, wamid, contact and unread persisted", m.body === "SECRET BODY TEXT" && m.type === "text" && m.direction === "inbound" && m.status === "received" && m.provider_message_id === "wamid.IN1" && m.external_id === "237600000001" && m.display_name === "Test Customer" && m.unread_count === 1);
  check("exactly one RPC call, to the message function", calls.length === 1 && calls[0].fn === "inbox_ingest_whatsapp_message");
  const keys = Object.keys(calls[0].args).sort();
  check("RPC args are exactly the 15 normalized fields: no profile_id, no raw payload", keys.length === 15 && keys.every((k) => k.startsWith("p_")) && !keys.some((k) => /profile|owner|user|payload|raw/i.test(k)), keys.join());
  check("no argument carries the raw webhook body", !JSON.stringify(calls[0].args).includes("messaging_product"));

  // ---- duplicate delivery ----
  reset();
  r = await post(payload(text()));
  check("duplicate inbound delivery -> 200", r.status === 200);
  check("duplicate: still one message/contact/conversation, unread still 1", (await count("inbox_messages")) === 1 && (await count("inbox_contacts")) === 1 && (await count("inbox_conversations")) === 1 && (await q1(`select unread_count n from public.inbox_conversations`))[0].n === 1);
  check("duplicate is logged as an acknowledged outcome", logs.some((l) => l.includes('"ingest":"duplicate"')));

  // ---- second message, media, reply context, unsupported ----
  reset();
  r = await post(payload({ contacts: [], messages: [{ from: "237600000001", id: "wamid.IMG1", timestamp: "1700000200", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", sha256: "abc", caption: "a caption" }, context: { id: "wamid.IN1" } }] }));
  const md = (await q1(`select md.kind, md.media_id, md.mime_type, md.sha256, md.caption, md.storage_status, md.storage_ref, m.type, m.body, m.reply_to_provider_message_id from public.inbox_message_media md join public.inbox_messages m on m.id = md.message_id`))[0];
  check("media message persisted as metadata only (not downloaded, no storage ref), reply context kept",
    r.status === 200 && md && md.kind === "image" && md.media_id === "MEDIA1" && md.mime_type === "image/jpeg" && md.sha256 === "abc" && md.caption === "a caption" && md.storage_status === "not_downloaded" && md.storage_ref === null && md.type === "image" && md.body === null && md.reply_to_provider_message_id === "wamid.IN1", JSON.stringify(md));
  check("second message from the same contact reuses the conversation (unread 2)", (await count("inbox_conversations")) === 1 && (await q1(`select unread_count n from public.inbox_conversations`))[0].n === 2);
  reset();
  r = await post(payload({ contacts: [], messages: [{ from: "237600000001", id: "wamid.WEIRD", timestamp: "1700000300", type: "brand_new_type" }] }));
  check("unsupported message type -> 200 and stored as 'unsupported' with no body", r.status === 200 && (await q1(`select type, body from public.inbox_messages where provider_message_id = 'wamid.WEIRD'`))[0].type === "unsupported");

  // ---- unknown / disabled / mismatched account (database side) ----
  reset();
  env("WHATSAPP_PHONE_NUMBER_ID", PHONE2); env("WHATSAPP_WABA_ID", WABA2);
  const before = await count("inbox_messages");
  r = await post(payload(text("wamid.UNK"), { phone: PHONE2, waba: WABA2 }));
  check("trusted by env but not in wa_accounts -> 200 (acknowledged), nothing written", r.status === 200 && (await count("inbox_messages")) === before && logs.some((l) => l.includes('"ingest":"unknown_account"')));
  await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id, status) values ('${OTHER}', '${PHONE2}', '${WABA2}', 'disabled')`);
  reset();
  r = await post(payload(text("wamid.DIS"), { phone: PHONE2, waba: WABA2 }));
  check("disabled account -> 200 (acknowledged), nothing written", r.status === 200 && (await count("inbox_messages")) === before && logs.some((l) => l.includes('"ingest":"account_disabled"')));
  await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PHONE2}'`);
  env("WHATSAPP_WABA_ID", undefined);   // env checks the phone only, so a different WABA reaches the database check
  reset();
  r = await post(payload(text("wamid.WB"), { phone: PHONE2, waba: "5550000000009" }));
  check("waba that does not belong to the account -> 200 (acknowledged), nothing written", r.status === 200 && (await count("inbox_messages")) === before && logs.some((l) => l.includes('"ingest":"waba_mismatch"')));
  reset();
  r = await post(payload(text("wamid.OK2"), { phone: PHONE2, waba: WABA2 }));
  check("an active second account stores under ITS profile (tenant isolation)", r.status === 200 && (await q1(`select profile_id from public.inbox_messages where provider_message_id = 'wamid.OK2'`))[0].profile_id === OTHER);
  env("WHATSAPP_PHONE_NUMBER_ID", PHONE); env("WHATSAPP_WABA_ID", WABA);

  // ---- wrong phone_number_id (env allowlist) / invalid signature: no database work at all ----
  reset();
  r = await post(payload(text("wamid.FOREIGN"), { phone: "7770000000000" }));
  check("wrong phone_number_id -> 200, ignored, no RPC, nothing stored", r.status === 200 && calls.length === 0 && (await count("inbox_messages", "provider_message_id = 'wamid.FOREIGN'")) === 0 && logs.some((l) => l.includes("ignored_foreign_account")));
  reset();
  const good = payload(text("wamid.SIG"));
  r = await post(good, { "x-hub-signature-256": sign(good, "wrong") });
  check("invalid signature -> 401, no client created, no RPC, nothing stored", r.status === 401 && calls.length === 0 && (await count("inbox_messages", "provider_message_id = 'wamid.SIG'")) === 0);
  r = await post(good, {});
  check("missing signature -> 401, no RPC", r.status === 401 && calls.length === 0);
  const badJson = "not json{";
  r = await post(badJson, { "x-hub-signature-256": sign(badJson, "wrong") });
  check("bad signature is rejected BEFORE parsing (401, not the malformed-json 200)", r.status === 401 && calls.length === 0);
  env("WHATSAPP_APP_SECRET", undefined);
  r = await post(good, { "x-hub-signature-256": sign(good, "") });
  check("app secret not configured -> 503, no RPC", r.status === 503 && calls.length === 0);
  env("WHATSAPP_APP_SECRET", SECRET);

  // ---- malformed / unsupported structure ----
  reset();
  r = await post(badJson, { "x-hub-signature-256": sign(badJson) });
  check("signed malformed JSON -> 200, no RPC", r.status === 200 && calls.length === 0);
  const odd = JSON.stringify({ object: "whatsapp_business_account", entry: [null, { id: "1", changes: [{ field: "account_update", value: {} }] }] });
  r = await post(odd, { "x-hub-signature-256": sign(odd) });
  check("signed unsupported structure -> 200, no RPC", r.status === 200 && calls.length === 0);
  r = await post(payload({ messages: [{ type: "text" }, "junk"] }));
  check("message without id/from -> skipped by the parser: 200, no RPC", r.status === 200 && calls.length === 0);

  // ---- failures -> 5xx, retry is safe ----
  for (const [m, label] of [["rpc_error", "RPC returns an error"], ["throw", "RPC call throws"], ["no_client", "admin client cannot be created"], ["weird", "RPC answers something outside the contract"]]) {
    reset(); mode = m;
    const body = payload(text(`wamid.F_${m}`));
    r = await post(body);
    check(`${label} -> 500 (never a false 200)`, r.status === 500 && (await r.json()).error === "ingest_failed");
    check(`${label}: nothing stored; failure logged with a code only`, (await count("inbox_messages", `provider_message_id = 'wamid.F_${m}'`)) === 0 && errs.length === 1 && /ingest_failed/.test(errs[0]));
    mode = "ok"; calls = [];
    r = await post(body);
    check(`${label}: Meta's retry succeeds and stores exactly one row`, r.status === 200 && (await count("inbox_messages", `provider_message_id = 'wamid.F_${m}'`)) === 1);
  }
  reset();
  r = await post(payload({ ...text("wamid.RETRY_A"), ...status("wamid.RETRY_O", "sent") }));
  check("sanity: message + status in one delivery -> 200", r.status === 200 && calls.length === 2);
  reset(); mode = "fail_status";
  const both = payload({ ...text("wamid.PART"), ...status("wamid.PART_O", "delivered") });
  r = await post(both);
  check("partial failure: every event is still attempted (message stored), delivery answers 500", r.status === 500 && calls.length === 2 && (await count("inbox_messages", "provider_message_id = 'wamid.PART'")) === 1);
  mode = "ok";
  r = await post(both);
  check("redelivery after partial failure: message is a duplicate, status now stored, answer 200", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.PART'")) === 1 && (await count("inbox_status_events", "provider_message_id = 'wamid.PART_O'")) === 1);

  // ---- status events ----
  reset();
  const convId = (await q1(`select id from public.inbox_conversations where profile_id = '${OWNER}'`))[0].id;
  await db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, type, body, status) values ('${OWNER}', '${convId}', 'whatsapp', 'outbound', 'wamid.OUT1', 'text', 'hi', 'queued')`);   // stands in for the future outbound sender
  r = await post(payload(status("wamid.OUT1", "delivered")));
  check("status ingestion -> 200, message current status 'delivered'", r.status === 200 && calls[0].fn === "inbox_ingest_whatsapp_status" && (await q1(`select status from public.inbox_messages where provider_message_id = 'wamid.OUT1'`))[0].status === "delivered");
  r = await post(payload(status("wamid.OUT1", "delivered")));
  check("duplicate status -> 200, still one history row", r.status === 200 && (await count("inbox_status_events", "provider_message_id = 'wamid.OUT1' and status = 'delivered'")) === 1);
  r = await post(payload(status("wamid.OUT1", "sent")));
  check("late 'sent' after 'delivered' -> 200, current stays 'delivered', history keeps both", r.status === 200 && (await q1(`select status from public.inbox_messages where provider_message_id = 'wamid.OUT1'`))[0].status === "delivered" && (await count("inbox_status_events", "provider_message_id = 'wamid.OUT1'")) === 2);
  r = await post(payload(status("wamid.OUT1", "failed", [{ code: 131047 }])));
  check("'failed' after 'delivered' does not overwrite it (event recorded)", r.status === 200 && (await q1(`select status from public.inbox_messages where provider_message_id = 'wamid.OUT1'`))[0].status === "delivered" && (await count("inbox_status_events", "provider_message_id = 'wamid.OUT1' and status = 'failed'")) === 1);
  r = await post(payload(status("wamid.OUT1", "read")));
  check("'read' advances the current status", r.status === 200 && (await q1(`select status from public.inbox_messages where provider_message_id = 'wamid.OUT1'`))[0].status === "read");
  r = await post(payload(status("wamid.NOT_YET", "delivered", undefined)));
  check("status BEFORE its message -> 200, stored unattached (message_id null), no message invented", r.status === 200 && (await q1(`select message_id from public.inbox_status_events where provider_message_id = 'wamid.NOT_YET'`))[0].message_id === null && (await count("inbox_messages", "provider_message_id = 'wamid.NOT_YET'")) === 0);
  check("status RPC args: the 6 normalized fields only (no recipient number)", (() => { const a = statusRpcArgs(parseWhatsAppWebhook(JSON.parse(payload(status("w", "read")))).events[0]); return Object.keys(a).sort().join() === "p_error_codes,p_message_id,p_phone_number_id,p_status,p_timestamp,p_waba_id" && !JSON.stringify(a).includes("237600000001"); })());

  // ---- Phase 3 behaviour is intact: GET handshake ----
  env("WHATSAPP_VERIFY_TOKEN", "verify-me");
  const g = await route.GET(new Request("http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"));
  check("GET handshake still echoes the challenge", g.status === 200 && (await g.text()) === "42");
  env("WHATSAPP_VERIFY_TOKEN", undefined);
} finally { console.info = origInfo; console.error = origErr; }

// ---- logging hygiene across everything above (info + error logs) ----
const allLogs = everyLog.join("\n");
check("log capture covered the whole run (info + error lines present)", everyLog.length > 40 && everyLog.some((l) => l.includes("ingest_failed")) && everyLog.some((l) => l.includes('"ingest":"created"')), String(everyLog.length));
check("logs never contain bodies, customer numbers, names, secrets or database error text", !/SECRET BODY TEXT|237600000001|Test Customer|test-app-secret|verify-me|row contains|network down/.test(allLogs), allLogs.slice(0, 300));

// ---- unit: ingest module ----
{
  const ev = parseWhatsAppWebhook(JSON.parse(payload(text()))).events[0];
  const a = messageRpcArgs(ev);
  check("unit: message args mapped 1:1 from the normalized event", a.p_message_id === "wamid.IN1" && a.p_from === "237600000001" && a.p_type === "text" && a.p_text === "SECRET BODY TEXT" && a.p_contact_name === "Test Customer" && a.p_media_id === null && a.p_phone_number_id === PHONE && a.p_waba_id === WABA);
  const fake = (res) => ({ rpc: async () => res });
  check("unit: every documented outcome is accepted", (await Promise.all(["created", "duplicate", "unknown_account", "account_disabled", "waba_mismatch", "invalid"].map((o) => ingestEvent(fake({ data: o, error: null }), ev)))).length === 6);
  const fails = async (c) => { try { await ingestEvent(c, ev); return null; } catch (e) { return e instanceof IngestFailure ? e.code : "other"; } };
  check("unit: error / exception / null / unknown answer all throw IngestFailure", (await fails(fake({ data: null, error: { code: "23505" } }))) === "23505" && (await fails({ rpc: async () => { throw new Error("x"); } })) === "rpc_exception" && (await fails(fake({ data: null, error: null }))) === "unexpected_result" && (await fails(fake({ data: "nope", error: null }))) === "unexpected_result");
}

// ---- static: the route's contract ----
{
  const src = fs.readFileSync(path.join(SRC, "app/api/integrations/whatsapp/webhook/route.ts"), "utf8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\/.*$/gm, "");
  const iSig = code.indexOf("verifyWhatsAppSignature(rawBody"), iParse = code.indexOf("JSON.parse(rawBody)"), iIngest = code.indexOf("ingestEvent(");
  check("route: signature verified before JSON parse, parse before ingestion", iSig > 0 && iSig < iParse && iParse < iIngest);
  check("route: never reads profile_id from the request and holds no service key / NEXT_PUBLIC secret", !/profile_id|profileId/.test(code) && !/SERVICE_ROLE|NEXT_PUBLIC_/.test(code));
  check("route: no outbound fetch, AI or media download", !/\bfetch\(|graph\.facebook|openai|anthropic/i.test(code));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
