// Human WhatsApp replies (Phase 7), end to end: the REAL route handler + the REAL send orchestrator + the REAL database functions
// (Phase 4 and Phase 7 migrations) on scratch in-memory PostgreSQL (PGlite). The Meta Graph API is a MOCK: no network call is ever made,
// no real WhatsApp message is sent, no credential or production identifier is used (every id and the "token" below are synthetic).
//   Run:  node scripts/tests/whatsappReply.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { makeClientFactory } from "./pgliteShim.mjs";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

// ---- TS/TSX loader with stand-ins for the framework modules --------------------------------------------------------------------------
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
class RedirectSignal extends Error { constructor(url) { super("REDIRECT"); this.url = url; } }
class NotFoundSignal extends Error { constructor() { super("NOT_FOUND"); } }
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: (url) => { throw new RedirectSignal(url); }, notFound: () => { throw new NotFoundSignal(); }, useRouter: () => ({ refresh() {} }) },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => globalThis.__sb(), createAdminClient: () => globalThis.__admin() },
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
const route = src("app/api/inbox/conversations/[id]/messages/route.ts");
const O = src("lib/whatsapp/outbound.ts");
const S = src("lib/inbox/send.ts");
const C = src("lib/inbox/client.ts");
const D = src("lib/inbox/data.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const { default: ReplyComposer, RetryButton } = src("components/inbox/ReplyComposer.tsx");
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, node) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, node));

// ---- scratch database -----------------------------------------------------------------------------------------------------------------
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: P(1) }, bob = { user: U(2), profile: P(2) }, carol = { user: U(3) };
const PH_A = "1110000000001", PH_B = "9990000000001", TOKEN = "test-token-not-real-0001";
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
await db.exec(read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql"));
await db.exec(read("supabase/migrations/2026-12-08_whatsapp_outbound_replies.sql"));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '1110000000002'), ('${bob.profile}', '${PH_B}', '9990000000002')`);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : `'${String(v).replace(/'/g, "''")}'`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', ${sq(o.text)}, ${sq(o.name)}, null, null, null, null, null, null, null)`);
await ingest({ phone: PH_A, id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), text: "Customer asks a question", name: "Customer One" });
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(30), text: "Old question", name: "Customer Two" });
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), text: "Bob's customer", name: "Bob Customer" });
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), convB = await convOf("237611111111");
const outRows = async (cond = "true") => q1(`select * from public.inbox_messages where direction = 'outbound' and ${cond} order by created_at, id`);

// ---- stand-ins: session (cookie) client, service-role client, and the Meta Graph API ---------------------------------------------------
const mkClient = makeClientFactory(db);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
globalThis.__user = null;
globalThis.__sb = () => {
  const c = mkClient(globalThis.__user ? "authenticated" : "anon", () => globalThis.__user);
  return { auth: { getUser: async () => ({ data: { user: globalThis.__user ? { id: globalThis.__user } : null } }) }, from: (t) => c.from(t) };
};
let rpcMode = "ok"; let rpcCalls = [];
globalThis.__admin = () => {
  if (rpcMode === "no_client") throw new Error("supabaseUrl is required");
  return {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (rpcMode === "prepare_error" && fn === "inbox_prepare_outbound_text") return { data: null, error: { code: "XX000", message: "row contains SECRET TEXT" } };
      if (rpcMode === "complete_error" && fn === "inbox_complete_outbound") return { data: null, error: { code: "XX000", message: "boom" } };
      const named = Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ");
      try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
    },
  };
};
let metaMode = "accept"; let metaCalls = []; let wamidSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  metaCalls.push({ url: String(url), init });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  switch (metaMode) {
    case "accept": return json(200, { messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: `wamid.SENT${++wamidSeq}` }] });
    case "window": return json(400, { error: { message: "SECRET META TEXT re-engagement", type: "OAuthException", code: 131047, fbtrace_id: "FBTRACE" } });
    case "reject": return json(400, { error: { message: "SECRET META TEXT invalid parameter", code: 100 } });
    case "token": return json(401, { error: { message: "SECRET META TEXT token expired", code: 190 } });
    case "rate": return json(429, { error: { message: "SECRET META TEXT", code: 130429 } });
    case "server": return json(500, { error: { message: "SECRET META TEXT" } });
    case "noid": return json(200, { messaging_product: "whatsapp", messages: [] });
    case "garbled": return new Response("<html>gateway</html>", { status: 200 });
    case "timeout": { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
    case "network": throw new TypeError("fetch failed");
    default: throw new Error("unknown mode");
  }
};
const reset = () => { metaMode = "accept"; rpcMode = "ok"; metaCalls = []; rpcCalls = []; };
process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
const logs = []; const origInfo = console.info, origErr = console.error, origWarn = console.warn;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" "));

const post = (convId, body, { user = alice.user, contentType = "application/json", raw } = {}) => {
  globalThis.__user = user;
  return route.POST(new Request(`http://localhost/api/inbox/conversations/${convId}/messages`, { method: "POST", headers: contentType ? { "content-type": contentType } : {}, body: raw !== undefined ? raw : JSON.stringify(body) }), { params: { id: convId } });
};
const send = async (convId, text, req, opts) => { const r = await post(convId, { text, client_request_id: req }, opts); return { status: r.status, body: await r.json() }; };

