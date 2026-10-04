// Phase 10 automation, end to end: the REAL webhook route (signature, parse, ingest, then automation), the REAL automation module and the REAL
// text sender, the REAL cron route, and the REAL database functions (Phase 4 + 7 + 8 + 9 + 10 migrations) on scratch in-memory PostgreSQL (PGlite).
// Meta's API is a mocked fetch, notifications are captured. No Supabase, no network, no credentials, no production ids (every id is synthetic).
//   Run:  node scripts/tests/whatsappInboxAutomation.test.mjs
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const notes = [];
const STUBS = {
  "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }), }, },
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh() {} }) },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => ({}), createAdminClient: () => globalThis.__admin() },
  "@/lib/notifications": { notifyUser: async (userId, n) => { if (globalThis.__notifyThrows) throw new Error("notify down"); notes.push({ userId, ...n }); } },
};
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) { const f = base + ext; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => { if (STUBS[spec]) return STUBS[spec]; const local = resolveLocal(spec, path.dirname(file)); return local ? loadTs(local) : nodeRequire(spec); };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(SRC, p));
const Auto = src("lib/inbox/automation.ts");
const Settings = src("lib/inbox/settings.ts");
const Leads = src("lib/inbox/leads.ts");
const Save = src("lib/inbox/settingsSave.ts");
const webhook = src("app/api/integrations/whatsapp/webhook/route.ts");
const cron = src("app/api/cron/inbox-follow-ups/route.ts");
const { translations } = src("lib/i18n/translations.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const SettingsForm = src("components/inbox/InboxSettingsForm.tsx").default;
const AutoData = src("lib/inbox/automationData.ts");
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

// ============================================================ pure: settings, leads, request id
const D = Settings.DEFAULT_SETTINGS;
check("settings: every default is OFF (no acknowledgement, no reminders, no hours) and the time zone is only a default", D.autoAckMode === "off" && D.autoAckText === "" && D.followUpEnabled === false && Object.keys(D.businessHours).length === 0 && D.timezone === "Africa/Douala");
check("settingsFromRow: no row = defaults; odd values fall back safely", JSON.stringify(Settings.settingsFromRow(null)) === JSON.stringify(D) && Settings.settingsFromRow({ auto_ack_mode: "bogus", follow_up_after_hours: 9999, business_hours: { xyz: 1 }, notification_locale: "de" }).autoAckMode === "off" && Settings.settingsFromRow({ follow_up_after_hours: 9999 }).followUpAfterHours === 24 && Object.keys(Settings.settingsFromRow({ business_hours: { xyz: 1 } }).businessHours).length === 0 && Settings.settingsFromRow({ notification_locale: "de" }).notificationLocale === "fr");
check("settingsFromRow / toSavePayload round trip", (() => { const row = { timezone: "Europe/Paris", business_hours: { mon: [["08:00", "12:00"]] }, auto_ack_mode: "outside_hours", auto_ack_text: "Hi", follow_up_enabled: true, follow_up_after_hours: 6, notify_new_conversation: false, notify_failed_message: true, notify_follow_up: false, notification_locale: "en" }; const s = Settings.settingsFromRow(row); return JSON.stringify(Settings.toSavePayload(s)) === JSON.stringify(row); })());
const V = (patch) => Settings.validateSettings({ ...D, ...patch });
check("validateSettings: defaults are valid; each bad value has its own message", V({}) === null && V({ timezone: "Mars/Olympus" }) === "timezoneInvalid" && V({ timezone: "" }) === "timezoneInvalid" && V({ businessHours: { mon: [["18:00", "09:00"]] } }) === "hoursInvalid" && V({ autoAckMode: "always", autoAckText: "  " }) === "ackTextRequired" && V({ autoAckMode: "always", autoAckText: "x".repeat(501) }) === "ackTooLong" && V({ followUpAfterHours: 0 }) === "followHoursInvalid" && V({ followUpAfterHours: 169 }) === "followHoursInvalid" && V({ followUpAfterHours: 1.5 }) === "followHoursInvalid" && V({ autoAckMode: "always", autoAckText: "ok" }) === null);
check("isValidHours / isValidTimezone", Settings.isValidHours({}) && Settings.isValidHours({ mon: [["09:00", "18:00"]] }) && !Settings.isValidHours({ mon: [["9:00", "18:00"]] }) && !Settings.isValidHours({ mon: [["09:00", "18:00"], ["09:00", "10:00"], ["11:00", "12:00"], ["13:00", "14:00"]] }) && !Settings.isValidHours(null) && !Settings.isValidHours([]) && Settings.isValidTimezone("Africa/Douala") && Settings.isValidTimezone("America/New_York") && !Settings.isValidTimezone("nope") && !Settings.isValidTimezone(5));
const P = Save.pickSettings;
check("pickSettings: only known keys, type-checked; unknown keys (profile_id, recipient, phone, token) are dropped", JSON.stringify(P({ auto_ack_mode: "always", auto_ack_text: "Hi", profile_id: "evil", to: "237699999999", phone_number_id: "1", waba_id: "2", token: "t", user_id: "u" })) === JSON.stringify({ auto_ack_mode: "always", auto_ack_text: "Hi" }) && P({ profile_id: "evil" }) === null && P({}) === null);
check("pickSettings: wrong types are rejected as a whole", [{ auto_ack_mode: "x" }, { auto_ack_text: 5 }, { follow_up_after_hours: "24" }, { follow_up_after_hours: 0 }, { follow_up_after_hours: 1.5 }, { follow_up_enabled: "yes" }, { notify_follow_up: 1 }, { timezone: "Mars/Olympus" }, { business_hours: { mon: "x" } }, { notification_locale: "de" }].every((b) => P(b) === null));
const L = (o, hours = 24, now = new Date("2026-10-10T12:00:00Z")) => Leads.leadSignal({ status: "open", isCustomer: false, lastInboundAt: "2026-10-10T11:00:00Z", lastHumanOutboundAt: null, ...o }, hours, now);
check("lead signals: closed wins; recent unanswered with no reply = new lead; waiting long enough = needs follow-up; a human reply = active; customer link; priority order", L({ status: "closed", isCustomer: true, lastInboundAt: "2026-10-01T00:00:00Z" }) === "closed" && L({}) === "new_lead" && L({ lastInboundAt: "2026-10-09T11:00:00Z" }) === "needs_follow_up" && L({ lastInboundAt: "2026-10-09T11:00:00Z" }, 48) === "new_lead" && L({ lastHumanOutboundAt: "2026-10-10T11:30:00Z" }) === "active" && L({ isCustomer: true, lastHumanOutboundAt: "2026-10-10T11:30:00Z" }) === "customer" && L({ isCustomer: true }) === "customer" && L({ isCustomer: true, lastInboundAt: "2026-10-01T00:00:00Z" }) === "needs_follow_up");
check("lead signals: a reply BEFORE the customer's last message does not count, exactly at the limit counts, no inbound at all is not waiting", L({ lastInboundAt: "2026-10-09T12:00:00Z", lastHumanOutboundAt: "2026-10-09T08:00:00Z" }) === "needs_follow_up" && L({ lastInboundAt: "2026-10-09T12:00:00Z" }) === "needs_follow_up" && L({ lastInboundAt: null }) === "new_lead" && L({ lastInboundAt: null, lastHumanOutboundAt: "2026-10-01T00:00:00Z" }) === "active");
check("replyWindowOpen: within 24h only", Leads.replyWindowOpen("2026-10-10T00:00:00Z", new Date("2026-10-10T12:00:00Z")) === true && Leads.replyWindowOpen("2026-10-09T11:59:00Z", new Date("2026-10-10T12:00:00Z")) === false && Leads.replyWindowOpen(null) === false && Leads.isLeadSignal("customer") && !Leads.isLeadSignal("vip"));
const rid = Auto.ackRequestId("111", "wamid.A");
check("ackRequestId: a valid UUID v4 shape, deterministic, different per message and per number", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rid) && rid === Auto.ackRequestId("111", "wamid.A") && rid !== Auto.ackRequestId("111", "wamid.B") && rid !== Auto.ackRequestId("222", "wamid.A"));

