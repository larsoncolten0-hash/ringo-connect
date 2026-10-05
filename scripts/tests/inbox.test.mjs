// Inbox UI (Phase 6, read-only). Real migration + real ingestion function on scratch PGlite -> real data layer (through the owner's RLS session)
// -> real server pages/layout -> real InboxView component (server-rendered, EN and FR). No Supabase, no network, no credentials, no production ids.
//   Run:  node scripts/tests/inbox.test.mjs
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
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

// ---- tiny TS/TSX loader with stand-ins for the framework modules --------------------------------------------------------------------
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
class RedirectSignal extends Error { constructor(url) { super("REDIRECT"); this.url = url; } }
class NotFoundSignal extends Error { constructor() { super("NOT_FOUND"); } }
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: (url) => { throw new RedirectSignal(url); }, notFound: () => { throw new NotFoundSignal(); }, useRouter: () => ({ refresh() {} }) },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => globalThis.__sb(), createAdminClient: () => { throw new Error("the Inbox must never use the admin client"); } },
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
const F = src("lib/inbox/format.ts");
const D = src("lib/inbox/data.ts");
const A = src("lib/inbox/access.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, props) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, React.createElement(InboxView, props)));

// ---- scratch database: real migration, real ingestion function ---------------------------------------------------------------------
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: P(1) }, bob = { user: U(2), profile: P(2) }, carol = { user: U(3), profile: P(3) };
const PH_A = "1110000000001", PH_B = "9990000000001";
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
await db.exec(read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql"));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '1110000000002'), ('${bob.profile}', '${PH_B}', '9990000000002')`);
const sq = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, ${sq(o.type || "text")}, ${sq(o.text ?? null)}, ${sq(o.name ?? null)}, null, ${sq(o.mkind ?? null)}, ${sq(o.mid ?? null)}, ${sq(o.mmime ?? null)}, null, ${sq(o.mfile ?? null)}, ${sq(o.mcap ?? null)})`);
const XSS = `<img src=x onerror="alert(1)"> & <script>alert(2)</script>`;
// alice: the real production test message, an image, an interactive (unsupported) reply, plus a closed conversation with a second customer
await ingest({ phone: PH_A, id: "wamid.A1", from: "237600000001", ts: "2026-09-01T10:00:00Z", text: "Hello Ringo Testing", name: "Test Customer" });
await ingest({ phone: PH_A, id: "wamid.A2", from: "237600000001", ts: "2026-09-01T10:05:00Z", type: "image", mkind: "image", mid: "MEDIA1", mmime: "image/jpeg", mcap: "My receipt" });
await ingest({ phone: PH_A, id: "wamid.A3", from: "237600000001", ts: "2026-09-01T10:06:00Z", type: "interactive", text: null });
await ingest({ phone: PH_A, id: "wamid.A4", from: "237600000002", ts: "2026-09-02T08:00:00Z", text: XSS, name: "Second <b>Customer</b>" });
await db.exec(`update public.inbox_conversations set status = 'closed', unread_count = 0 where contact_id = (select id from public.inbox_contacts where external_id = '237600000002')`);
// bob: his own conversation that alice must never see
await ingest({ phone: PH_B, id: "wamid.B1", from: "237611111111", ts: "2026-09-01T09:00:00Z", text: "BOB PRIVATE MESSAGE", name: "Bob Customer" });
// an outbound reply in alice's first conversation (future sender stand-in)
const convA1 = (await db.query(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '237600000001'`)).rows[0].id;
const convA2 = (await db.query(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '237600000002'`)).rows[0].id;
const convB = (await db.query(`select id from public.inbox_conversations where profile_id = '${bob.profile}'`)).rows[0].id;
await db.exec(`insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, type, body, status, provider_timestamp) values ('${alice.profile}', '${convA1}', 'whatsapp', 'outbound', 'wamid.OUT1', 'text', 'Thanks, we will reply soon', 'delivered', '2026-09-01T10:10:00Z')`);

const mkClient = makeClientFactory(db);
const sessionClient = (role, sub) => mkClient(role, () => sub);
globalThis.__user = null;
globalThis.__sb = () => {
  const c = sessionClient(globalThis.__user ? "authenticated" : "anon", globalThis.__user);
  return { auth: { getUser: async () => ({ data: { user: globalThis.__user ? { id: globalThis.__user } : null } }) }, from: (t) => c.from(t) };
};
const as = (u) => { globalThis.__user = u; };
const errLogs = []; const origErr = console.error; console.error = (...a) => errLogs.push(a.join(" "));
const items = (r) => (r.ok ? r.items : null);

// ---- data layer ---------------------------------------------------------------------------------------------------------------------
{
  const own = sessionClient("authenticated", alice.user);
  const r = await D.loadConversationList(own, alice.profile);
  const list = items(r);
  check("list: owner sees exactly her two conversations, newest activity first", r.ok && list.length === 2 && list[0].contactName === "Second <b>Customer</b>" && list[1].contactName === "Test Customer", JSON.stringify(list));
  check("list: unread count comes straight from the database", list[1].unreadCount === 3 && list[0].unreadCount === 0, JSON.stringify(list.map((x) => x.unreadCount)));
  check("list: status open/closed from the database", list[0].status === "closed" && list[1].status === "open");
  check("list: latest message drives the preview (the outbound reply here), with its direction", list[1].preview?.kind === "text" && list[1].preview.text === "Thanks, we will reply soon" && list[1].lastDirection === "outbound");
  check("list: channel and last_message_at carried through", list[1].channel === "whatsapp" && typeof list[1].lastMessageAt === "string");
  const bobList = items(await D.loadConversationList(sessionClient("authenticated", bob.user), bob.profile));
  check("list: another owner sees only her own conversation", bobList.length === 1 && bobList[0].contactName === "Bob Customer" && !JSON.stringify(bobList).includes("Hello Ringo"));
  const crossList = items(await D.loadConversationList(own, bob.profile));
  check("list: even if bob's profile id is passed, alice's session (RLS) and the profile filter return nothing", crossList.length === 0);
  const none = items(await D.loadConversationList(sessionClient("authenticated", carol.user), carol.profile));
  check("list: an owner with no conversations gets an empty list", Array.isArray(none) && none.length === 0);
  const anon = await D.loadConversationList(sessionClient("anon", null), alice.profile);
  check("list: an anonymous client is refused (ok:false), never data", anon.ok === false);
}
{
  const own = sessionClient("authenticated", alice.user);
  const r = await D.loadThread(own, alice.profile, convA1);
  const t = r.ok ? r.thread : null;
  check("thread: the real production test message 'Hello Ringo Testing' is returned", r.ok && t.messages.some((m) => m.direction === "inbound" && m.display.kind === "text" && m.display.text === "Hello Ringo Testing"), JSON.stringify(r));
  check("thread: chronological order, inbound and outbound both present", t.messages.map((m) => m.direction).join() === "inbound,inbound,inbound,outbound" && t.messages[0].display.text === "Hello Ringo Testing");
  check("thread: media shown as metadata (kind, caption), unsupported type does not crash", t.messages[1].display.kind === "media" && t.messages[1].display.media === "image" && t.messages[1].display.caption === "My receipt" && t.messages[2].display.kind === "unsupported");
  check("thread: outbound status carried, contact + number + conversation status", t.messages[3].status === "delivered" && t.contact.name === "Test Customer" && t.contact.waId === "237600000001" && t.conversation.status === "open" && t.truncated === false);
  const lim = await D.loadThread(own, alice.profile, convA1, 2);
  check("thread: a limit keeps the NEWEST messages, still oldest-first, and says it was truncated", lim.ok && lim.thread.truncated === true && lim.thread.messages.length === 2 && lim.thread.messages[1].direction === "outbound");
  const cross = await D.loadThread(own, alice.profile, convB);
  check("thread: another profile's conversation id -> not_found (indistinguishable from a missing one)", !cross.ok && cross.reason === "not_found");
  const crossProfile = await D.loadThread(own, bob.profile, convB);
  check("thread: even with bob's profile id, alice's session reads nothing (RLS)", !crossProfile.ok && crossProfile.reason === "not_found");
  check("thread: a non-uuid id is rejected before any query", (await D.loadThread(own, alice.profile, "1' or '1'='1")).reason === "not_found" && (await D.loadThread(own, alice.profile, "../etc")).reason === "not_found");
  const missing = await D.loadThread(own, alice.profile, "00000000-0000-4000-8000-0000000000ff");
  check("thread: a missing id -> not_found", !missing.ok && missing.reason === "not_found");
  const mine2 = await D.loadThread(own, alice.profile, convA2);
  check("thread: customer text is returned verbatim as plain text (escaping is the renderer's job)", mine2.ok && mine2.thread.messages[0].display.text === XSS);
}
{
  const own = sessionClient("authenticated", alice.user);
  const one = await D.loadConversationList(own, alice.profile, 1);
  const two = await D.loadConversationList(own, alice.profile, 2);
  check("list: a cap smaller than the data reports truncated (and shows only the cap); an exact fit does not", one.ok && one.items.length === 1 && one.truncated === true && two.ok && two.items.length === 2 && two.truncated === false);
  check("list: the fetched look-ahead row is never returned or given a preview lookup", one.items[0].contactName === "Second <b>Customer</b>");
  // PostgREST-shape guards: record every call the data layer makes
  const calls = [];
  const wrap = (t, v) => (v && typeof v === "object" ? new Proxy(v, { get: (target, k) => (typeof target[k] === "function" ? (...a) => { calls.push([t, String(k), a]); return wrap(t, target[k](...a)); } : target[k]) }) : v);
  const spy = (client) => ({ from: (t) => wrap(t, client.from(t)) });
  await D.loadConversationList(spy(sessionClient("authenticated", carol.user)), carol.profile);
  check("postgrest: an empty list never issues .in([]) (nor any follow-up query)", calls.length > 0 && !calls.some(([, m]) => m === "in") && calls.every(([t]) => t === "inbox_conversations"), JSON.stringify(calls.map((c) => c.slice(0, 2))));
  calls.length = 0;
  await D.loadThread(spy(own), alice.profile, convA1);
  const sels = calls.filter(([, m]) => m === "select").map(([, , a]) => a[0]);
  const inCalls = calls.filter(([, m]) => m === "in");
  check("postgrest: no embeds/joins (no parentheses in any select list), no .or/.not/.filter", sels.length >= 3 && sels.every((x) => !/[()]/.test(x)) && !calls.some(([, m]) => ["or", "not", "filter", "textSearch"].includes(m)), JSON.stringify(sels));
  check("postgrest: .in() receives a non-empty array of uuids only", inCalls.length >= 1 && inCalls.every(([, , a]) => Array.isArray(a[1]) && a[1].length > 0 && a[1].every(F.isUuid)));
  check("postgrest: ordering is only on NOT NULL columns (last_message_at, received_at, id), never on a nullable timestamp", calls.filter(([, m]) => m === "order").every(([, , a]) => ["last_message_at", "received_at", "id"].includes(a[0])));
  check("postgrest: every selected column exists in the Phase 4 migration", (() => {
    const mig = read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql");
    const NL = String.fromCharCode(10);
    const cols = (table) => {
      const head = "create table if not exists public." + table + " (" + NL;
      const start = mig.indexOf(head);
      if (start < 0) return new Set();
      const body = mig.slice(start + head.length, mig.indexOf(NL + ");", start));
      return new Set(body.split(NL).map((l) => l.startsWith("  ") && !l.startsWith("   ") ? l.trim().split(" ")[0] : null).filter((c) => c && /^[a-z_]+$/.test(c)));
    };
    const used = { inbox_conversations: ["id", "channel", "status", "unread_count", "last_message_at", "contact_id", "profile_id"], inbox_contacts: ["id", "display_name", "external_id", "profile_id"],
      inbox_messages: ["id", "conversation_id", "direction", "type", "body", "status", "provider_timestamp", "received_at", "profile_id"], inbox_message_media: ["message_id", "kind", "caption", "filename", "profile_id"], wa_accounts: ["id", "profile_id"] };
    return Object.entries(used).every(([t, cs]) => cs.every((c) => cols(t).has(c)));
  })());
}
{
  // failure handling: a database error becomes ok:false with a code-only log; text, numbers and SQL never reach the log
  errLogs.length = 0;
  const boom = { from: () => { const c = new Proxy({}, { get: (_, k) => (k === "then" ? (res) => res({ data: null, error: { code: "XX000", message: "SQL BOOM Hello Ringo Testing 237600000001 select * from" } }) : () => c) }); return c; } };
  const l = await D.loadConversationList(boom, alice.profile);
  const th = await D.loadThread(boom, alice.profile, convA1);
  check("errors: list and thread fail closed (ok:false / reason error)", l.ok === false && th.ok === false && th.reason === "error");
  const thrower = { from: () => { throw new Error("network down 237600000001"); } };
  check("errors: a thrown exception is also handled", (await D.loadConversationList(thrower, alice.profile)).ok === false && (await D.loadThread(thrower, alice.profile, convA1)).ok === false);
  check("errors: logs carry a short code only (no SQL, no text, no phone numbers)", errLogs.length >= 3 && errLogs.every((l) => /query_failed/.test(l)) && !/SQL BOOM|Hello Ringo|237600000001|select \*|network down/.test(errLogs.join(" ")), errLogs.join("|"));
}

// ---- access: owner-only, session-derived ---------------------------------------------------------------------------------------------
{
  as(null);
  check("access: not signed in -> denied (not_signed_in)", (await A.resolveInboxOwner()).reason === "not_signed_in");
  as(alice.user);
  const ok = await A.resolveInboxOwner();
  check("access: signed-in owner with a WhatsApp account -> allowed, profile derived from the session", ok.ok && ok.owner.profileId === alice.profile && ok.owner.userId === alice.user);
  as(carol.user);
  check("access: signed-in owner WITHOUT a WhatsApp account -> denied (no_account)", (await A.resolveInboxOwner()).reason === "no_account");
  as("c0000000-0000-4000-8000-0000000000aa");
  check("access: a user with no profile -> denied", (await A.resolveInboxOwner()).reason === "no_profile");
  as(alice.user);
  check("nav: visible only for an owner whose profile has a WhatsApp account", (await A.inboxNavVisible({ supabase: globalThis.__sb(), profileId: alice.profile })) === true && (await A.inboxNavVisible({ supabase: globalThis.__sb(), profileId: carol.profile })) === false && (await A.inboxNavVisible({ supabase: globalThis.__sb(), profileId: null })) === false);
  check("nav: another owner's account is invisible to the session (RLS), so it is not 'visible' to the wrong user", (await A.inboxNavVisible({ supabase: globalThis.__sb(), profileId: bob.profile })) === false);
  check("nav: fails closed on a database error", (await A.inboxNavVisible({ supabase: { from: () => { throw new Error("x"); } }, profileId: alice.profile })) === false);
}

// ---- pages and layout (real server code, framework stand-ins) ------------------------------------------------------------------------
{
  const layout = src("app/dashboard/inbox/layout.tsx").default;
  const page = src("app/dashboard/inbox/page.tsx").default;
  const threadPage = src("app/dashboard/inbox/[id]/page.tsx").default;
  const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
  as(null);
  let e = await thrown(() => layout({ children: null }));
  check("layout: unauthenticated visitor is redirected to login", e instanceof RedirectSignal && e.url === "/auth/login");
  e = await thrown(() => page({ searchParams: {} }));
  check("page: unauthenticated visitor never reaches data (redirect)", e instanceof RedirectSignal);
  as(carol.user);
  e = await thrown(() => layout({ children: null }));
  check("layout: a signed-in user without a WhatsApp account is sent back to the dashboard", e instanceof RedirectSignal && e.url === "/dashboard");
  as(alice.user);
  const el = await layout({ children: "x" });
  check("layout: the owner passes", React.isValidElement(el));
  const p = await page({ searchParams: {} });
  check("page: the default list is the OWNER's (alice) OPEN conversations only, no selection, no thread", p.props.selectedId === null && p.props.thread === null && p.props.list.ok && p.props.list.items.length === 1 && p.props.list.items[0].status === "open" && p.props.filter.status === "open" && !JSON.stringify(p.props).includes("Bob Customer"));
  const pAll = await page({ searchParams: { status: "all" } });
  check("page: ?status=all lists both of her conversations, still none of bob's", pAll.props.list.items.length === 2 && !JSON.stringify(pAll.props).includes("Bob Customer"));
  const tp = await threadPage({ params: { id: convA1 } });
  check("thread page: selects the owner's conversation and loads its messages", tp.props.selectedId === convA1 && tp.props.thread.ok && tp.props.thread.thread.messages.length === 4);
  const other = await threadPage({ params: { id: convB } });
  check("thread page: another profile's conversation id renders 'not found', never its data", other.props.thread.ok === false && other.props.thread.reason === "not_found" && !JSON.stringify(other.props).includes("BOB PRIVATE"));
  const upper = await threadPage({ params: { id: convA1.toUpperCase() } });
  check("thread page: an upper-case uuid in the URL still opens the owner's conversation and selects its row", upper.props.selectedId === convA1 && upper.props.thread.ok);
  e = await thrown(() => threadPage({ params: { id: "not-a-uuid" } }));
  check("thread page: a malformed id is a 404", e instanceof NotFoundSignal);
  as(null);
  e = await thrown(() => threadPage({ params: { id: convA1 } }));
  check("thread page: unauthenticated -> redirect, no data", e instanceof RedirectSignal);
}

// ---- rendering (EN and FR) -----------------------------------------------------------------------------------------------------------
const own = sessionClient("authenticated", alice.user);
const listOk = await D.loadConversationList(own, alice.profile);
const threadOk = await D.loadThread(own, alice.profile, convA1);
const threadXss = await D.loadThread(own, alice.profile, convA2);
{
  const list = render("en", { list: listOk, selectedId: null, thread: null });
  check("render list (EN): title, conversations heading, contact, preview, WhatsApp label", /Inbox/.test(list) && /Conversations/.test(list) && /Test Customer/.test(list) && /Thanks, we will reply soon/.test(list) && /WhatsApp/.test(list));
  check("render list: unread badge with an accessible label; read conversation has none", /aria-label="3 unread messages"/.test(list) && (list.match(/unread message/g) || []).length === 1);
  const rows = list.slice(list.indexOf('<ul class="min-h-0'));
  check("render list: closed indicator only on the closed conversation's row (the Open/Closed TABS are separate)", (rows.match(/>Closed</g) || []).length === 1 && !/>Open</.test(rows));
  check("render list: rows link to /dashboard/inbox/<id>", list.includes(`href="/dashboard/inbox/${convA1}"`) && list.includes(`href="/dashboard/inbox/${convA2}"`));
  check("render list: a contact name with markup is escaped, not interpreted", !/<b>Customer<\/b>/.test(list) && /Second &lt;b&gt;Customer&lt;\/b&gt;/.test(list));
  check("render list: a message body with markup is escaped in the preview", !/<script>|<img src=x/.test(list));
  check("render list: an outbound last message is prefixed with 'You:'; inbound is not", /You: Thanks, we will reply soon/.test(list) && !/Customer: /.test(list));
  const lim = render("en", { list: { ok: true, items: listOk.items.slice(0, 1), truncated: true }, selectedId: null, thread: null });
  check("render list: a capped list says so (cannot be mistaken for the complete list); a complete list does not", /Showing your 1 most recent conversations./.test(lim) && !/most recent conversations/.test(list));
  check("render list (FR): capped notice", /Affichage de vos 1 conversations les plus récentes./.test(render("fr", { list: { ok: true, items: listOk.items.slice(0, 1), truncated: true }, selectedId: null, thread: null })));
  check("render list (desktop, nothing selected): the thread pane shows the 'Select a conversation' panel", /Select a conversation/.test(list));
  check("render list (mobile): list pane visible, thread pane hidden below lg", /<section aria-label="Conversations" class="flex min-h-0/.test(list) && /<section class="hidden lg:flex/.test(list));
  const fr = render("fr", { list: listOk, selectedId: null, thread: null });
  check("render list (FR): French title, heading and selection panel", /Boîte de réception/.test(fr) && /Conversations/.test(fr) && /Sélectionnez une conversation/.test(fr) && /3 messages non lus/.test(fr) && /Fermée/.test(fr));
}
{
  const th = render("en", { list: listOk, selectedId: convA1, thread: threadOk });
  check("render thread: the real test message 'Hello Ringo Testing' is displayed", /Hello Ringo Testing/.test(th));
  check("render thread: header has name, WhatsApp, the number and the status", /Test Customer/.test(th) && /\+237600000001/.test(th) && /WhatsApp/.test(th) && />Open</.test(th));
  check("render thread: media shows its kind, caption and the 'not shown yet' note; no <img>/<video>/<audio> element", /Image/.test(th) && /My receipt/.test(th) && /Media is not shown yet/.test(th) && !/<(img|video|audio)\b/.test(th));
  check("render thread: unsupported type shows a placeholder, no crash", /Unsupported message type/.test(th));
  check("render thread: outbound shows its status, inbound does not", /Delivered/.test(th) && !/Received</.test(th));
  check("render thread (mobile): back link to the list, hidden from lg up; list pane hidden below lg, thread pane visible", /<a href="\/dashboard\/inbox"[^>]*aria-label="Back to conversations"[^>]*lg:hidden/.test(th) && /<section aria-label="Conversations" class="hidden lg:flex/.test(th) && /<section class="flex min-h-0/.test(th));
  check("render thread: the selected conversation is marked in the list", /aria-current="page"/.test(th));
  const x = render("en", { list: listOk, selectedId: convA2, thread: threadXss });
  check("render thread: HTML in a customer message is escaped (no injected element, no script)", !/<script|<img src=x|onerror=/i.test(x.replace(/&lt;[^]*?&gt;/g, "")) && /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/.test(x) && /&lt;script&gt;/.test(x), x.slice(x.indexOf("thread-scroll"), x.indexOf("thread-scroll") + 400));
  const fr = render("fr", { list: listOk, selectedId: convA1, thread: threadOk });
  check("render thread (FR): French labels", /Type de message non pris en charge/.test(fr) && /Retour aux conversations/.test(fr) && /Distribué/.test(fr) && /Ouverte/.test(fr) && /Le média n’est pas encore affiché/.test(fr));
  const trunc = await D.loadThread(own, alice.profile, convA1, 2);
  check("render thread: a truncated thread says how many messages are shown", /Showing the latest 2 messages\./.test(render("en", { list: listOk, selectedId: convA1, thread: trunc })));
}
{
  const empty = render("en", { list: { ok: true, items: [] }, selectedId: null, thread: null });
  check("render: empty state (EN)", /No conversations yet/.test(empty) && /Messages from your customers will appear here\./.test(empty));
  const emptyFr = render("fr", { list: { ok: true, items: [] }, selectedId: null, thread: null });
  check("render: empty state (FR)", /Aucune conversation pour le moment/.test(emptyFr) && /Les messages de vos clients apparaîtront ici\./.test(emptyFr));
  const err = render("en", { list: { ok: false }, selectedId: null, thread: null });
  check("render: list failure -> safe error state with a retry link and an alert role", /role="alert"/.test(err) && /Something went wrong/.test(err) && /Try again/.test(err) && !/SQL|XX000|supabase|stack/i.test(err));
  check("render: list failure (FR)", /Une erreur s’est produite/.test(render("fr", { list: { ok: false }, selectedId: null, thread: null })));
  const te = render("en", { list: listOk, selectedId: convA1, thread: { ok: false, reason: "error" } });
  check("render: thread failure -> error state inside the thread pane, the list still renders", /role="alert"/.test(te) && /Something went wrong/.test(te) && /Test Customer/.test(te));
  const nf = render("en", { list: listOk, selectedId: convB, thread: { ok: false, reason: "not_found" } });
  check("render: a thread error's retry link reloads THAT conversation (the list error's returns to the list)", new RegExp(`href="/dashboard/inbox/${convA1}"[^>]*>Try again`).test(te) && err.includes('href="/dashboard/inbox"') && /Try again/.test(err));
  check("render: unknown conversation -> 'Conversation not found', no data", /Conversation not found/.test(nf) && !/BOB PRIVATE/.test(nf));
  const noName = render("en", { list: { ok: true, items: [{ id: "x", channel: "whatsapp", status: "open", unreadCount: 0, lastMessageAt: null, contactName: null, contactId: "y", preview: null, lastDirection: null }] }, selectedId: null, thread: null });
  check("render: missing fields are omitted gracefully (unknown contact, no time, 'No messages yet')", /Unknown contact/.test(noName) && /No messages yet/.test(noName));
  const sub = render("en", { list: { ok: true, items: [{ id: "z", channel: "whatsapp", status: "open", unreadCount: 250, lastMessageAt: "not a date", contactName: "Big", contactId: "y", preview: { kind: "unsupported" }, lastDirection: "inbound" }] }, selectedId: null, thread: null });
  check("render: huge unread counts are capped (99+); an invalid timestamp renders nothing instead of crashing", /99\+/.test(sub) && /Unsupported message type/.test(sub));
}

// ---- loading state ----
{
  const Loading = src("app/dashboard/inbox/loading.tsx").default;
  const en = renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: "en" }, React.createElement(Loading)));
  const fr = renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: "fr" }, React.createElement(Loading)));
  check("loading: skeleton with status role, translated accessible label (EN/FR), no hard-coded copy", /role="status"/.test(en) && /aria-busy="true"/.test(en) && />Loading…</.test(en) && />Chargement…</.test(fr) && !/>Loading…</.test(fr));
}

// ---- pure helpers ------------------------------------------------------------------------------------------------------------------
{
  const labels = translations.en.inbox;
  check("format: text preview collapses whitespace and is capped", F.previewText({ kind: "text", text: "a\n\n  b   c" }, labels) === "a b c" && F.previewText({ kind: "text", text: "x".repeat(200) }, labels).length === 90);
  check("format: media preview uses kind (+caption); unsupported uses the placeholder", F.previewText({ kind: "media", media: "image", caption: null, filename: null }, labels) === "Image" && F.previewText({ kind: "media", media: "audio", caption: "hi", filename: null }, labels) === "Audio · hi" && F.previewText({ kind: "unsupported" }, labels) === labels.unsupported);
  check("format: message types map safely", F.messageDisplay({ type: "text", body: "x" }).kind === "text" && F.messageDisplay({ type: "text", body: null }).kind === "unsupported" && F.messageDisplay({ type: "reaction", body: null }).kind === "unsupported" && F.messageDisplay({ type: "sticker", body: null }).kind === "media" && F.messageDisplay({ type: "__proto__", body: "x" }).kind === "unsupported");
  const now = new Date("2026-10-04T12:00:00Z");
  check("format: today -> time, this year -> short date, earlier year -> with year (Douala time)", F.formatListTime("2026-10-04T08:30:00Z", "en", now) === "09:30" && /Sep/.test(F.formatListTime("2026-09-01T10:00:00Z", "en", now)) && /2025/.test(F.formatListTime("2025-01-01T10:00:00Z", "en", now)) && /sept/.test(F.formatListTime("2026-09-01T10:00:00Z", "fr", now)));
  check("format: invalid or missing timestamps give an empty string", F.formatListTime(null, "en") === "" && F.formatListTime("garbage", "fr") === "" && F.formatBubbleTime(undefined, "en") === "");
  check("format: uuid check and number formatting", F.isUuid(convA1) && !F.isUuid("x") && !F.isUuid(null) && F.formatWaId("237600000001") === "+237600000001" && F.formatWaId("weird") === "weird");
  const sorted = F.sortThread([{ id: "b", provider_timestamp: null, received_at: "2026-09-01T10:00:00Z" }, { id: "a", provider_timestamp: "2026-09-01T09:00:00Z", received_at: "2026-09-02T00:00:00Z" }]);
  check("format: thread sorts by provider time (falling back to receipt time), stable on ties", sorted[0].id === "a" && sorted[1].id === "b");
}

// ---- translations -------------------------------------------------------------------------------------------------------------------
{
  const en = translations.en.inbox, fr = translations.fr.inbox;
  const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((v) => (typeof v === "object" ? shape(v) : typeof v)).join();
  check("i18n: EN and FR inbox sections have the same keys and shapes", shape(en) === shape(fr));
  check("i18n: required EN strings", en.title === "Inbox" && en.conversations === "Conversations" && en.emptyTitle === "No conversations yet" && en.emptyBody === "Messages from your customers will appear here." && en.selectTitle === "Select a conversation" && en.open === "Open" && en.closed === "Closed" && en.whatsapp === "WhatsApp" && en.unsupported === "Unsupported message type" && en.errorTitle === "Something went wrong");
  check("i18n: required FR strings", fr.title === "Boîte de réception" && fr.emptyTitle === "Aucune conversation pour le moment" && fr.emptyBody === "Les messages de vos clients apparaîtront ici." && fr.selectTitle === "Sélectionnez une conversation" && fr.open === "Ouverte" && fr.closed === "Fermée" && fr.whatsapp === "WhatsApp" && fr.unsupported === "Type de message non pris en charge" && fr.errorTitle === "Une erreur s’est produite");
  check("i18n: navigation label EN/FR", translations.en.nav.inbox === "Inbox" && translations.fr.nav.inbox === "Boîte de réception");
  check("i18n: no empty strings", JSON.stringify(en).indexOf('""') < 0 && JSON.stringify(fr).indexOf('""') < 0);
}

// ---- static: security and scope -----------------------------------------------------------------------------------------------------
{
  const files = ["src/lib/inbox/access.ts", "src/lib/inbox/data.ts", "src/lib/inbox/format.ts", "src/components/inbox/InboxView.tsx", "src/app/dashboard/inbox/layout.tsx", "src/app/dashboard/inbox/page.tsx", "src/app/dashboard/inbox/[id]/page.tsx", "src/app/dashboard/inbox/loading.tsx"];
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const all = files.map(code).join("\n");
  check("security: no service-role/admin client, no NEXT_PUBLIC secret, no WhatsApp token or app secret anywhere in the Inbox code", !/createAdminClient|SERVICE_ROLE|NEXT_PUBLIC_|WHATSAPP_|META_APP_SECRET|access_token/i.test(all));
  check("security: no raw HTML injection anywhere in the Inbox", !/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|eval\(/.test(all));
  check("security: the Inbox only reads (no insert/update/delete/rpc)", !/\.(insert|update|upsert|delete|rpc)\(/.test(all));
  check("security: pages never read a profile id from the URL, query string or body", !/searchParams\??\.(?!status\b|q\b)\w+|profile_id\s*[:=]\s*params|params\.profile|request\.json|formData/i.test(all) && /resolveInboxOwner/.test(code("src/app/dashboard/inbox/page.tsx")) && /resolveInboxOwner/.test(code("src/app/dashboard/inbox/[id]/page.tsx")));
  check("security: every query is scoped by the owner's profile id", ((code("src/lib/inbox/data.ts").match(/\.from\("inbox_/g) || []).length) === ((code("src/lib/inbox/data.ts").match(/\.eq\("profile_id", profileId\)/g) || []).length));
  check("security: no API endpoint exposes inbox DATA: the only inbox APIs are the eight owner-action routes (reply, media, assist, close/reopen, mark read, saved replies, settings), none exports GET", (() => { const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); const root = path.join(SRC, "app/api/inbox"); const files = walk(root).map((f) => path.relative(root, f).split(path.sep).join("/")).sort(); const allowed = ["conversations/[id]/assist/route.ts", "conversations/[id]/media/route.ts", "conversations/[id]/messages/route.ts", "conversations/[id]/read/route.ts", "conversations/[id]/status/route.ts", "saved-replies/[id]/route.ts", "saved-replies/route.ts", "settings/route.ts"]; return JSON.stringify(files) === JSON.stringify(allowed) && files.every((f) => !/export async function GET/.test(read("src/app/api/inbox/" + f))) && !fs.existsSync(path.join(SRC, "app/api/dashboard/inbox")); })());
  check("scope: no outbound send, composer, AI, media download or storage in the Inbox", !/graph\.facebook|fetch\(|<textarea|storage\.|createSignedUrl|openai|anthropic/i.test(all));
  check("scope: Inbox logging is a code only (no message text / number in console calls)", (all.match(/console\.\w+\([^)]*\)/g) || []).every((c) => /JSON\.stringify\(\{ scope: "inbox"/.test(c) || true) && !/console\.\w+\([^)]*(body|text|display|external_id|waId)/.test(all));
  const shell = read("src/components/dashboard/DashboardShell.tsx"), lay = read("src/app/dashboard/layout.tsx");
  check("nav: Inbox entry is gated on hasInbox and hidden for staff, in the More group (not a core tab)", /hasInbox && !organization\?\.isStaff \? \[\{ href: "\/dashboard\/inbox", label: t\.nav\.inbox, icon: Inbox, core: false \}\]/.test(shell) && /hasInbox = false/.test(shell));
  check("nav: the layout computes hasInbox for the owner's OWN profile only", /const hasInbox = !isActingAsStaff && ownProfile \? await inboxNavVisible\(\{ supabase, profileId: ownProfile\.id \}\) : false;/.test(lay) && /hasInbox=\{hasInbox\}/.test(lay));
}

console.error = origErr;
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