try {
  // ============================================================ authorization
  let r = await send(conv1, "Hello, how can we help?", R(1), { user: null });
  check("unauthenticated user cannot send (401), nothing contacted or stored", r.status === 401 && metaCalls.length === 0 && (await count("inbox_messages", "direction = 'outbound'")) === 0, JSON.stringify(r));
  reset();
  r = await send(conv1, "Hello, how can we help?", R(1));
  check("owner sends -> 200, state 'sent'", r.status === 200 && r.body.ok === true && r.body.state === "sent" && typeof r.body.message_id === "string", JSON.stringify(r));
  check("exactly ONE call to Meta, to the Graph API messages endpoint of the owner's business number", metaCalls.length === 1 && metaCalls[0].url === `https://graph.facebook.com/v21.0/${PH_A}/messages`, metaCalls.map((c) => c.url).join());
  const sentBody = JSON.parse(metaCalls[0].init.body);
  check("payload: text message to the CONVERSATION's contact, preview off, exact text", sentBody.messaging_product === "whatsapp" && sentBody.type === "text" && sentBody.to === "237600000001" && sentBody.text.body === "Hello, how can we help?" && sentBody.text.preview_url === false && sentBody.recipient_type === "individual", JSON.stringify(sentBody));
  check("server-side Bearer token sent to Meta; JSON; 10s timeout signal; no redirects", metaCalls[0].init.headers.Authorization === `Bearer ${TOKEN}` && metaCalls[0].init.headers["Content-Type"] === "application/json" && metaCalls[0].init.signal instanceof AbortSignal && metaCalls[0].init.redirect === "error" && metaCalls[0].init.method === "POST");
  const row = (await outRows())[0];
  check("persisted: ONE outbound row with the wamid, status 'sent', request id, sender, owner profile", (await outRows()).length === 1 && row.provider_message_id === "wamid.SENT1" && row.status === "sent" && row.client_request_id === R(1) && row.sent_by_user_id === alice.user && row.profile_id === alice.profile && row.body === "Hello, how can we help?" && row.direction === "outbound");
  const cv = (await q1(`select * from public.inbox_conversations where id = '${conv1}'`))[0];
  check("conversation: last_outbound_at and last_message_at updated, still open, unread NOT cleared", cv.last_outbound_at !== null && cv.status === "open" && cv.unread_count === 1);

  reset();
  const before = await count("inbox_messages");
  r = await send(conv1, "Hi", R(2), { user: bob.user });
  check("another profile's owner cannot send through a guessed conversation id (404), nothing contacted or stored", r.status === 404 && r.body.error === "not_found" && metaCalls.length === 0 && (await count("inbox_messages")) === before, JSON.stringify(r));
  reset();
  r = await send(conv1, "Hi", R(2), { user: carol.user });
  check("a user with no profile / no WhatsApp account (e.g. staff) cannot send (403)", r.status === 403 && metaCalls.length === 0 && rpcCalls.length === 0);
  check("the session/ownership gate ran before any database write was attempted for the staff user", rpcCalls.length === 0);

  reset();
  const forged = await post(conv1, { text: "Forged recipient test", client_request_id: R(3), to: "237699999999", recipient: "237699999999", phone_number_id: "5550000", waba_id: "5550001", profile_id: bob.profile, actor_user_id: bob.user, account_id: "x", type: "template" });
  const fb = JSON.parse(metaCalls[0].init.body);
  check("arbitrary recipient / phone_number_id / WABA / profile fields in the body are IGNORED: the conversation decides", forged.status === 200 && fb.to === "237600000001" && metaCalls[0].url.includes(`/${PH_A}/`) && fb.type === "text" && (await outRows(`client_request_id = '${R(3)}'`))[0].profile_id === alice.profile);
  check("the RPC call carried only the session user, the conversation, the request id and the text", Object.keys(rpcCalls[0].args).sort().join() === "p_actor_user_id,p_body,p_client_request_id,p_conversation_id" && rpcCalls[0].args.p_actor_user_id === alice.user);
  reset();
  r = await send(convB, "Hello Bob customer", R(4), { user: bob.user });
  check("bob sends in his own conversation using HIS business number (derived from his account)", r.status === 200 && metaCalls[0].url.includes(`/${PH_B}/`) && JSON.parse(metaCalls[0].init.body).to === "237611111111");

  // ============================================================ request validation
  reset();
  check("non-JSON content type -> 415, missing content type -> 415", (await post(conv1, {}, { contentType: "text/plain", raw: "text=hi" })).status === 415 && (await post(conv1, {}, { contentType: null, raw: "{}" })).status === 415);
  check("malformed JSON -> 400; oversized body -> 413", (await post(conv1, null, { raw: "{nope" })).status === 400 && (await post(conv1, null, { raw: JSON.stringify({ text: "x".repeat(40000), client_request_id: R(5) }) })).status === 413);
  check("missing / malformed client_request_id -> 422 invalid; non-uuid conversation id -> 422", (await send(conv1, "x", undefined)).body.error === "invalid" && (await send(conv1, "x", "not-a-uuid")).body.error === "invalid" && (await send("../x", "x", R(5))).body.error === "invalid");
  r = await send(conv1, "   \n  ", R(6));
  check("empty / whitespace-only message rejected (422 empty), nothing sent or stored", r.status === 422 && r.body.error === "empty" && metaCalls.length === 0 && (await outRows(`client_request_id = '${R(6)}'`)).length === 0);
  check("non-string text rejected", (await send(conv1, 12345, R(6))).body.error === "empty" && (await send(conv1, null, R(6))).body.error === "empty" && (await send(conv1, { a: 1 }, R(6))).body.error === "empty");
  r = await send(conv1, "x".repeat(4097), R(7));
  check("a message over 4096 characters is rejected (422 too_long)", r.status === 422 && r.body.error === "too_long" && metaCalls.length === 0);
  r = await send(conv1, "😀".repeat(4096), R(8));
  check("4096 characters (emoji count once, like the database) is accepted", r.status === 200 && JSON.parse(metaCalls[0].init.body).text.body.length === 8192);
  reset();
  process.env.WHATSAPP_ACCESS_TOKEN = "   ";
  r = await send(conv1, "No token", R(9));
  check("no access token configured -> 503 not_configured BEFORE anything is stored or sent", r.status === 503 && r.body.error === "not_configured" && metaCalls.length === 0 && rpcCalls.length === 0 && (await outRows(`client_request_id = '${R(9)}'`)).length === 0);
  process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
  r = await send(conv2, "Window closed", R(10));
  check("24-hour window closed -> 409 window_closed, nothing sent or stored", r.status === 409 && r.body.error === "window_closed" && metaCalls.length === 0 && (await outRows(`client_request_id = '${R(10)}'`)).length === 0);

  // ============================================================ idempotency
  reset();
  const a1 = await send(conv1, "Idempotent message", R(20));
  const a2 = await send(conv1, "Idempotent message", R(20));
  check("the same request twice (double click / browser retry) -> ONE Meta call, ONE row, same message id", a1.status === 200 && a2.status === 200 && a2.body.state === "sent" && a1.body.message_id === a2.body.message_id && metaCalls.length === 1 && (await outRows(`client_request_id = '${R(20)}'`)).length === 1, JSON.stringify([a1, a2]));
  reset();
  const burst = await Promise.all(Array.from({ length: 15 }, () => send(conv1, "Burst message", R(21))));
  check("15 simultaneous identical requests -> exactly ONE call to Meta and ONE row", metaCalls.length === 1 && (await outRows(`client_request_id = '${R(21)}'`)).length === 1 && burst.every((x) => x.body.ok === true) && burst.filter((x) => x.status === 200 && x.body.state === "sent").length >= 1, JSON.stringify(burst.map((x) => x.status + x.body.state)));
  check("the losing duplicates reported 'pending' rather than sending again", burst.filter((x) => x.status === 202 && x.body.state === "pending").length + burst.filter((x) => x.status === 200).length === 15);
  reset();
  const c1 = await send(conv1, "Same id, other text", R(20));
  check("the same request id with different text is refused (409 conflict), nothing sent", c1.status === 409 && c1.body.error === "conflict" && metaCalls.length === 0);

  // ============================================================ Meta failures and unknown outcomes
  for (const [mode, label, httpStatus, state] of [["timeout", "Meta times out", 202, "unconfirmed"], ["network", "network error", 202, "unconfirmed"], ["server", "Meta answers 500", 202, "unconfirmed"], ["noid", "Meta answers 200 without a message id", 202, "unconfirmed"], ["garbled", "Meta answers an unreadable body", 202, "unconfirmed"]]) {
    reset(); metaMode = mode;
    const id = R(100 + results.length);
    const x = await send(conv1, `unknown outcome ${mode}`, id);
    const rowX = (await outRows(`client_request_id = '${id}'`))[0];
    check(`${label}: answers ${httpStatus} '${state}' (never a false 'sent'); the row stays 'queued' with no wamid`, x.status === httpStatus && x.body.ok === true && x.body.state === state && rowX.status === "queued" && rowX.provider_message_id === null, JSON.stringify(x));
    metaCalls = []; metaMode = "accept";
    const again = await send(conv1, `unknown outcome ${mode}`, id);
    check(`${label}: replaying the same request does NOT contact Meta again (no automatic resend, no duplicate)`, again.status === 202 && again.body.state === "pending" && metaCalls.length === 0 && (await outRows(`client_request_id = '${id}'`)).length === 1);
  }
  reset(); metaMode = "window";
  let w = await send(conv1, "Meta says window", R(40));
  const rowW = (await outRows(`client_request_id = '${R(40)}'`))[0];
  check("Meta rejects (131047): 422 window_closed, state 'failed', row 'failed' with its numeric code, no wamid", w.status === 422 && w.body.error === "window_closed" && w.body.state === "failed" && rowW.status === "failed" && JSON.stringify(rowW.error_codes) === "[131047]" && rowW.provider_message_id === null, JSON.stringify(w));
  metaCalls = []; metaMode = "accept";
  const wr = await send(conv1, "Meta says window", R(40));
  check("replaying a FAILED request returns the failure without contacting Meta", wr.status === 422 && wr.body.state === "failed" && metaCalls.length === 0);
  const retried = await send(conv1, "Meta says window", R(41));
  check("Retry = a new deliberate send with a new request id: it succeeds, and the failed row stays as history", retried.status === 200 && retried.body.state === "sent" && (await outRows(`body = 'Meta says window'`)).length === 2 && (await outRows(`body = 'Meta says window' and status = 'failed'`)).length === 1);
  reset(); metaMode = "reject";
  w = await send(conv1, "Rejected message", R(42));
  check("Meta rejects (code 100): 422 send_failed (generic), row failed", w.status === 422 && w.body.error === "send_failed" && w.body.state === "failed" && (await outRows(`client_request_id = '${R(42)}'`))[0].status === "failed");
  reset(); metaMode = "rate";
  w = await send(conv1, "Rate limited message", R(43));
  check("Meta rate limit (429): 422 rate_limited, row failed", w.status === 422 && w.body.error === "rate_limited" && (await outRows(`client_request_id = '${R(43)}'`))[0].status === "failed");
  reset(); metaMode = "token";
  w = await send(conv1, "Bad token message", R(44));
  check("an invalid/expired token (401, code 190) is reported as a generic failure, never as a credentials problem", w.status === 422 && w.body.error === "send_failed" && !JSON.stringify(w.body).includes("token"));
  reset(); rpcMode = "complete_error";
  w = await send(conv1, "Accepted but not recorded", R(45));
  check("Meta ACCEPTED but the database could not record it -> 202 'unconfirmed' (not a false 'sent'), row stays queued", w.status === 202 && w.body.state === "unconfirmed" && metaCalls.length === 1 && (await outRows(`client_request_id = '${R(45)}'`))[0].status === "queued");
  check("...and the accepted wamid is logged (an id, not personal data) so it can be reconciled", logs.some((l) => l.includes("complete_failed") && l.includes("wamid.SENT")));
  reset(); rpcMode = "prepare_error";
  w = await send(conv1, "Prepare fails", R(46));
  check("database failure before sending -> 500 server_error, Meta never contacted", w.status === 500 && w.body.error === "server_error" && metaCalls.length === 0);
  reset(); rpcMode = "no_client";
  w = await send(conv1, "No admin client", R(47));
  check("service client unavailable -> 503, Meta never contacted", w.status === 503 && metaCalls.length === 0);
  reset();

  // ============================================================ status transitions on a reply sent through the app (webhook status path)
  const wamid = (await outRows(`client_request_id = '${R(1)}'`))[0].provider_message_id;
  const statusCall = (st, codes) => asService(`select public.inbox_ingest_whatsapp_status('${PH_A}', null, '${wamid}', '${st}', now(), ${codes ? `'{${codes.join(",")}}'::integer[]` : "null"}) as r`).then((x) => x.rows[0].r);
  const cur = async () => (await outRows(`client_request_id = '${R(1)}'`))[0].status;
  check("sent -> delivered -> read", (await statusCall("delivered")) === "created" && (await cur()) === "delivered" && (await statusCall("read")) === "created" && (await cur()) === "read");
  check("late 'sent' and late 'failed' cannot downgrade 'read'", (await statusCall("sent")) === "created" && (await statusCall("failed", [131026])) === "created" && (await cur()) === "read");
  check("a duplicate status is ignored", (await statusCall("read")) === "duplicate");
} finally { console.info = origInfo; console.error = origErr; console.warn = origWarn; }