// ============================================================ database + harness
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRF = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: PRF(1) }, bob = { user: U(2), profile: PRF(2) };
const PH_A = "1110000000001", WABA_A = "1110000000002", PH_B = "9990000000001", WABA_B = "9990000000002", TOKEN = "test-token-not-real-0002";
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
  insert into public.users values ('${alice.user}','a@x.test'), ('${bob.user}','b@x.test');
  insert into public.profiles values ('${alice.profile}','${alice.user}','alice'), ('${bob.profile}','${bob.user}','bob');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '${WABA_A}'), ('${bob.profile}', '${PH_B}', '${WABA_B}')`);
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
let rpcMode = "ok"; let rpcCalls = [];
globalThis.__admin = () => {
  if (rpcMode === "no_client") throw new Error("supabaseUrl is required");
  return { rpc: async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (rpcMode === "automation_error" && fn.startsWith("inbox_automation")) return { data: null, error: { code: "XX000", message: "row contains SECRET AUTOMATION TEXT" } };
    if (rpcMode === "claim_error" && fn === "inbox_claim_follow_ups") return { data: null, error: { code: "XX000", message: "boom" } };
    if (rpcMode === "automation_throw" && fn.startsWith("inbox_automation")) throw new Error("network down SECRET AUTOMATION TEXT");
    const named = Object.entries(args).map(([k, val]) => `${k} => ${sq(val)}`).join(", ");
    try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
  } };
};
let metaMode = "accept"; let fetchCalls = []; let seq = 0;
const realFetch = globalThis.fetch;
const JR = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  switch (metaMode) {
    case "accept": return JR(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.ACK${++seq}` }] });
    case "reject": return JR(400, { error: { code: 100, message: "SECRET META TEXT" } });
    case "network": throw new TypeError("fetch failed SECRET META TEXT");
  }
  throw new Error("unknown mode");
};
const SECRET = "test-app-secret";
process.env.WHATSAPP_ACCESS_TOKEN = TOKEN; process.env.WHATSAPP_APP_SECRET = SECRET; delete process.env.META_APP_SECRET;
process.env.WHATSAPP_PHONE_NUMBER_ID = PH_A; process.env.WHATSAPP_WABA_ID = WABA_A; process.env.CRON_SECRET = "cron-secret-test";
const sign = (b) => "sha256=" + crypto.createHmac("sha256", SECRET).update(b).digest("hex");
const payload = (value, { phone = PH_A, waba = WABA_A } = {}) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: waba, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone }, ...value } }] }] });
const inboundVal = (id, from = "237600000001", name = "Customer One", ts = Math.floor(Date.now() / 1000)) => ({ contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: String(ts), type: "text", text: { body: "Hello shop" } }] });
const statusVal = (id, st, errors) => ({ statuses: [{ id, status: st, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "237600000001", errors }] });
const logs = []; const origInfo = console.info, origErr = console.error;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));
const post = (raw) => webhook.POST(new Request("http://localhost/api/integrations/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sign(raw) } }));
const reset = () => { rpcMode = "ok"; metaMode = "accept"; fetchCalls = []; rpcCalls = []; notes.length = 0; globalThis.__notifyThrows = false; process.env.WHATSAPP_ACCESS_TOKEN = TOKEN; };
const saveSettings = async (settings) => (await asService(`select public.inbox_settings_save('${alice.user}', '${alice.profile}', ${sq(settings)}) as r`)).rows[0].r;
const outbound = async (cond = "true") => q1(`select m.*, c.external_id from public.inbox_messages m join public.inbox_conversations cv on cv.id = m.conversation_id join public.inbox_contacts c on c.id = cv.contact_id where m.direction = 'outbound' and ${cond} order by m.created_at, m.id`);
const stateOf = async (wa) => (await q1(`select st.* from public.inbox_conversation_state st join public.inbox_conversations cv on cv.id = st.conversation_id join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0];
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;

try {
  // ---------- default: nothing configured -> no message to the customer, only the new-conversation notice
  reset();
  let r = await post(payload(inboundVal("wamid.D1", "237600000001")));
  check("settings absent: the inbound message is stored (200), NOTHING is sent to the customer, no call to Meta", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.D1'")) === 1 && fetchCalls.length === 0 && (await outbound()).length === 0);
  check("settings absent: the owner gets ONE new-conversation notice (French by default) with a link to that conversation", notes.length === 1 && notes[0].userId === alice.user && notes[0].type === "inbox_new_conversation" && notes[0].title === translations.fr.inbox.notify.newTitle && notes[0].body === translations.fr.inbox.notify.newBody("Customer One") && notes[0].link === `/dashboard/inbox/${await convOf("237600000001")}`);
  reset();
  r = await post(payload(inboundVal("wamid.D1", "237600000001")));
  check("a redelivery of the same event (duplicate) triggers NO automation at all: no rpc beyond the ingest, no notice, no send", r.status === 200 && rpcCalls.every((c) => c.fn.startsWith("inbox_ingest_")) && notes.length === 0 && fetchCalls.length === 0);

  // ---------- acknowledgement: always
  await saveSettings({ auto_ack_mode: "always", auto_ack_text: "Thanks! We will reply soon.", notification_locale: "en" });
  reset();
  r = await post(payload(inboundVal("wamid.A1", "237600000002", "Customer Two")));
  const ackRows = await outbound(`c.external_id = '237600000002'`);
  check("ack always: ONE message is sent to the customer's own number through Meta, with the owner's exact text and the business number of the OWNER's account", r.status === 200 && fetchCalls.length === 1 && fetchCalls[0].url === `https://graph.facebook.com/v21.0/${PH_A}/messages` && JSON.parse(fetchCalls[0].init.body).to === "237600000002" && JSON.parse(fetchCalls[0].init.body).text.body === "Thanks! We will reply soon." && fetchCalls[0].init.headers.Authorization === `Bearer ${TOKEN}`, JSON.stringify(fetchCalls.map((c) => c.url)));
  check("ack: stored as an outbound text message (sent, with its wamid) by the owner's account, request id = the deterministic id, and recorded as AUTOMATIC", ackRows.length === 1 && ackRows[0].status === "sent" && /^wamid\.ACK/.test(ackRows[0].provider_message_id) && ackRows[0].body === "Thanks! We will reply soon." && ackRows[0].sent_by_user_id === alice.user && ackRows[0].client_request_id === Auto.ackRequestId(PH_A, "wamid.A1") && (await stateOf("237600000002")).auto_ack_message_ids.includes(ackRows[0].id));
  check("ack: the owner is notified of the new conversation in English (their notification language) and the ack text is not in the notice", notes.length === 1 && notes[0].title === translations.en.inbox.notify.newTitle && !/Thanks! We will/.test(JSON.stringify(notes)));
  reset();
  r = await post(payload(inboundVal("wamid.A2", "237600000002", "Customer Two")));
  check("ack: a second customer message within 12 hours gets NO acknowledgement and no new-conversation notice", r.status === 200 && fetchCalls.length === 0 && notes.length === 0 && (await outbound(`c.external_id = '237600000002'`)).length === 1);
  reset();
  r = await post(payload(inboundVal("wamid.A1", "237600000002", "Customer Two")));
  check("ack: redelivering the first message changes nothing (still one ack)", r.status === 200 && fetchCalls.length === 0 && (await outbound(`c.external_id = '237600000002'`)).length === 1);

  // ---------- failures never block the webhook and never cause a second send
  reset(); metaMode = "network";
  r = await post(payload(inboundVal("wamid.N1", "237600000003", "Customer Three")));
  let rows = await outbound(`c.external_id = '237600000003'`);
  check("Meta unreachable during the ack: the webhook still answers 200, the message is stored, the ack row stays 'queued' (never claimed 'sent') and is marked automatic", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.N1'")) === 1 && rows.length === 1 && rows[0].status === "queued" && rows[0].provider_message_id === null && (await stateOf("237600000003")).auto_ack_message_ids.includes(rows[0].id));
  reset();
  r = await post(payload(inboundVal("wamid.N1", "237600000003", "Customer Three")));
  check("…and a redelivery does NOT send it again (duplicate event)", r.status === 200 && fetchCalls.length === 0 && (await outbound(`c.external_id = '237600000003'`)).length === 1);
  reset(); metaMode = "reject";
  r = await post(payload(inboundVal("wamid.R1", "237600000004", "Customer Four")));
  rows = await outbound(`c.external_id = '237600000004'`);
  check("Meta rejects the ack: 200 to Meta, the ack row is 'failed', one attempt only", r.status === 200 && rows.length === 1 && rows[0].status === "failed" && fetchCalls.length === 1, JSON.stringify({ st: r.status, rows: rows.map((x) => x.status), f: fetchCalls.length, logs: logs.slice(-4) }));
  reset(); process.env.WHATSAPP_ACCESS_TOKEN = "  ";
  r = await post(payload(inboundVal("wamid.T1", "237600000005", "Customer Five")));
  check("token not configured: 200, nothing stored as outbound, nothing sent", r.status === 200 && (await outbound(`c.external_id = '237600000005'`)).length === 0 && fetchCalls.length === 0 && (await count("inbox_messages", "provider_message_id = 'wamid.T1'")) === 1);
  reset(); rpcMode = "automation_error";
  r = await post(payload(inboundVal("wamid.E1", "237600000006", "Customer Six")));
  check("the automation lookup fails: 200 anyway, the message is stored, nothing sent, no notice, no database text in the logs", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.E1'")) === 1 && fetchCalls.length === 0 && notes.length === 0 && !logs.join("\n").includes("SECRET AUTOMATION TEXT"));
  reset(); rpcMode = "automation_throw";
  r = await post(payload(inboundVal("wamid.E2", "237600000007", "Customer Seven")));
  check("the automation lookup THROWS: 200 anyway and nothing leaks", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.E2'")) === 1 && !logs.join("\n").includes("SECRET AUTOMATION TEXT"));
  reset(); globalThis.__notifyThrows = true;
  r = await post(payload(inboundVal("wamid.E3", "237600000008", "Customer Eight")));
  check("a failing notification does not stop the acknowledgement or the webhook", r.status === 200 && fetchCalls.length === 1 && (await outbound(`c.external_id = '237600000008'`)).length === 1);
  reset();

  // ---------- modes: outside_hours / off
  await saveSettings({ auto_ack_mode: "outside_hours", business_hours: { mon: [["00:00", "00:01"]], tue: [["00:00", "00:01"]], wed: [["00:00", "00:01"]], thu: [["00:00", "00:01"]], fri: [["00:00", "00:01"]], sat: [["00:00", "00:01"]], sun: [["00:00", "00:01"]] }, timezone: "UTC" });
  r = await post(payload(inboundVal("wamid.O1", "237600000009", "Customer Nine")));
  check("outside_hours with the business closed now: the acknowledgement is sent", r.status === 200 && fetchCalls.length === 1);
  await saveSettings({ business_hours: {} });
  reset();
  r = await post(payload(inboundVal("wamid.O2", "237600000010", "Customer Ten")));
  check("outside_hours with no hours configured (= always open): nothing is sent", r.status === 200 && fetchCalls.length === 0);
  await saveSettings({ auto_ack_mode: "off" });
  reset();
  r = await post(payload(inboundVal("wamid.O3", "237600000011", "Customer Eleven")));
  check("mode off: nothing is sent", r.status === 200 && fetchCalls.length === 0 && (await outbound(`c.external_id = '237600000011'`)).length === 0);
  await saveSettings({ notify_new_conversation: false });
  reset();
  r = await post(payload(inboundVal("wamid.O4", "237600000012", "Customer Twelve")));
  check("new-conversation notice switched off: none", r.status === 200 && notes.length === 0);
  await saveSettings({ notify_new_conversation: true, auto_ack_mode: "always" });

  // ---------- isolation between profiles (the webhook allowlist is single-account, so this goes through the automation module with the real database)
  reset();
  await db.exec(`select public.inbox_ingest_whatsapp_message('${PH_B}', null, 'wamid.B1', '237611111111', now(), 'text', 'hi', 'Bob Customer', null, null, null, null, null, null, null)`);
  const adminLike = globalThis.__admin();
  const bobReport = await Auto.onInboundMessage({ admin: adminLike, notify: async (u, n) => { notes.push({ userId: u, ...n }); } }, { phoneNumberId: PH_B, messageId: "wamid.B1" });
  check("another profile (bob) with no settings: no ack, alice's settings are never applied to bob, and the notice goes to bob only", bobReport.ack === "none" && fetchCalls.length === 0 && (await outbound(`c.external_id = '237611111111'`)).length === 0 && notes.length === 1 && notes[0].userId === bob.user);
  reset();
  const crossReport = await Auto.onInboundMessage({ admin: adminLike, notify: async (u, n) => { notes.push({ userId: u, ...n }); } }, { phoneNumberId: PH_A, messageId: "wamid.B1" });
  check("a message id of ANOTHER profile presented with alice's phone number id does nothing", crossReport.ack === "none" && crossReport.notified === false && notes.length === 0 && fetchCalls.length === 0);

  // ---------- delivery-failure notice
  await saveSettings({ auto_ack_mode: "off" });
  const conv1 = await convOf("237600000001");
  const human = await asService(`select public.inbox_prepare_outbound_text('${alice.user}', '${conv1}', 'e0000000-0000-4000-8000-0000000000aa', 'a human reply') as r`).then((x) => x.rows[0].r);
  await asService(`select public.inbox_complete_outbound('${alice.user}', '${human.message_id}', 'wamid.HUMAN1') as r`);
  reset();
  r = await post(payload(statusVal("wamid.HUMAN1", "failed", [{ code: 131026, title: "t" }])));
  check("a delivery FAILURE of a sent message notifies the owner once (link to the conversation)", r.status === 200 && notes.length === 1 && notes[0].type === "inbox_failed_message" && notes[0].userId === alice.user && notes[0].link === `/dashboard/inbox/${conv1}` && notes[0].title === translations.en.inbox.notify.failedTitle, JSON.stringify({ st: r.status, notes, rpc: rpcCalls.map((c) => c.fn), logs: logs.slice(-4) }));
  reset();
  r = await post(payload(statusVal("wamid.HUMAN1", "failed", [{ code: 131026, title: "t" }])));
  check("the same failure delivered again (duplicate) notifies nobody", r.status === 200 && notes.length === 0);
  reset();
  r = await post(payload(statusVal("wamid.HUMAN1", "delivered")));
  check("other statuses never notify", r.status === 200 && notes.length === 0);
  await saveSettings({ notify_failed_message: false });
  const h2 = await asService(`select public.inbox_prepare_outbound_text('${alice.user}', '${conv1}', 'e0000000-0000-4000-8000-0000000000ab', 'second') as r`).then((x) => x.rows[0].r);
  await asService(`select public.inbox_complete_outbound('${alice.user}', '${h2.message_id}', 'wamid.HUMAN2') as r`);
  reset();
  await post(payload(statusVal("wamid.HUMAN2", "failed", [{ code: 131026, title: "t" }])));
  check("failure notice switched off: none", notes.length === 0);
  await saveSettings({ notify_failed_message: true });

  // ---------- the daily cron
  const cronReq = (auth) => cron.GET(new Request("http://localhost/api/cron/inbox-follow-ups", { headers: auth === undefined ? {} : { authorization: auth } }));
  reset();
  check("cron: no authorization / wrong secret / no CRON_SECRET configured -> 401, nothing claimed", (await cronReq()).status === 401 && (await cronReq("Bearer nope")).status === 401 && (await (async () => { const s = process.env.CRON_SECRET; delete process.env.CRON_SECRET; const x = await cronReq("Bearer undefined"); process.env.CRON_SECRET = s; return x.status; })()) === 401 && rpcCalls.length === 0);
  await saveSettings({ follow_up_enabled: true, follow_up_after_hours: 2, notify_follow_up: true, notification_locale: "fr" });
  const oldTs = Math.floor(Date.now() / 1000) - 3 * 3600;
  await post(payload(inboundVal("wamid.C1", "237600000020", "Waiting Person", oldTs)));
  await post(payload(inboundVal("wamid.C2", "237600000021", "Old Window", Math.floor(Date.now() / 1000) - 30 * 3600)));
  const convC1 = await convOf("237600000020"), convC2 = await convOf("237600000021");
  reset();
  let c = await cronReq(`Bearer ${process.env.CRON_SECRET}`);
  let cb = await c.json();
  const fu = notes.filter((n) => n.type === "inbox_follow_up");
  check("cron: claims the conversations still waiting after the chosen hours and raises ONE in-app notice for each (owner, link), in the owner's language", c.status === 200 && fu.some((n) => n.link === `/dashboard/inbox/${convC1}` && n.userId === alice.user && n.title === translations.fr.inbox.notify.followTitle && n.body === translations.fr.inbox.notify.followBodyOpen("Waiting Person")) && fu.some((n) => n.link === `/dashboard/inbox/${convC2}`), JSON.stringify(notes));
  check("cron: a conversation whose 24-hour window has closed says so (a template would be needed)", fu.find((n) => n.link === `/dashboard/inbox/${convC2}`).body === translations.fr.inbox.notify.followBodyClosed("Old Window"));
  check("cron: the response is counts only (no names, numbers or text) and it NEVER contacts Meta or sends any message", Object.keys(cb).sort().join() === "claimed,notified" && cb.claimed === cb.notified && cb.claimed >= 2 && fetchCalls.length === 0 && !/Waiting Person|2376000/.test(JSON.stringify(cb)));
  reset();
  c = await cronReq(`Bearer ${process.env.CRON_SECRET}`);
  cb = await c.json();
  check("cron: running it again (overlapping or retried run) claims and notifies nobody again", c.status === 200 && cb.claimed === 0 && notes.length === 0);
  reset(); rpcMode = "claim_error";
  c = await cronReq(`Bearer ${process.env.CRON_SECRET}`);
  check("cron: a database failure -> 500 with a generic code and no database text", c.status === 500 && JSON.stringify(await c.json()) === JSON.stringify({ error: "claim_failed" }));
  reset(); rpcMode = "no_client";
  check("cron: service client unavailable -> 503", (await cronReq(`Bearer ${process.env.CRON_SECRET}`)).status === 503);
  reset(); globalThis.__notifyThrows = true;
  await db.exec(`update public.inbox_conversation_state set follow_up_notified_for = null`);
  c = await cronReq(`Bearer ${process.env.CRON_SECRET}`);
  check("cron: a failing notification is counted as claimed but not notified, and never throws", c.status === 200 && (await c.json()).notified === 0);
  reset();
} finally { console.info = origInfo; console.error = origErr; globalThis.fetch = realFetch; }

const all = logs.join("\n");
check("logs: no token, no message text, no customer name or number, no ack text, no Meta or database error text", !/test-token-not-real|Bearer|Hello shop|Thanks! We will|Customer (One|Two|Three)|Waiting Person|2376000|2376111|SECRET (META|AUTOMATION) TEXT|row contains/i.test(all), all.slice(0, 300));
check("logs: every automation line is a structured inbox_automation entry (ids, categories, counts)", logs.filter((l) => l.includes("inbox_automation\"")).every((l) => { try { return JSON.parse(l).scope === "inbox_automation"; } catch { return false; } }));

// ============================================================ UI
{
  const sIn = Settings.settingsFromRow({ auto_ack_mode: "outside_hours", auto_ack_text: "Hello <b>x</b>", business_hours: { mon: [["09:00", "18:00"]] }, timezone: "Africa/Douala", follow_up_enabled: true, follow_up_after_hours: 12 });
  const en = render("en", React.createElement(SettingsForm, { initial: sIn, available: true }));
  check("settings form (EN): sections, all seven days, the 12-hour rule, AI-free note, notification language; saved values shown", /Inbox automation/.test(en) && /Business hours/.test(en) && /Monday/.test(en) && /Sunday/.test(en) && /Automatic acknowledgement/.test(en) && /at most once every 12 hours/.test(en) && /never written by AI/.test(en) && /Follow-up reminders/.test(en) && /Language of notifications/.test(en) && /value="09:00"/.test(en) && /value="12"/.test(en) && /value="Africa\/Douala"/.test(en));
  check("settings form: a stored message with markup is escaped text, never HTML", !/<b>x<\/b>/.test(en) && /Hello &lt;b&gt;x&lt;\/b&gt;/.test(en));
  const fr = render("fr", React.createElement(SettingsForm, { initial: sIn, available: true }));
  check("settings form (FR)", /Automatisation de la boîte de réception/.test(fr) && /Heures d’ouverture/.test(fr) && /Lundi/.test(fr) && /Rappels de relance/.test(fr) && /Langue des notifications/.test(fr));
  const un = render("en", React.createElement(SettingsForm, { initial: Settings.DEFAULT_SETTINGS, available: false }));
  check("settings form: when settings are not available it says so, everything is disabled and the save button too", /not available yet/.test(un) && /<fieldset disabled=""/.test(un) && /<button type="submit" disabled=""/.test(un));
  const def = render("en", React.createElement(SettingsForm, { initial: Settings.DEFAULT_SETTINGS, available: true }));
  check("settings form: defaults show 'Never', reminders unticked, no day open", /<option value="off" selected="">Never/.test(def) && !/checked=""[^>]*id="fu-on"|id="fu-on"[^>]*checked=""/.test(def) && !/id="day-mon"[^>]*checked=""/.test(def));
  const fsrc = read("src/components/inbox/InboxSettingsForm.tsx");
  check("settings form source: saves through our own route only; posts the whole document built from the form; no profile/recipient/phone field; no secret", /callInboxTool\("POST", settingsUrl, toSavePayload\(draft\)\)/.test(fsrc) && !/profile_id|recipient|phone_number|waba|token|Bearer|supabase/i.test(fsrc.replace(/\/\/.*$/gm, "")) && /validateSettings\(draft\)/.test(fsrc));

  const convId = "d0000000-0000-4000-8000-000000000001", otherId = "d0000000-0000-4000-8000-000000000002";
  const mkItem = (id, name) => ({ id, channel: "whatsapp", status: "open", unreadCount: 0, lastMessageAt: "2026-10-10T10:00:00Z", contactName: name, preview: { kind: "text", text: "hi" }, lastDirection: "inbound" });
  const thread = { ok: true, thread: { conversation: { id: convId, channel: "whatsapp", status: "open", replyWindowOpen: false }, contact: { name: "Waiting Person", waId: "237600000020" }, truncated: false, messages: [
    { id: "m1", direction: "inbound", status: "received", at: "2026-10-09T10:00:00Z", display: { kind: "text", text: "Hello" }, unconfirmed: false },
    { id: "ackmsg", direction: "outbound", status: "sent", at: "2026-10-09T10:00:05Z", display: { kind: "text", text: "Thanks! We will reply soon." }, unconfirmed: false },
    { id: "humanmsg", direction: "outbound", status: "sent", at: "2026-10-09T10:05:00Z", display: { kind: "text", text: "Hi, a person here" }, unconfirmed: false } ] } };
  const automation = { signals: { [convId]: "needs_follow_up", [otherId]: "new_lead" }, windowOpen: { [convId]: false, [otherId]: true }, automaticMessageIds: ["ackmsg"] };
  const list = { ok: true, items: [mkItem(convId, "Waiting Person"), mkItem(otherId, "Other Person")] };
  const html = render("en", React.createElement(InboxView, { list, selectedId: convId, thread, filter: { status: "open", q: "" }, automation }));
  check("inbox UI: the list and the thread show the derived lead labels, in order of the data", /data-lead="needs_follow_up"/.test(html) && /data-lead="new_lead"/.test(html) && /Needs follow-up/.test(html) && /New lead/.test(html));
  check("inbox UI: a conversation that needs follow-up with a CLOSED window explains that a template would be needed", /data-testid="follow-up-window"/.test(html) && /24-hour window is closed\. Writing first now needs an approved template message, which is not available yet\./.test(html));
  check("inbox UI: only the automatic acknowledgement is labelled 'Automatic reply' (the human message is not)", (html.match(/data-automatic="true"/g) || []).length === 1 && /Automatic reply/.test(html));
  check("inbox UI: a link to the Automation settings", /href="\/dashboard\/inbox\/settings"[^>]*>Automation</.test(html));
  const frHtml = render("fr", React.createElement(InboxView, { list, selectedId: convId, thread, filter: { status: "open", q: "" }, automation }));
  check("inbox UI (FR): labels", /À relancer/.test(frHtml) && /Nouveau prospect/.test(frHtml) && /Réponse automatique/.test(frHtml) && /Automatisation/.test(frHtml));
  const none = render("en", React.createElement(InboxView, { list, selectedId: convId, thread, filter: { status: "open", q: "" }, automation: null }));
  check("inbox UI: with no automation data (unavailable) the inbox renders exactly as before: no label, no note", !/data-lead/.test(none) && !/data-automatic/.test(none) && !/follow-up-window/.test(none) && /Hi, a person here/.test(none));
  const closed = render("en", React.createElement(InboxView, { list: { ok: true, items: [{ ...mkItem(otherId, "X"), status: "closed" }] }, selectedId: null, thread: null, filter: { status: "all", q: "" }, automation: { signals: { [otherId]: "closed" }, windowOpen: {}, automaticMessageIds: [] } }));
  check("inbox UI: a closed conversation keeps its single Closed label (no duplicate lead badge)", !/data-lead="closed"/.test(closed) && /Closed/.test(closed));
  check("inbox UI: translations for the new strings have identical shape in EN and FR", (() => { const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((x) => (typeof x === "object" ? shape(x) : typeof x)).join(); const a = translations.en.inbox, b = translations.fr.inbox; return shape(a.settings) === shape(b.settings) && shape(a.lead) === shape(b.lead) && shape(a.notify) === shape(b.notify) && Object.keys(a).sort().join() === Object.keys(b).sort().join(); })());
}

// ============================================================ data helpers against the real database
{
  const { makeClientFactory } = await import("./pgliteShim.mjs");
  const quietErr = console.error; console.error = () => {};
  const mk = makeClientFactory(db);
  const own = mk("authenticated", () => alice.user);
  const ids = (await q1(`select id from public.inbox_conversations where profile_id = '${alice.profile}'`)).map((r) => r.id);
  const view = await AutoData.loadAutomationView(own, alice.profile, ids);
  check("loadAutomationView (owner session): returns a signal and a window flag for each of the owner's conversations", view && ids.every((i) => typeof view.signals[i] === "string" && typeof view.windowOpen[i] === "boolean"));
  const ackIds = (await q1(`select unnest(auto_ack_message_ids) id from public.inbox_conversation_state`)).map((r) => r.id);
  check("loadAutomationView: the automatic acknowledgements are reported so they can be labelled", ackIds.length >= 3 && ackIds.every((i) => view.automaticMessageIds.includes(i)));
  const c2 = await convOf("237600000002");
  check("loadAutomationView: an acknowledged conversation with no human reply is still 'new lead', not 'active' (an automatic reply is not a human one)", view.signals[c2] === "new_lead" || view.signals[c2] === "needs_follow_up");
  const bobView = await AutoData.loadAutomationView(mk("authenticated", () => bob.user), bob.profile, ids);
  check("loadAutomationView: another owner asking about alice's conversation ids learns nothing", bobView && Object.keys(bobView.signals).length === 0 && bobView.automaticMessageIds.length === 0);
  const sres = await AutoData.loadInboxSettings(own, alice.profile);
  check("loadInboxSettings (owner session): reads the owner's saved settings; another owner's session cannot read them", sres.ok && sres.saved && sres.settings.notifyFailedMessage === true && (await AutoData.loadInboxSettings(mk("authenticated", () => bob.user), alice.profile)).saved === false);
  check("loadAutomationView / loadInboxSettings: an unusable id list or a failing client degrades to null/unavailable instead of throwing", (await AutoData.loadAutomationView(own, alice.profile, ["not-a-uuid"])).automaticMessageIds.length === 0 && (await AutoData.loadAutomationView({ from() { throw new Error("x"); } }, alice.profile, ids)) === null && (await AutoData.loadInboxSettings({ from() { throw new Error("x"); } }, alice.profile)).ok === false);
  console.error = quietErr;
}

// ============================================================ static security / scope
{
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const auto = code("src/lib/inbox/automation.ts");
  check("scope: automation never calls Meta itself (the only sender is the audited text sender), has no AI, template, media or call code and no token or env access", !/fetch\(|graph\.facebook|WHATSAPP_|process\.env|anthropic|openai|aiAssist|template|sendMedia|\.insert\(|\.delete\(|(?<!createHash\("sha256"\))\.update\(/.test(auto) && /sendReply/.test(auto));
  check("scope: the only things automation sends to a customer is the database-approved ack text, via sendReply with the DETERMINISTIC request id", (auto.match(/send\(/g) || []).length === 1 && /clientRequestId: ackRequestId\(e\.phoneNumberId, e\.messageId\)/.test(auto) && /text: c\.ack_text/.test(auto));
  check("scope: every decision comes from the database functions (no business-hours, cooldown or follow-up logic in the module)", /inbox_automation_inbound/.test(auto) && /inbox_automation_failed/.test(auto) && /inbox_claim_follow_ups/.test(auto) && /inbox_automation_record_ack/.test(auto) && !/getHours|Intl\.|12 \* 3600|Date\.now/.test(auto));
  const wh = code("src/app/api/integrations/whatsapp/webhook/route.ts");
  check("webhook: automation runs only AFTER every event is stored and only for events that were NEW, inside try/catch, and it never changes the response", wh.lastIndexOf("runWebhookAutomation") > wh.indexOf('error: "ingest_failed"') && /outcome === "created"/.test(wh) && /try \{\s*await runWebhookAutomation/.test(wh) && /automation_failed/.test(wh) && !/graph\.facebook|sendReply|WHATSAPP_ACCESS_TOKEN/.test(wh));
  check("webhook: signature check, parse and allowlist still come first (order unchanged)", wh.indexOf("verifyWhatsAppSignature(") < wh.indexOf("parseWhatsAppWebhook(") && wh.indexOf("parseWhatsAppWebhook(") < wh.indexOf("partitionByAccount(") && wh.indexOf("partitionByAccount(") < wh.indexOf("ingestEvent(client"));
  const cr = code("src/app/api/cron/inbox-follow-ups/route.ts");
  check("cron: bearer CRON_SECRET, GET only, never imports a sender, service client created after authorization", /CRON_SECRET/.test(cr) && /export async function GET/.test(cr) && !/export async function (POST|PUT|PATCH|DELETE)/.test(cr) && !/sendReply|graph\.facebook|WHATSAPP_/.test(cr) && cr.indexOf("createAdminClient()") > cr.indexOf("unauthorized"));
  const v = JSON.parse(read("vercel.json"));
  check("vercel.json: the follow-up cron is scheduled once a day, next to the existing ones, none removed", v.crons.filter((x) => x.path === "/api/cron/inbox-follow-ups").length === 1 && v.crons.find((x) => x.path === "/api/cron/inbox-follow-ups").schedule === "0 10 * * *" && v.crons.length === 8 && v.crons.some((x) => x.path === "/api/cron/invoice-reminders"));
  const cat = src("lib/notificationCategories.ts");
  check("notifications: the three inbox types map to the Messages tab", ["inbox_new_conversation", "inbox_failed_message", "inbox_follow_up"].every((t) => cat.categorizeNotification(t) === "messages"));
  const sr = code("src/app/api/inbox/settings/route.ts");
  check("settings route: POST only, through the owner guard (session profile, JSON only), saves via the validating function", /export async function POST/.test(sr) && !/export async function (GET|PUT|PATCH|DELETE)/.test(sr) && /withInboxOwner/.test(sr) && /saveInboxSettings/.test(sr));
  const sv = code("src/lib/inbox/settingsSave.ts");
  check("settings save: ONE rpc, the profile comes from the actor (session), only whitelisted keys are forwarded", (sv.match(/\.rpc\(/g) || []).length === 1 && /p_actor_user_id: actor\.userId, p_profile_id: actor\.profileId/.test(sv) && /inbox_settings_save/.test(sv));
  const browser = ["src/components/inbox/InboxSettingsForm.tsx", "src/lib/inbox/settings.ts", "src/lib/inbox/leads.ts"].map(code).join("\n");
  check("security: browser-side Phase 10 code has no Node module, secret, service client or server-only import", !/require\(|from "crypto"|process\.env|WHATSAPP_|createAdminClient|supabase\/server|inbox\/automation"|inbox\/send"|graph\.facebook/.test(browser));
  const mod = src("lib/ai/knowledge/index.ts").KNOWLEDGE_MODULES.find((m) => m.id === "whatsapp-inbox");
  check("Ringo AI knows the Inbox: module registered, status partial (not claimed live), mentions the 24-hour window, AI never auto-sends, automation off by default, EN/FR labels exist in the navigation map", mod && mod.status === "partial" && /24 hours/.test(mod.body) && /nothing is sent until you press Send/i.test(mod.body) && /EVERYTHING IS OFF/.test(mod.body) && /cannot read your conversations/.test(mod.body) && /Inbox automation/.test(src("lib/ai/knowledge/navigation.ts").renderNavigationMap()));
  const migr = read("supabase/migrations/2026-12-11_whatsapp_inbox_automation.sql");
  check("migration: nothing in it can send a message, call out, or delete data (no http, no net, no truncate, deletes none of the Phase 4 tables)", !/net\.http|http_post|pg_net|truncate|delete\s+from\s+public\.inbox_(messages|conversations|contacts)/i.test(migr));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