// ============================================================ logging / response hygiene
const all = logs.join("\n");
check("logs never contain the token, an Authorization header, message text, customer numbers, Meta error text or SQL error text", !/test-token-not-real|Bearer|Authorization|Hello, how can we help|237600000001|237611111111|SECRET META TEXT|SECRET TEXT|re-engagement|FBTRACE|row contains/i.test(all), all.slice(0, 400));
check("the log lines that exist carry ids, categories and numeric codes only", logs.length > 5 && logs.every((l) => { try { const j = JSON.parse(l); return j.scope === "whatsapp_send"; } catch { return false; } }), logs.filter((l) => { try { return JSON.parse(l).scope !== "whatsapp_send"; } catch { return true; } }).join("|").slice(0, 300));
{
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "SECRET META TEXT", code: 100, fbtrace_id: "FBTRACE" } }), { status: 400 });
  console.error = () => {};
  const x = await send(conv1, "Body exposure test", R(200));
  console.error = origErr;
  globalThis.fetch = realFetch;
  check("responses to the browser never include Meta's raw error, trace ids, the recipient or the token", Object.keys(x.body).every((k) => ["ok", "error", "state", "message_id"].includes(k)) && !/SECRET META TEXT|FBTRACE|237600000001|test-token/.test(JSON.stringify(x.body)));
}

// ============================================================ Meta client unit tests (mocked fetch, no network)
{
  const acc = (id) => async () => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
  const ok = await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "x", token: TOKEN }, acc("wamid.U1"));
  check("unit: accepted outcome carries the wamid", ok.kind === "accepted" && ok.providerMessageId === "wamid.U1");
  check("unit: hostile phone_number_id / recipient never reach a URL or payload", (await O.sendWhatsAppText({ phoneNumberId: "1/../../x", to: "237600000001", body: "x", token: TOKEN }, acc("w"))).kind === "rejected" && (await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001;drop", body: "x", token: TOKEN }, acc("w"))).kind === "rejected" && (await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "", token: TOKEN }, acc("w"))).kind === "rejected");
  check("unit: an oversize / non-string message id is not accepted", (await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "x", token: TOKEN }, acc("w".repeat(300)))).kind === "unknown");
  const reject = (status, code) => async () => new Response(JSON.stringify({ error: { code, message: "m" } }), { status });
  const kinds = await Promise.all([[400, 131047], [429, undefined], [400, 130429], [400, 80007], [400, 100], [401, 190], [404, 33]].map(async ([s, c]) => { const o = await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "x", token: TOKEN }, reject(s, c)); return o.kind + ":" + o.error; }));
  check("unit: error classification (window / rate limit / generic)", kinds.join() === "rejected:window_closed,rejected:rate_limited,rejected:rate_limited,rejected:rate_limited,rejected:rejected,rejected:rejected,rejected:rejected", kinds.join());
  check("unit: 5xx and 408 are 'unknown' (may have been sent), never 'rejected'", (await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "x", token: TOKEN }, reject(503))).kind === "unknown" && (await O.sendWhatsAppText({ phoneNumberId: PH_A, to: "237600000001", body: "x", token: TOKEN }, reject(408))).kind === "unknown");
  check("unit: token reader trims and returns null when blank", O.getWhatsAppAccessToken({ WHATSAPP_ACCESS_TOKEN: " abc " }) === "abc" && O.getWhatsAppAccessToken({ WHATSAPP_ACCESS_TOKEN: "  " }) === null && O.getWhatsAppAccessToken({}) === null);
  check("unit: limits are the documented ones", O.MAX_TEXT_LENGTH === 4096 && O.GRAPH_VERSION === "v21.0" && O.SEND_TIMEOUT_MS === 10000);
}

// ============================================================ browser-side logic (pure) and rendering
{
  const resp = (status, body) => ({ kind: "response", status, body });
  const e = (r) => C.interpretReply(r);
  check("client: success (sent / pending / unconfirmed) clears the box, drops the request id, refreshes", ["sent", "pending", "unconfirmed"].every((s) => { const x = e(resp(s === "sent" ? 200 : 202, { ok: true, state: s })); return x.clearText && !x.keepRequestId && x.error === null && x.refresh; }));
  check("client: a stored definite failure clears the box and refreshes so the failed bubble (with Retry) shows", (() => { const x = e(resp(422, { ok: false, error: "send_failed", state: "failed" })); return x.clearText && !x.keepRequestId && x.refresh && x.error === null; })());
  check("client: a network error / unreadable answer KEEPS the text and the SAME request id (safe idempotent retry)", (() => { const x = e({ kind: "network" }); return !x.clearText && x.keepRequestId && x.error === "sendFailedMessage" && !x.refresh; })() && e(resp(500, { ok: false, error: "server_error" })).keepRequestId === true);
  check("client: validation and refusal errors keep the text, drop the request id and show the right message", e(resp(422, { ok: false, error: "empty" })).error === "emptyMessage" && e(resp(422, { ok: false, error: "too_long" })).error === "messageTooLong" && e(resp(409, { ok: false, error: "window_closed" })).error === "windowClosed" && e(resp(503, { ok: false, error: "not_configured" })).error === "notConfigured" && e(resp(409, { ok: false, error: "account_disabled" })).error === "accountDisabled" && e(resp(422, { ok: false, error: "rate_limited" })).error === "rateLimited" && e(resp(409, { ok: false, error: "conflict" })).keepRequestId === false);
  let captured = null;
  const fakeFetch = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ ok: true, state: "sent" }), { status: 200 }); };
  const pr = await C.postReply(conv1, "hello", R(300), fakeFetch);
  check("client: the request goes to OUR route with only text + client_request_id (no recipient, no profile, no token)", pr.kind === "response" && captured.url === `/api/inbox/conversations/${conv1}/messages` && JSON.stringify(Object.keys(JSON.parse(captured.init.body)).sort()) === JSON.stringify(["client_request_id", "text"]) && captured.init.method === "POST" && !/graph|Bearer|Authorization/i.test(JSON.stringify(captured)));
  check("client: a thrown fetch or a non-JSON answer is a 'network' result", (await C.postReply(conv1, "x", R(301), async () => { throw new Error("offline"); })).kind === "network" && (await C.postReply(conv1, "x", R(301), async () => new Response("<html>", { status: 502 }))).kind === "network");
  check("client: the id is a UUID when crypto is available", /^[0-9a-f-]{36}$/.test(C.newRequestId()));
}
{
  const open = render("en", React.createElement(ReplyComposer, { conversationId: conv1, open: true }));
  check("composer (EN): labelled textarea, Send button, keyboard hint, 4096 limit; Enter is NOT the send key", /<label[^>]*class="sr-only"[^>]*>Reply<\/label>/.test(open) && /<textarea[^>]*maxLength="4096"/.test(open) && />Send<\/button>/.test(open) && /Press Ctrl\+Enter to send\./.test(open) && /placeholder="Write a reply…"/.test(open) && /aria-describedby/.test(open));
  check("composer: not disabled when idle; has a polite live region for 'Sending…'", !/<button[^>]* disabled=""/.test(open) && /aria-live="polite"/.test(open));
  const fr = render("fr", React.createElement(ReplyComposer, { conversationId: conv1, open: true }));
  check("composer (FR)", />Répondre<\/label>/.test(fr) && />Envoyer<\/button>/.test(fr) && /Appuyez sur Ctrl\+Entrée pour envoyer\./.test(fr) && /Écrivez une réponse…/.test(fr));
  const closed = render("en", React.createElement(ReplyComposer, { conversationId: conv1, open: false }));
  check("composer: window closed -> explanation instead of a textarea", /24-hour reply window has closed/.test(closed) && !/<textarea/.test(closed) && !/<button/.test(closed));
  check("composer (FR): window closed", /fenêtre de réponse de 24 heures est fermée/.test(render("fr", React.createElement(ReplyComposer, { conversationId: conv1, open: false }))));
  const retry = render("en", React.createElement(RetryButton, { conversationId: conv1, text: "hi" }));
  check("retry button renders as a button labelled Retry / Réessayer", />Retry<\/button>/.test(retry) && />Réessayer<\/button>/.test(render("fr", React.createElement(RetryButton, { conversationId: conv1, text: "hi" }))));
}
{
  // thread rendering with real rows produced above: sent, failed, unconfirmed (queued, old), XSS
  await db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id, received_at) values ('${alice.profile}', '${conv1}', 'whatsapp', 'outbound', 'text', '<img src=x onerror=alert(1)> stuck', 'queued', '${alice.user}', '${R(400)}', now() - interval '10 minutes')`);
  await db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id, received_at) values ('${alice.profile}', '${conv1}', 'whatsapp', 'outbound', 'text', 'fresh queued', 'queued', '${alice.user}', '${R(401)}', now())`);
  const own = mkClient("authenticated", () => alice.user);
  const t1 = await D.loadThread(own, alice.profile, conv1);
  const msgs = t1.thread.messages;
  const byBody = (b) => msgs.find((m) => m.display.text === b || (m.display.text || "").includes(b));
  check("data: an old 'queued' outbound message is flagged unconfirmed; a fresh one and a sent one are not", byBody("stuck").unconfirmed === true && byBody("fresh queued").unconfirmed === false && byBody("Hello, how can we help?").unconfirmed === false && byBody("Hello, how can we help?").status !== "queued");
  check("data: replyWindowOpen is true when the customer wrote within 24h, false after", t1.thread.conversation.replyWindowOpen === true && (await D.loadThread(own, alice.profile, conv2)).thread.conversation.replyWindowOpen === false);
  const list = await D.loadConversationList(own, alice.profile);
  const html = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: t1 }));
  check("thread: outbound bubbles show Sent/Delivered/Read/Failed labels, 'Sending…' for a fresh queued message", /Sent|Delivered|Read/.test(html) && />· Failed</.test(html) && /· Sending…/.test(html));
  check("thread: an old queued message is shown as 'Delivery not confirmed', never as sent or delivered, and has no Retry (it may already have been delivered)", /Delivery not confirmed/.test(html) && !/stuck<\/p>[^]*?<button[^>]*>Retry/.test(html.slice(html.indexOf("stuck"), html.indexOf("stuck") + 600)));
  check("thread: a FAILED text message offers Retry; sent/delivered/read messages do not", (html.match(/>Retry<\/button>/g) || []).length === (msgs.filter((m) => m.direction === "outbound" && m.status === "failed" && m.display.kind === "text").length));
  check("thread: outbound message text is escaped (XSS-safe)", !/<img src=x onerror/.test(html) && /&lt;img src=x onerror=alert\(1\)&gt; stuck/.test(html));
  check("thread: composer is present under the thread for a WhatsApp conversation", /<textarea/.test(html) && />Send<\/button>/.test(html));
  const frHtml = render("fr", React.createElement(InboxView, { list, selectedId: conv1, thread: t1 }));
  check("thread (FR): Envoyé / Distribué / Lu / Échec labels and 'Livraison non confirmée'", /Envoyé|Distribué|Lu/.test(frHtml) && /· Échec/.test(frHtml) && /Livraison non confirmée/.test(frHtml) && /Envoi…/.test(frHtml));
  const t2 = await D.loadThread(own, alice.profile, conv2);
  const htmlClosed = render("en", React.createElement(InboxView, { list, selectedId: conv2, thread: t2 }));
  check("thread: when the 24-hour window is closed the composer is replaced by the explanation", /24-hour reply window has closed/.test(htmlClosed) && !/<textarea/.test(htmlClosed));
  const tx = JSON.parse(JSON.stringify(t1.thread)); tx.conversation.channel = "other";
  check("thread: no composer for a non-WhatsApp channel", !/<textarea/.test(render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: { ok: true, thread: tx } }))));
}

// ============================================================ translations
{
  const en = translations.en.inbox, fr = translations.fr.inbox;
  const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((v) => (typeof v === "object" ? shape(v) : typeof v)).join();
  check("i18n: EN and FR inbox sections still have identical keys and shapes", shape(en) === shape(fr));
  check("i18n: required EN strings", en.reply === "Reply" && en.send === "Send" && en.sending === "Sending…" && en.statuses.sent === "Sent" && en.statuses.delivered === "Delivered" && en.statuses.read === "Read" && en.statuses.failed === "Failed" && en.retryMessage === "Retry" && en.emptyMessage === "Message cannot be empty" && en.messageTooLong === "Message is too long" && en.sendFailedMessage === "Failed to send message" && en.retry === "Try again");
  check("i18n: required FR strings", fr.reply === "Répondre" && fr.send === "Envoyer" && fr.sending === "Envoi…" && fr.statuses.sent === "Envoyé" && fr.statuses.delivered === "Distribué" && fr.statuses.read === "Lu" && fr.statuses.failed === "Échec" && fr.retryMessage === "Réessayer" && fr.emptyMessage === "Le message ne peut pas être vide" && fr.messageTooLong === "Le message est trop long" && fr.sendFailedMessage === "Échec de l’envoi du message" && fr.retry === "Réessayer");
  check("i18n: no empty strings", !JSON.stringify(en).includes('""') && !JSON.stringify(fr).includes('""'));
}

// ============================================================ static security checks
{
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const clientFiles = ["src/components/inbox/ReplyComposer.tsx", "src/components/inbox/InboxView.tsx", "src/lib/inbox/client.ts", "src/lib/inbox/format.ts"];
  const clientCode = clientFiles.map(code).join("\n");
  check("security: the access token is read in ONE server-only place (outbound.ts) and nowhere in client code", /WHATSAPP_ACCESS_TOKEN/.test(code("src/lib/whatsapp/outbound.ts")) && !/WHATSAPP_|ACCESS_TOKEN|process\.env/.test(clientCode));
  check("security: no NEXT_PUBLIC_ variable anywhere in the new code", !/NEXT_PUBLIC_/.test(["src/lib/whatsapp/outbound.ts", "src/lib/inbox/send.ts", "src/app/api/inbox/conversations/[id]/messages/route.ts", ...clientFiles].map(code).join("\n")));
  check("security: the browser never references Meta (graph.facebook.com / Bearer) and client files never import the server-only modules", !/graph\.facebook|Bearer|Authorization/.test(clientCode) && !/whatsapp\/outbound|inbox\/send|supabase\/server/.test(clientCode));
  check("security: graph.facebook.com appears only in the server-only sender", /graph\.facebook\.com/.test(code("src/lib/whatsapp/outbound.ts")) && !/graph\.facebook/.test(code("src/lib/inbox/send.ts")) && !/graph\.facebook/.test(code("src/app/api/inbox/conversations/[id]/messages/route.ts")));
  check("security: the sender never logs: no console call in outbound.ts; send.ts logs ids/categories only", !/console\./.test(code("src/lib/whatsapp/outbound.ts")) && !/console\.\w+\([^)]*(text|body|token|to\b|Authorization|headers)/.test(code("src/lib/inbox/send.ts").replace(/log\(\{[^}]*\}\)/g, "")));
  const routeSrc = code("src/app/api/inbox/conversations/[id]/messages/route.ts");
  check("security: the only inbox API route exports POST only, requires JSON, derives the owner from the session and reads just text + client_request_id from the body", /export async function POST/.test(routeSrc) && !/export async function (GET|PUT|PATCH|DELETE)/.test(routeSrc) && /application\/json/.test(routeSrc) && /resolveInboxOwner/.test(routeSrc) && /b\.client_request_id/.test(routeSrc) && /b\.text/.test(routeSrc) && !/b\.(to|phone|waba|profile|recipient)/i.test(routeSrc));
  check("security: the inbox API is exactly the reply route plus the Phase 8 owner-action routes (status, saved replies); nothing else", (() => { const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); const root = path.join(SRC, "app/api/inbox"); return JSON.stringify(walk(root).map((f) => path.relative(root, f).split(path.sep).join("/")).sort()) === JSON.stringify(["conversations/[id]/assist/route.ts", "conversations/[id]/media/route.ts", "conversations/[id]/messages/route.ts", "conversations/[id]/status/route.ts", "saved-replies/[id]/route.ts", "saved-replies/route.ts", "settings/route.ts"]); })());
  check("security: the read-only Inbox data layer is unchanged in nature (no writes, no admin client, no rpc)", !/createAdminClient|\.(insert|update|upsert|delete|rpc)\(/.test(["src/lib/inbox/data.ts", "src/lib/inbox/access.ts"].map(code).join("\n")));
  check("scope: no AI, template, media sending or notifications in the sender, the orchestrator or the composer; the sender and orchestrator know nothing about saved replies (the composer only inserts text, Phase 8)", !/openai|anthropic|type: "template"|type: "image"|notify|sendNotification/i.test(["src/lib/whatsapp/outbound.ts", "src/lib/inbox/send.ts", "src/components/inbox/ReplyComposer.tsx"].map(code).join("\n")) && !/saved.?repl/i.test(["src/lib/whatsapp/outbound.ts", "src/lib/inbox/send.ts"].map(code).join("\n")));
  check("the webhook route, parser and ingestion code are untouched by Phase 7 (no outbound import)", !/outbound|inbox\/send/.test(code("src/app/api/integrations/whatsapp/webhook/route.ts")) && !/outbound/.test(code("src/lib/whatsapp/parseWebhook.ts") + code("src/lib/whatsapp/ingest.ts")));
}

// ============================================================ composer behaviour (source-level: the keyboard / double-send rules)
{
  const c = read("src/components/inbox/ReplyComposer.tsx");
  const composer = c.slice(0, c.indexOf("export function RetryButton"));
  check("composer: send is locked while in flight (button disabled, box read-only, and a ref guard against a double submit)", /disabled=\{sending\}/.test(composer) && /readOnly=\{sending\}/.test(composer) && /if \(inFlight\.current\) return;/.test(composer));
  check("composer: Enter alone does NOT send; only Ctrl/Cmd+Enter (and not while an IME is composing) or the Send button", /e\.key === "Enter" && \(e\.ctrlKey \|\| e\.metaKey\) && !e\.nativeEvent\.isComposing/.test(composer) && !/onKeyPress/.test(composer) && !/e\.key === "Enter"\s*&&\s*!e\.shiftKey/.test(composer));
  check("composer: empty and over-long text are rejected client-side before any request", /trimmed === ""\) return setError\("emptyMessage"\)/.test(composer) && /MAX_REPLY_LENGTH\) return setError\("messageTooLong"\)/.test(composer));
  check("composer: the request id is created once per action, kept across an unknown outcome, and reset when the text changes", /if \(!requestId\.current\) requestId\.current = newRequestId\(\)/.test(composer) && /if \(!effect\.keepRequestId\) requestId\.current = null/.test(composer) && /e\.target\.value\.trim\(\) !== requestText\.current\) requestId\.current = null/.test(composer));
  check("composer: errors are announced (role=alert) and the pending state is announced (aria-live)", /role="alert"/.test(composer) && /aria-live="polite"/.test(composer));
}

globalThis.fetch = realFetch;
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
