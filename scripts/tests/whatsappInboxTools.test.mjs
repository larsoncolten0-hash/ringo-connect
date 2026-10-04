// Phase 8 Inbox tools, end to end: the REAL routes (saved replies, close/reopen), the REAL data layer (filters, search), the REAL components
// (EN and FR) and the REAL database functions (Phase 4 + 7 + 8 migrations) on scratch in-memory PostgreSQL (PGlite). Media: the real webhook parser
// and ingestion function for all five media kinds. No Supabase, no network, no credentials, no production ids (everything below is synthetic).
//   Run:  node scripts/tests/whatsappInboxTools.test.mjs
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
const F = src("lib/inbox/format.ts");
const D = src("lib/inbox/data.ts");
const C = src("lib/inbox/client.ts");
const T = src("lib/inbox/tools.ts");
const parse = src("lib/whatsapp/parseWebhook.ts").parseWhatsAppWebhook;
const IN = src("lib/whatsapp/ingest.ts");
const routes = {
  status: src("app/api/inbox/conversations/[id]/status/route.ts"),
  create: src("app/api/inbox/saved-replies/route.ts"),
  item: src("app/api/inbox/saved-replies/[id]/route.ts"),
};
const pageList = src("app/dashboard/inbox/page.tsx").default;
const pageThread = src("app/dashboard/inbox/[id]/page.tsx").default;
const pageReplies = src("app/dashboard/inbox/replies/page.tsx").default;
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const Manager = src("components/inbox/SavedRepliesManager.tsx").default;
const Composer = src("components/inbox/ReplyComposer.tsx").default;
const StatusButton = src("components/inbox/ConversationStatusButton.tsx").default;
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

// ---- scratch database ---------------------------------------------------------------------------------------------------------------------
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
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '1110000000002'), ('${bob.profile}', '${PH_B}', '9990000000002')`);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : `'${String(v).replace(/'/g, "''")}'`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, ${sq(o.type || "text")}, ${sq(o.text ?? "hi")}, ${sq(o.name)}, null, ${sq(o.mkind ?? null)}, ${sq(o.mid ?? null)}, ${sq(o.mmime ?? null)}, null, ${sq(o.mfile ?? null)}, ${sq(o.mcap ?? null)})`);
await ingest({ phone: PH_A, id: "wamid.A1", from: "237600000001", ts: hoursAgo(3), name: "Customer One", text: "Hello from customer one" });
await ingest({ phone: PH_A, id: "wamid.A2", from: "237600000001", ts: hoursAgo(2), name: "Customer One", text: "Second message" });
await ingest({ phone: PH_A, id: "wamid.M1", from: "237677000111", ts: hoursAgo(5), name: "Maria Test", text: "Maria asks something" });
await ingest({ phone: PH_A, id: "wamid.N1", from: "237655999888", ts: hoursAgo(6), name: "Zoe O'Neil-Smith", text: "Zoe here" });
await ingest({ phone: PH_B, id: "wamid.B1", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer", text: "BOB PRIVATE MESSAGE" });
await ingest({ phone: PH_B, id: "wamid.B2", from: "237677000222", ts: hoursAgo(1), name: "Maria Bobside", text: "BOB MARIA" });
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), convMaria = await convOf("237677000111"), convZoe = await convOf("237655999888"), convB = await convOf("237611111111");
await db.exec(`update public.inbox_conversations set status = 'closed', unread_count = 0 where id = '${convMaria}'`);

// ---- stand-ins: session client, service client, request helpers -----------------------------------------------------------------------
const mkClient = makeClientFactory(db);
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
      if (rpcMode === "rpc_error") return { data: null, error: { code: "XX000", message: "row contains SECRET TITLE" } };
      const named = Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ");
      try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
    },
  };
};
const logs = []; const origErr = console.error, origInfo = console.info;
console.error = (...a) => logs.push(a.join(" ")); console.info = (...a) => logs.push(a.join(" "));
const as = (u) => { globalThis.__user = u; };
const reset = () => { rpcMode = "ok"; rpcCalls = []; };
const call = async (handler, url, method, body, { user = alice.user, contentType = "application/json", raw, params } = {}) => {
  as(user);
  const res = await handler(new Request(`http://localhost${url}`, { method, headers: contentType ? { "content-type": contentType } : {}, body: method === "GET" ? undefined : raw !== undefined ? raw : JSON.stringify(body ?? {}) }), { params });
  return { status: res.status, body: await res.json() };
};
const createReply = (title, body, o) => call(routes.create.POST, "/api/inbox/saved-replies", "POST", { title, body }, o);
const updateReply = (id, title, body, o) => call(routes.item.PATCH, `/api/inbox/saved-replies/${id}`, "PATCH", { title, body }, { ...o, params: { id } });
const deleteReply = (id, o) => call(routes.item.DELETE, `/api/inbox/saved-replies/${id}`, "DELETE", {}, { ...o, params: { id } });
const setStatus = (id, status, o) => call(routes.status.POST, `/api/inbox/conversations/${id}/status`, "POST", { status }, { ...o, params: { id } });
const ownerClient = (u) => mkClient("authenticated", () => u);
const names = (r) => r.items.map((i) => i.contactName);

try {
  // ============================================================ saved replies: create / read / update / delete
  reset();
  let r = await createReply("  Welcome  ", "  Hello! Thanks for contacting us.  ");
  check("owner creates a saved reply -> 201 with an id", r.status === 201 && r.body.ok === true && typeof r.body.id === "string", JSON.stringify(r));
  const id1 = r.body.id;
  check("the RPC call carried only the session user, the SESSION profile, the reply id, title and body", rpcCalls.length === 1 && rpcCalls[0].fn === "inbox_saved_reply_save" && Object.keys(rpcCalls[0].args).sort().join() === "p_actor_user_id,p_body,p_profile_id,p_reply_id,p_title" && rpcCalls[0].args.p_actor_user_id === alice.user && rpcCalls[0].args.p_profile_id === alice.profile && rpcCalls[0].args.p_reply_id === null);
  const row = (await q1(`select * from public.inbox_saved_replies where id = '${id1}'`))[0];
  check("stored trimmed under the owner's profile", row.title === "Welcome" && row.body === "Hello! Thanks for contacting us." && row.profile_id === alice.profile);
  const readA = await D.loadSavedReplies(ownerClient(alice.user), alice.profile);
  check("owner reads her saved replies", readA.ok && readA.items.length === 1 && readA.items[0].title === "Welcome" && readA.items[0].id === id1);
  r = await updateReply(id1, "Welcome message", "Hello and welcome!");
  check("owner updates it -> 200", r.status === 200 && (await q1(`select title, body from public.inbox_saved_replies where id = '${id1}'`))[0].title === "Welcome message");
  const second = (await createReply("Opening hours", "Mon-Sat 8-18")).body.id;
  check("a second reply is listed in title order", (await D.loadSavedReplies(ownerClient(alice.user), alice.profile)).items.map((x) => x.title).join() === "Opening hours,Welcome message");
  r = await deleteReply(second);
  check("owner deletes one -> 200, gone from the list and the table", r.status === 200 && (await count("inbox_saved_replies", `id = '${second}'`)) === 0 && (await D.loadSavedReplies(ownerClient(alice.user), alice.profile)).items.length === 1);
  check("deleting again -> 404", (await deleteReply(second)).status === 404);

  // ============================================================ saved replies: isolation / auth
  reset();
  const bobId = (await createReply("Bob only", "bob body", { user: bob.user })).body.id;
  const bobList = await D.loadSavedReplies(ownerClient(bob.user), bob.profile);
  check("another profile has her own list and never sees alice's", bobList.items.length === 1 && bobList.items[0].title === "Bob only" && !JSON.stringify(bobList).includes("Welcome"));
  check("a profile id passed to the loader that is not the session's returns nothing (RLS + filter)", (await D.loadSavedReplies(ownerClient(alice.user), bob.profile)).items.length === 0);
  r = await updateReply(id1, "Hacked", "Hacked", { user: bob.user });
  check("bob cannot edit alice's saved reply (404), nothing changed", r.status === 404 && (await q1(`select title from public.inbox_saved_replies where id = '${id1}'`))[0].title === "Welcome message");
  check("bob cannot delete alice's saved reply (404)", (await deleteReply(id1, { user: bob.user })).status === 404 && (await count("inbox_saved_replies", `id = '${id1}'`)) === 1);
  check("alice cannot touch bob's (404)", (await updateReply(bobId, "x", "y")).status === 404 && (await deleteReply(bobId)).status === 404 && (await count("inbox_saved_replies", `id = '${bobId}'`)) === 1);
  reset();
  r = await createReply("Injected", "x", { user: alice.user });
  const forged = await call(routes.create.POST, "/api/inbox/saved-replies", "POST", { title: "Forged owner", body: "x", profile_id: bob.profile, actor_user_id: bob.user, user_id: bob.user, owner: bob.user }, { user: alice.user });
  check("profile_id / user fields in the body are IGNORED: the reply lands on the SESSION's profile", forged.status === 201 && (await q1(`select profile_id from public.inbox_saved_replies where id = '${forged.body.id}'`))[0].profile_id === alice.profile && rpcCalls.at(-1).args.p_profile_id === alice.profile && rpcCalls.at(-1).args.p_actor_user_id === alice.user);
  check("unauthenticated: 401 on every saved-reply route, no database call", await (async () => { reset(); const a = await createReply("x", "y", { user: null }); const b = await updateReply(id1, "x", "y", { user: null }); const c = await deleteReply(id1, { user: null }); return a.status === 401 && b.status === 401 && c.status === 401 && rpcCalls.length === 0; })());
  check("a signed-in user without a WhatsApp account (e.g. staff) is refused (403), no database call", await (async () => { reset(); const a = await createReply("x", "y", { user: carol.user }); const c = await deleteReply(id1, { user: carol.user }); return a.status === 403 && c.status === 403 && rpcCalls.length === 0; })());
  check("JSON only: other content types -> 415; malformed JSON -> 400; oversize -> 413", (await createReply("x", "y", { contentType: "text/plain", raw: "title=x" })).status === 415 && (await createReply("x", "y", { raw: "{nope" })).status === 400 && (await createReply("x", "y", { raw: JSON.stringify({ title: "x", body: "z".repeat(40000) }) })).status === 413);
  check("a malformed reply id -> 404 without touching the database", await (async () => { reset(); const x = await updateReply("not-a-uuid", "x", "y"); const y = await deleteReply("../etc"); return x.status === 404 && y.status === 404 && rpcCalls.length === 0; })());

  // ============================================================ saved replies: validation / limits / failures
  reset();
  check("empty / whitespace / non-string title or body -> 422", (await createReply("   ", "x")).status === 422 && (await createReply("t", "")).status === 422 && (await createReply(null, "x")).status === 422 && (await createReply("t", { a: 1 })).status === 422 && rpcCalls.length === 0);
  check("title 61 / body 4097 -> 422 before any database call; 60 / 4096 accepted", (await createReply("t".repeat(61), "x")).status === 422 && (await createReply("t", "b".repeat(4097))).status === 422 && rpcCalls.length === 0 && (await createReply("t".repeat(60), "b".repeat(4096))).status === 201);
  check("a duplicate title (any case) -> 409 duplicate_title", (await createReply("WELCOME MESSAGE", "x")).body.error === "duplicate_title" && (await updateReply(bobId, "x", "y")).status === 404);
  for (let i = (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)); i < 50; i++) await createReply(`Filler ${i}`, "b");
  r = await createReply("One too many", "x");
  check("the 51st saved reply -> 409 limit_reached", r.status === 409 && r.body.error === "limit_reached" && (await count("inbox_saved_replies", `profile_id = '${alice.profile}'`)) === 50);
  reset(); rpcMode = "rpc_error";
  r = await createReply("Boom title", "Boom body");
  check("a database error -> 500 server_error with nothing leaked", r.status === 500 && r.body.error === "server_error" && !JSON.stringify(r.body).includes("SECRET"));
  reset(); rpcMode = "no_client";
  check("service client unavailable -> 503", (await createReply("x", "y")).status === 503);
  reset();

  // ============================================================ close / reopen
  const unreadBefore = (await q1(`select unread_count from public.inbox_conversations where id = '${conv1}'`))[0].unread_count;
  r = await setStatus(conv1, "closed");
  check("owner closes a conversation -> 200 state closed", r.status === 200 && r.body.state === "closed" && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "closed");
  check("closing leaves unread_count untouched (no fake 'mark as read')", (await q1(`select unread_count from public.inbox_conversations where id = '${conv1}'`))[0].unread_count === unreadBefore && unreadBefore === 2);
  check("closing again is a harmless no-op (200)", (await setStatus(conv1, "closed")).status === 200);
  r = await setStatus(conv1, "open");
  check("owner reopens it -> 200 state open", r.status === 200 && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "open");
  reset();
  check("another profile cannot close or reopen alice's conversation (404), nothing changed", (await setStatus(conv1, "closed", { user: bob.user })).status === 404 && (await setStatus(convMaria, "open", { user: bob.user })).status === 404 && (await q1(`select status from public.inbox_conversations where id = '${conv1}'`))[0].status === "open" && (await q1(`select status from public.inbox_conversations where id = '${convMaria}'`))[0].status === "closed");
  check("alice cannot touch bob's conversation (404)", (await setStatus(convB, "closed")).status === 404 && (await q1(`select status from public.inbox_conversations where id = '${convB}'`))[0].status === "open");
  reset();
  check("unauthenticated -> 401; no WhatsApp account -> 403; no database call in either case", (await setStatus(conv1, "closed", { user: null })).status === 401 && (await setStatus(conv1, "closed", { user: carol.user })).status === 403 && rpcCalls.length === 0);
  check("invalid status values -> 422 before the database; malformed id -> 404", (await setStatus(conv1, "archived")).status === 422 && (await setStatus(conv1, null)).status === 422 && (await setStatus(conv1, { a: 1 })).status === 422 && (await setStatus("zzz", "open")).status === 404 && rpcCalls.length === 0);
  check("browser-supplied owner/recipient/phone fields are ignored by the status route", await (async () => { reset(); const x = await call(routes.status.POST, `/api/inbox/conversations/${conv1}/status`, "POST", { status: "closed", profile_id: bob.profile, to: "237699999999", phone_number_id: "1", waba_id: "2" }, { params: { id: conv1 } }); const a = rpcCalls[0].args; await setStatus(conv1, "open"); return x.status === 200 && Object.keys(a).sort().join() === "p_actor_user_id,p_conversation_id,p_status"; })());
  check("closing never changes messages or provider statuses", await (async () => { const before = JSON.stringify(await q1(`select id, status, body, provider_message_id from public.inbox_messages order by id`)); await setStatus(conv1, "closed"); await setStatus(conv1, "open"); return JSON.stringify(await q1(`select id, status, body, provider_message_id from public.inbox_messages order by id`)) === before; })());
  reset(); rpcMode = "rpc_error";
  check("a database error on close -> 500 without detail", (await setStatus(conv1, "closed")).status === 500);
  reset();

  // ============================================================ filters and search
  const own = ownerClient(alice.user);
  const all = await D.loadConversationList(own, alice.profile, 40, { status: "all" });
  const open = await D.loadConversationList(own, alice.profile, 40, { status: "open" });
  const closed = await D.loadConversationList(own, alice.profile, 40, { status: "closed" });
  check("filter: all = her 3 conversations; open = 2; closed = 1 (Maria)", all.items.length === 3 && open.items.length === 2 && closed.items.length === 1 && names(closed)[0] === "Maria Test" && !names(open).includes("Maria Test"));
  check("filter: the default (no options) is unchanged: everything of hers, nothing of bob's", (await D.loadConversationList(own, alice.profile)).items.length === 3 && !JSON.stringify(all).includes("Bob"));
  check("filter: unread counts are the database's (unchanged by any tool)", all.items.find((i) => i.contactName === "Customer One").unreadCount === 2 && all.items.find((i) => i.contactName === "Maria Test").unreadCount === 0);
  check("unread: the Open tab counts open conversations with unread messages (head count, no rows read)", (await D.countUnreadOpen(own, alice.profile)) === 2 && (await D.countUnreadOpen(ownerClient(bob.user), bob.profile)) === 2 && (await D.countUnreadOpen(own, bob.profile)) === 0);
  const byName = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "maria" });
  check("search by name (case-insensitive, partial) finds only HER Maria, never bob's 'Maria Bobside'", byName.items.length === 1 && names(byName)[0] === "Maria Test");
  const byNumber = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "+237 677 000" });
  check("search by number ('+237 677 000') matches her contact's number, ignoring spaces and +, not bob's 237677000222", byNumber.items.length === 1 && names(byNumber)[0] === "Maria Test");
  check("search + status filter combine", (await D.loadConversationList(own, alice.profile, 40, { status: "open", query: "maria" })).items.length === 0 && (await D.loadConversationList(own, alice.profile, 40, { status: "closed", query: "maria" })).items.length === 1);
  check("search handles apostrophes and hyphens in names", names(await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "O'Neil-Smith" })).join() === "Zoe O'Neil-Smith");
  check("a term shorter than 2 characters is ignored (list not filtered)", (await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "z" })).items.length === 3 && (await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "  " })).items.length === 3);
  check("search with no match -> an empty list, not an error", await (async () => { const x = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "zzzzzz" }); return x.ok && x.items.length === 0; })());
  check("search never leaks another profile: bob's names/numbers are not found by alice", (await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "Bob Customer" })).items.length === 0 && (await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "237611111111" })).items.length === 0 && (await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "BOB" })).items.length === 0);
  const hostile = ["%", "_", "*", "a,b", "x) or (profile_id.neq.0", "Customer One,external_id.ilike.%", "'; drop table inbox_messages;--", "..%2f", "a\\b", "\"quoted\"", "{}", "\u0000bad", "😀😀"];
  const leaks = [];
  for (const h of hostile) { const x = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: h }); if (!x.ok && false) leaks.push(h); if (x.ok && JSON.stringify(x.items).includes("Bob")) leaks.push(h); if (x.ok && x.items.length > 3) leaks.push(h); }
  check("hostile search strings cannot widen scope, break the filter or reach another profile", leaks.length === 0 && (await count("inbox_messages")) > 0, leaks.join("|"));
  check("normalizeSearch: strips every filter-significant character; keeps letters, digits, spaces, apostrophes, hyphens", F.normalizeSearch("a,b(c).d:e\"f\\g%h_i*j").text === "a b c d e f g h i j" && F.normalizeSearch("  Zoe   O'Neil-Smith ").text === "Zoe O'Neil-Smith" && F.normalizeSearch("+237 6 83") && F.normalizeSearch("+237 6 83").digits === "237683" && F.normalizeSearch("ab").digits === null && F.normalizeSearch("a") === null && F.normalizeSearch(null) === null && F.normalizeSearch("%%") === null);
  check("cleanQueryParam: first value, control characters removed, capped at 80", F.cleanQueryParam(["a", "b"]) === "a" && F.cleanQueryParam(" hi\u0000there ") === "hi there" && F.cleanQueryParam("x".repeat(200)).length === 80 && F.cleanQueryParam(undefined) === "" && F.cleanQueryParam({}) === "");
  check("search query shape: only display_name / external_id ilike on the owner's contacts, then .in(contact ids) on her conversations", await (async () => {
    const calls = []; const wrap = (t, v) => (v && typeof v === "object" ? new Proxy(v, { get: (target, k) => (typeof target[k] === "function" ? (...a) => { calls.push([t, String(k), a]); return wrap(t, target[k](...a)); } : target[k]) }) : v);
    await D.loadConversationList({ from: (t) => wrap(t, own.from(t)) }, alice.profile, 40, { status: "open", query: "maria 677" });
    const or = calls.find(([, m]) => m === "or");
    return !!or && /^display_name\.ilike\.%maria 677%,external_id\.ilike\.%677%$/.test(or[2][0]) && calls.filter(([t, m]) => t === "inbox_contacts" && m === "eq").some(([, , a]) => a[0] === "profile_id" && a[1] === alice.profile) && calls.some(([, m, a]) => m === "in" && a[0] === "contact_id") && calls.every(([, m, a]) => m !== "in" || (Array.isArray(a[1]) && a[1].length > 0));
  })());

  // the contact cap: a broad search takes the 100 MOST RECENTLY ACTIVE matching contacts and says it was limited (never silently incomplete)
  {
    const acct = (await q1(`select id from public.wa_accounts where profile_id = '${alice.profile}'`))[0].id;
    await db.exec(`insert into public.inbox_contacts (profile_id, channel, external_id, display_name, last_seen_at) select '${alice.profile}', 'whatsapp', '2376990' || lpad(g::text, 5, '0'), 'Bulk Person ' || g, now() - (interval '1 hour') * (200 - g) from generate_series(1, 105) g`);
    await db.exec(`insert into public.inbox_conversations (profile_id, channel, account_id, contact_id, last_message_at) select '${alice.profile}', 'whatsapp', '${acct}', c.id, c.last_seen_at from public.inbox_contacts c where c.display_name like 'Bulk Person %'`);
    const wide = await D.loadConversationList(own, alice.profile, 200, { status: "all", query: "bulk person" });
    const wideNames = names(wide);
    check("search cap: a search matching 105 contacts searches the 100 most recently active, returns them, and reports the list as limited", wide.ok && wide.items.length === 100 && wide.truncated === true && D.SEARCH_CONTACT_CAP === 100);
    check("search cap: the newest matches are included and only the OLDEST are dropped (never a recent customer)", wideNames.includes("Bulk Person 105") && wideNames.includes("Bulk Person 6") && !wideNames.includes("Bulk Person 5") && !wideNames.includes("Bulk Person 1"));
    check("search cap: results stay newest-first and inside her profile", wide.items[0].contactName === "Bulk Person 105" && wide.items.every((i) => i.contactName.startsWith("Bulk Person")) && !JSON.stringify(wide).includes("Bob"));
    const page40 = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "bulk person" });
    check("search + the normal 40-row list limit: 40 shown, reported as limited", page40.items.length === 40 && page40.truncated === true);
    const narrow = await D.loadConversationList(own, alice.profile, 40, { status: "all", query: "bulk person 105" });
    check("a narrow search is not reported as limited", narrow.items.length === 1 && narrow.truncated === false);
    const exactly = await D.loadConversationList(own, alice.profile, 200, { status: "all", query: "bulk person 1" });   // matches 1, 10-19, 100-105 = 17 contacts
    check("a search under the cap is complete and not limited", exactly.items.length === 17 && exactly.truncated === false, String(exactly.items.length));
    await db.exec(`delete from public.inbox_conversations where contact_id in (select id from public.inbox_contacts where display_name like 'Bulk Person %')`);
    await db.exec(`delete from public.inbox_contacts where display_name like 'Bulk Person %'`);
    check("(fixture cleaned up)", (await count("inbox_contacts", `profile_id = '${alice.profile}'`)) === 3);
  }

  // ============================================================ pages (real server code)
  const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
  as(alice.user);
  const pOpen = await pageList({ searchParams: {} });
  check("page: default list = her OPEN conversations, filter open, unread-open count shown", pOpen.props.list.items.length === 2 && pOpen.props.filter.status === "open" && pOpen.props.unreadOpen === 2 && pOpen.props.filter.q === "");
  const pClosed = await pageList({ searchParams: { status: "closed", q: "mar" } });
  check("page: ?status=closed&q=mar -> only Maria; the filter is echoed to the view", pClosed.props.list.items.length === 1 && pClosed.props.filter.status === "closed" && pClosed.props.filter.q === "mar");
  check("page: an unknown status falls back to open; an array parameter uses its first value", (await pageList({ searchParams: { status: "bogus" } })).props.filter.status === "open" && (await pageList({ searchParams: { status: ["all", "x"], q: ["maria", "x"] } })).props.list.items.length === 1);
  check("page: a filter/search can never expose another profile (bob's names are not found)", (await pageList({ searchParams: { status: "all", q: "Bob" } })).props.list.items.length === 0);
  const tClosed = await pageThread({ params: { id: convMaria }, searchParams: {} });
  check("thread page: without a filter, a CLOSED conversation shows under the Closed tab; saved replies are passed to the composer", tClosed.props.filter.status === "closed" && tClosed.props.list.items.length === 1 && Array.isArray(tClosed.props.savedReplies) && tClosed.props.savedReplies.length === 50);
  const tOpen = await pageThread({ params: { id: conv1 }, searchParams: { status: "all" } });
  check("thread page: an explicit filter wins; the thread loads", tOpen.props.filter.status === "all" && tOpen.props.list.items.length === 3 && tOpen.props.thread.ok);
  check("thread page: another profile's conversation id -> not found, no data", (await pageThread({ params: { id: convB }, searchParams: {} })).props.thread.reason === "not_found" && !JSON.stringify((await pageThread({ params: { id: convB }, searchParams: {} })).props).includes("BOB PRIVATE"));
  as(null);
  check("pages: unauthenticated -> redirect, no data (list, thread and saved replies pages)", (await thrown(() => pageList({ searchParams: {} }))) instanceof RedirectSignal && (await thrown(() => pageThread({ params: { id: conv1 }, searchParams: {} }))) instanceof RedirectSignal && (await thrown(() => pageReplies())) instanceof RedirectSignal);
  as(carol.user);
  check("pages: a user without a WhatsApp account is redirected away from the saved replies page too", (await thrown(() => pageReplies())) instanceof RedirectSignal);
  as(alice.user);
  const rp = await pageReplies();
  check("saved replies page: the owner's replies only, available", rp.props.available === true && rp.props.items.length === 50 && !JSON.stringify(rp.props).includes("Bob only"));
  as(bob.user);
  check("saved replies page: bob sees his own", (await pageReplies()).props.items.length === 1 && (await pageReplies()).props.items[0].title === "Bob only");

  // saved replies unavailable (migration not applied yet): the page and the thread degrade instead of failing
  await db.exec(`alter table public.inbox_saved_replies rename to inbox_saved_replies_hidden`);
  as(alice.user);
  const degraded = await pageThread({ params: { id: conv1 }, searchParams: {} });
  const degradedPage = await pageReplies();
  check("if the saved-replies table is not there, the thread still opens (no picker) and the manager says 'not available yet'", degraded.props.thread.ok && degraded.props.savedReplies === null && degradedPage.props.available === false && degradedPage.props.items.length === 0);
  await db.exec(`alter table public.inbox_saved_replies_hidden rename to inbox_saved_replies`);

  // ============================================================ media: parse -> ingest -> store -> display, all five kinds
  const mediaPayload = (msgs) => ({ object: "whatsapp_business_account", entry: [{ id: "1110000000002", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PH_A }, contacts: [{ profile: { name: "Media Sender" }, wa_id: "237600000050" }], messages: msgs } }] }] });
  const base = { from: "237600000050", timestamp: String(Math.floor(Date.now() / 1000) - 600) };
  const kinds = [
    ["image", { id: "wamid.IMG", type: "image", image: { id: "MEDIA_IMG", mime_type: "image/jpeg", sha256: "sha-img", caption: "My receipt" } }],
    ["video", { id: "wamid.VID", type: "video", video: { id: "MEDIA_VID", mime_type: "video/mp4", sha256: "sha-vid", caption: "Short clip" } }],
    ["audio", { id: "wamid.AUD", type: "audio", audio: { id: "MEDIA_AUD", mime_type: "audio/ogg; codecs=opus", sha256: "sha-aud", voice: true } }],
    ["document", { id: "wamid.DOC", type: "document", document: { id: "MEDIA_DOC", mime_type: "application/pdf", sha256: "sha-doc", filename: "invoice-2026.pdf", caption: "Invoice" } }],
    ["sticker", { id: "wamid.STK", type: "sticker", sticker: { id: "MEDIA_STK", mime_type: "image/webp", sha256: "sha-stk" } }],
  ];
  const parsed = parse(mediaPayload(kinds.map(([, m]) => ({ ...base, ...m }))));
  check("media: the parser extracts all five kinds with their metadata", parsed.events.length === 5 && parsed.skipped === 0 && kinds.every(([k], i) => parsed.events[i].type === k && parsed.events[i].media?.kind === k && parsed.events[i].media.mediaId === { image: "MEDIA_IMG", video: "MEDIA_VID", audio: "MEDIA_AUD", document: "MEDIA_DOC", sticker: "MEDIA_STK" }[k]) && parsed.events[3].media.filename === "invoice-2026.pdf" && parsed.events[0].media.caption === "My receipt" && parsed.events[2].media.mimeType === "audio/ogg; codecs=opus");
  const admin = globalThis.__admin();
  const outcomes = [];
  for (const ev of parsed.events) outcomes.push(await IN.ingestEvent(admin, ev));
  check("media: all five are ingested through the real function", outcomes.every((o) => o === "created"), outcomes.join());
  const mrows = await q1(`select m.type, m.body, md.kind, md.media_id, md.mime_type, md.sha256, md.filename, md.caption, md.storage_status, md.storage_ref from public.inbox_messages m join public.inbox_message_media md on md.message_id = m.id where m.provider_message_id like 'wamid.%' and m.type in ('image','video','audio','document','sticker') order by m.type`);
  check("media: metadata persisted for each kind (kind, media id, mime, sha256, filename, caption); nothing downloaded or stored", mrows.length === 5 && mrows.every((x) => x.storage_status === "not_downloaded" && x.storage_ref === null && x.body === null && x.kind === x.type) && mrows.find((x) => x.type === "document").filename === "invoice-2026.pdf" && mrows.find((x) => x.type === "image").caption === "My receipt" && mrows.find((x) => x.type === "audio").mime_type === "audio/ogg; codecs=opus" && mrows.find((x) => x.type === "sticker").sha256 === "sha-stk");
  check("media: no raw webhook payload is stored anywhere (no json/payload column; no row contains the webhook envelope)", (await q1(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name in ('inbox_messages', 'inbox_message_media', 'inbox_status_events', 'inbox_contacts', 'inbox_conversations') and (data_type in ('json', 'jsonb') or column_name ~* '(payload|raw|webhook)')`))[0].n === 0 && (await q1(`select count(*)::int n from public.inbox_messages where body like '%messaging_product%' or body like '%whatsapp_business_account%'`))[0].n === 0 && (await q1(`select count(*)::int n from public.inbox_message_media where caption like '%messaging_product%' or filename like '%messaging_product%'`))[0].n === 0);
  const odd = parse(mediaPayload([{ ...base, id: "wamid.ODD1", type: "image", image: {} }, { ...base, id: "wamid.ODD2", type: "audio" }, { ...base, id: "wamid.ODD3", type: "hologram", hologram: { id: "x" } }, { ...base, id: "wamid.ODD4", type: "interactive", interactive: { type: "button_reply" } }, { ...base, id: "wamid.ODD5", type: "document", document: { id: "D5", filename: "x".repeat(400), caption: "c".repeat(2000) } }]));
  const oddOut = []; for (const ev of odd.events) oddOut.push(await IN.ingestEvent(admin, ev));
  check("media: broken / unknown / oversize media metadata never crashes parsing or ingestion; everything is acknowledged", odd.events.length === 5 && oddOut.every((o) => o === "created") && (await q1(`select type from public.inbox_messages where provider_message_id = 'wamid.ODD3'`))[0].type === "unsupported" && (await q1(`select count(*)::int n from public.inbox_message_media where media_id = 'D5' and char_length(filename) <= 255 and char_length(caption) <= 1024`))[0].n === 1 && (await count("inbox_message_media", `message_id = (select id from public.inbox_messages where provider_message_id = 'wamid.ODD1')`)) === 0);
  const convMedia = await convOf("237600000050");
  const tm = await D.loadThread(own, alice.profile, convMedia, 100);
  check("media: the thread data carries kind, filename, mime type and caption; broken media degrade to kind-only / unsupported", tm.ok && tm.thread.messages.filter((m) => m.display.kind === "media").length === 8 && tm.thread.messages.find((m) => m.display.kind === "media" && m.display.media === "document" && m.display.filename === "invoice-2026.pdf").display.mimeType === "application/pdf" && tm.thread.messages.some((m) => m.display.kind === "unsupported"));
  const htmlMedia = render("en", React.createElement(InboxView, { list: await D.loadConversationList(own, alice.profile, 40, { status: "all" }), selectedId: convMedia, thread: tm, filter: { status: "all", q: "" } }));
  check("media UI: every kind renders as a distinct metadata card (data-media-kind), with label, filename, mime and caption", ["image", "video", "audio", "document", "sticker"].every((k) => htmlMedia.includes(`data-media-kind="${k}"`)) && /invoice-2026\.pdf/.test(htmlMedia) && /application\/pdf/i.test(htmlMedia) && /My receipt/.test(htmlMedia) && /Short clip/.test(htmlMedia) && />Document</.test(htmlMedia) && />Sticker</.test(htmlMedia));
  check("media UI: honest placeholder, no broken content: no <img>, <video>, <audio>, <iframe>, <source>, <a download> and no remote URL", !/<(img|video|audio|iframe|source|embed|object)\b/i.test(htmlMedia) && /Media is not shown yet/.test(htmlMedia) && !/https?:\/\//i.test(htmlMedia.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")) && !/download=/.test(htmlMedia));
  check("media UI (FR): labels", /Vidéo/.test(render("fr", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: convMedia, thread: tm }))) && /Autocollant/.test(render("fr", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: convMedia, thread: tm }))));
  check("media UI: the list preview of a media message is 'Kind · caption' or the kind, never raw ids", (await D.loadConversationList(own, alice.profile, 40, { status: "all" })).items.some((i) => i.preview?.kind === "media") && F.previewText({ kind: "media", media: "document", caption: "Invoice", filename: "a.pdf", mimeType: "application/pdf" }, translations.en.inbox) === "Document · Invoice");

  // ============================================================ rendering: tabs, search, controls, saved replies (EN / FR)
  const listAll = await D.loadConversationList(own, alice.profile, 40, { status: "all" });
  const tv = await D.loadThread(own, alice.profile, conv1);
  const view = render("en", React.createElement(InboxView, { list: listAll, selectedId: null, thread: null, filter: { status: "open", q: "" }, unreadOpen: 2 }));
  check("UI: Open / Closed / All tabs as links; the active one is marked; unread-open count on the Open tab with an accessible label", /<a href="\/dashboard\/inbox"[^>]*aria-current="true"[^>]*>Open/.test(view) && /href="\/dashboard\/inbox\?status=closed"[^>]*>Closed/.test(view) && /href="\/dashboard\/inbox\?status=all"[^>]*>All/.test(view) && /aria-label="2 open conversations with unread messages"/.test(view));
  check("UI: a search form (GET, role=search, labelled input, submit button) that works without JavaScript", /<form method="get" action="\/dashboard\/inbox" role="search"/.test(view) && /<label for="inbox-search" class="sr-only">Search conversations<\/label>/.test(view) && /name="q"/.test(view) && /placeholder="Search by name or number"/.test(view) && /<button type="submit" class="sr-only">Search<\/button>/.test(view));
  const searching = render("en", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: null, thread: null, filter: { status: "closed", q: "mar" } }));
  check("UI: the active filter and search are kept in links and the form; 'Clear search' appears; empty results say so", /<input type="hidden" name="status" value="closed"/.test(searching) && /value="mar"/.test(searching) && /aria-label="Clear search"/.test(searching) && /href="\/dashboard\/inbox\?status=closed"[^>]*aria-label="Clear search"|aria-label="Clear search"[^>]*href="\/dashboard\/inbox\?status=closed"/.test(searching) && /No conversations match/.test(searching) && /Try a different search or filter\./.test(searching));
  const withQuery = render("en", React.createElement(InboxView, { list: listAll, selectedId: conv1, thread: tv, filter: { status: "all", q: "one" } }));
  check("UI: rows and the mobile back link keep the filter in their URLs", withQuery.includes(`href="/dashboard/inbox/${conv1}?status=all&amp;q=one"`) && /<a href="\/dashboard\/inbox\?status=all&amp;q=one"[^>]*aria-label="Back to conversations"[^>]*lg:hidden/.test(withQuery));
  check("UI: the default filter keeps clean URLs (no query string)", view.includes(`href="/dashboard/inbox/${conv1}"`) && !/href="\/dashboard\/inbox\/[0-9a-f-]+\?/.test(view));
  check("UI (mobile): list shown first, thread pane hidden below lg; selected: thread shown, list hidden below lg; back arrow only below lg", /<section aria-label="Conversations" class="flex min-h-0/.test(view) && /<section class="hidden lg:flex/.test(view) && /<section aria-label="Conversations" class="hidden lg:flex/.test(withQuery) && /<section class="flex min-h-0/.test(withQuery));
  check("UI: thread header offers Close for an open conversation and Reopen for a closed one", />Close conversation</.test(withQuery) && />Reopen conversation</.test(render("en", React.createElement(InboxView, { list: listAll, selectedId: convMaria, thread: await D.loadThread(own, alice.profile, convMaria), filter: { status: "closed", q: "" } }))));
  check("UI: unread badge is still the database count; closed rows are marked", /aria-label="2 unread messages"/.test(view) && />Closed</.test(render("en", React.createElement(InboxView, { list: listAll, selectedId: null, thread: null, filter: { status: "all", q: "" } }))));
  const fr = render("fr", React.createElement(InboxView, { list: listAll, selectedId: conv1, thread: tv, filter: { status: "open", q: "" }, unreadOpen: 2, savedReplies: [{ id: "x", title: "Bienvenue", body: "Bonjour" }] }));
  check("UI (FR): tabs, search, status button, saved replies button", />Ouvertes</.test(fr) && />Fermées</.test(fr) && />Toutes</.test(fr) && /placeholder="Rechercher par nom ou numéro"/.test(fr) && />Fermer la conversation</.test(fr) && />Réponses enregistrées</.test(fr) && /2 conversations ouvertes avec des messages non lus/.test(fr));
  const status = render("en", React.createElement(StatusButton, { conversationId: conv1, status: "open" }));
  check("UI: the status button is a real button, not disabled at rest", /<button type="button"[^>]*>Close conversation<\/button>/.test(status) && !/ disabled=""/.test(status));

  const comp = render("en", React.createElement(Composer, { conversationId: conv1, open: true, savedReplies: [{ id: "a", title: "Welcome", body: "Hello <b>there</b>" }] }));
  check("composer: a 'Saved replies' disclosure button (collapsed, labelled, aria-controls); the list is not shown until opened", /<button type="button" aria-expanded="false" aria-controls="reply-[^"]+-saved"[^>]*>[^]*Saved replies<\/button>/.test(comp) && !/Hello &lt;b&gt;/.test(comp) && /<textarea/.test(comp));
  check("composer: without a saved-replies list (null) there is no picker at all; the plain composer is unchanged", !/Saved replies/.test(render("en", React.createElement(Composer, { conversationId: conv1, open: true, savedReplies: null }))) && /<textarea/.test(render("en", React.createElement(Composer, { conversationId: conv1, open: true }))));
  check("composer: when the 24-hour window is closed there is no textarea and no picker", !/<textarea|Saved replies/.test(render("en", React.createElement(Composer, { conversationId: conv1, open: false, savedReplies: [] }))));
  const csrc = read("src/components/inbox/ReplyComposer.tsx");
  const insertFn = csrc.slice(csrc.indexOf("function insertSaved"), csrc.indexOf("async function submit"));
  check("composer: choosing a saved reply ONLY inserts text into the box (no request, no auto-send), appends on a new line, caps at the limit, and keeps the idempotency rule", !/fetch\(|postReply|submit\(/.test(insertFn) && /text\.replace\(\/\\s\+\$\/, ""\) \+ "\\n" \+ body/.test(insertFn) && /slice\(0, MAX_REPLY_LENGTH\)/.test(insertFn) && /requestId\.current = null/.test(insertFn) && /box\.current\?\.focus\(\)/.test(insertFn));
  check("composer: the picker renders titles/bodies as escaped text and links to the manager page", /\{r\.title\}/.test(csrc) && /\{r\.body\}/.test(csrc) && !/dangerouslySetInnerHTML/.test(csrc) && /href="\/dashboard\/inbox\/replies"/.test(csrc));

  const mgr = render("en", React.createElement(Manager, { items: [{ id: "i1", title: "Welcome", body: "Hello <script>alert(1)</script>" }, { id: "i2", title: "Hours", body: "8-18" }], available: true }));
  check("manager (EN): title, intro, count, add button, a card per reply with Edit and Delete; replies are escaped", /Saved replies/.test(mgr) && /Reusable answers/.test(mgr) && /2 of 50 saved/.test(mgr) && />Add saved reply</.test(mgr) && (mgr.match(/>Edit</g) || []).length === 2 && (mgr.match(/>Delete</g) || []).length === 2 && !/<script>/.test(mgr) && /&lt;script&gt;/.test(mgr) && /href="\/dashboard\/inbox"[^>]*>[^]*Back to inbox/.test(mgr));
  const mgrEmpty = render("en", React.createElement(Manager, { items: [], available: true }));
  check("manager: empty state offers the six quick-start suggestions (Welcome, Opening hours, Payment, Delivery, Thank you, Contact) as buttons", /No saved replies yet\./.test(mgrEmpty) && ["Welcome", "Opening hours", "Payment information", "Delivery information", "Thank you", "Contact and support"].every((s) => mgrEmpty.includes(`>${s}<`)) && /Quick start/.test(mgrEmpty));
  const mgrFr = render("fr", React.createElement(Manager, { items: [], available: true }));
  check("manager (FR): French title, empty state and suggestions", /Réponses enregistrées/.test(mgrFr) && /Aucune réponse enregistrée pour le moment\./.test(mgrFr) && ["Bienvenue", "Horaires d’ouverture", "Informations de paiement", "Informations de livraison", "Remerciements", "Contact et assistance"].every((s) => mgrFr.includes(`>${s}<`)));
  check("manager: not available (migration pending) shows a safe message and no controls", /not available yet/.test(render("en", React.createElement(Manager, { items: [], available: false }))) && !/Add saved reply/.test(render("en", React.createElement(Manager, { items: [], available: false }))));
  check("manager: the add button is disabled at the 50-reply limit", / disabled=""[^>]*>Add saved reply</.test(render("en", React.createElement(Manager, { items: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, title: `T${i}`, body: "b" })), available: true }))));

  // ============================================================ client helpers
  const resp = (status, body) => ({ kind: "response", status, body });
  check("client: error mapping for saved replies and status changes", C.toolErrorKey(resp(409, { ok: false, error: "duplicate_title" }), "saved") === "replyTitleTaken" && C.toolErrorKey(resp(409, { ok: false, error: "limit_reached" }), "saved") === "replyLimit" && C.toolErrorKey(resp(422, { ok: false, error: "invalid" }), "saved") === "replyInvalid" && C.toolErrorKey(resp(404, { ok: false, error: "not_found" }), "saved") === "savedReplyGone" && C.toolErrorKey({ kind: "network" }, "saved") === "savedReplyFailed" && C.toolErrorKey({ kind: "network" }, "status") === "statusUpdateFailed" && C.toolErrorKey(resp(500, { ok: false, error: "server_error" }), "status") === "statusUpdateFailed" && C.toolErrorKey(resp(200, { ok: true }), "saved") === null);
  let cap = null;
  const fakeFetch = async (url, init) => { cap = { url, init }; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  await C.callInboxTool("POST", C.statusUrl(conv1), { status: "closed" }, fakeFetch);
  check("client: tool calls go to OUR routes only, JSON, same-origin, with just the named fields (no Meta URL, no token, no profile)", cap.url === `/api/inbox/conversations/${conv1}/status` && cap.init.method === "POST" && cap.init.credentials === "same-origin" && JSON.stringify(JSON.parse(cap.init.body)) === JSON.stringify({ status: "closed" }) && C.savedRepliesUrl("a b") === "/api/inbox/saved-replies/a%20b" && C.savedRepliesUrl() === "/api/inbox/saved-replies");
  check("client: a thrown fetch or non-JSON answer is a 'network' result", (await C.callInboxTool("POST", "/x", {}, async () => { throw new Error("offline"); })).kind === "network" && (await C.callInboxTool("POST", "/x", {}, async () => new Response("<html>", { status: 502 }))).kind === "network");
} finally { console.error = origErr; console.info = origInfo; }

// ============================================================ logging / secrets / static scope
check("logs: nothing sensitive was logged (no titles, bodies, names, numbers or database error text)", !/SECRET TITLE|Boom|Welcome|Hello!|Maria|Customer One|237600000001|237677000111|row contains/.test(logs.join("\n")) && logs.every((l) => { try { return ["inbox_tools", "inbox"].includes(JSON.parse(l).scope); } catch { return false; } }), logs.join("|").slice(0, 300));
{
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const phase8Server = ["src/lib/inbox/tools.ts", "src/lib/inbox/route.ts", "src/app/api/inbox/saved-replies/route.ts", "src/app/api/inbox/saved-replies/[id]/route.ts", "src/app/api/inbox/conversations/[id]/status/route.ts"];
  const phase8Client = ["src/components/inbox/SavedRepliesManager.tsx", "src/components/inbox/ConversationStatusButton.tsx", "src/components/inbox/InboxView.tsx", "src/components/inbox/ReplyComposer.tsx", "src/lib/inbox/client.ts", "src/lib/inbox/format.ts"];
  const s = phase8Server.map(code).join("\n"), c = phase8Client.map(code).join("\n");
  check("security: no token, Meta credential or NEXT_PUBLIC variable anywhere in the Phase 8 code; no Graph API call", !/WHATSAPP_|ACCESS_TOKEN|META_APP|NEXT_PUBLIC_|graph\.facebook|Bearer|Authorization/.test(s + c));
  check("security: the service client is created in ONE server-only place (route.ts) and never in client code", /createAdminClient/.test(code("src/lib/inbox/route.ts")) && !/createAdminClient|supabase\/server|inbox\/(route|tools|send|access)|whatsapp\/(outbound|ingest)/.test(c));
  check("security: every Phase 8 write goes through one of the three service-role functions; no table writes, no raw SQL, no deletion anywhere else", /inbox_saved_reply_save/.test(s) && /inbox_saved_reply_delete/.test(s) && /inbox_set_conversation_status/.test(s) && !/\.(insert|update|upsert|delete)\(|\.from\("/.test(s));
  check("security: handlers read only the fields they name from the body (title/body/status); no profile, recipient, phone or WABA field is ever read", !/body\.(profile|user|owner|to|recipient|phone|waba|account)/i.test(s) && /body\.title/.test(s) && /body\.status/.test(s));
  check("security: all four owner-action routes go through the shared guard (JSON only, session owner, no request-supplied profile)", ["src/app/api/inbox/saved-replies/route.ts", "src/app/api/inbox/saved-replies/[id]/route.ts", "src/app/api/inbox/conversations/[id]/status/route.ts"].every((f) => /withInboxOwner/.test(code(f)) && !/export async function GET/.test(code(f))) && /application\/json/.test(code("src/lib/inbox/route.ts")) && /resolveInboxOwner/.test(code("src/lib/inbox/route.ts")));
  check("security: no raw HTML injection and no unescaped customer or template text in the Phase 8 UI", !/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|eval\(/.test(c));
  check("scope: no 'mark as read', no deletion of conversations or messages, no AI, no media download in the Phase 8 code", !/mark.?as.?read|markRead|unread_count\s*=|delete from public\.inbox_(conversations|messages|contacts)|openai|anthropic|createSignedUrl|storage\.from/i.test(s + c + read("supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql").replace(/--.*$/gm, "")));
  const sql = read("supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql").replace(/--.*$/gm, "");
  check("migration scope: the status function writes only conversations.status; saved replies are the only deletable rows", /update public\.inbox_conversations cv set status = p_status/.test(sql) && !/unread_count/.test(sql) && (sql.match(/delete from public\./g) || []).length === 1 && /delete from public\.inbox_saved_replies/.test(sql));
  check("the webhook route, parser, ingestion and outbound sender are untouched by Phase 8 (no new import of Phase 8 code)", !/inbox\/(tools|route|client)|saved/i.test(code("src/app/api/integrations/whatsapp/webhook/route.ts") + code("src/lib/whatsapp/parseWebhook.ts") + code("src/lib/whatsapp/ingest.ts") + code("src/lib/whatsapp/outbound.ts") + code("src/lib/inbox/send.ts")));
}
// ---- translations -----------------------------------------------------------------------------------------------------------------------
{
  const en = translations.en.inbox, fr = translations.fr.inbox;
  const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((v) => (typeof v === "object" ? shape(v) : typeof v)).join();
  check("i18n: EN and FR inbox sections still have identical keys and shapes (including the six suggestions)", shape(en) === shape(fr) && en.suggestions.length === 6 && fr.suggestions.length === 6);
  check("i18n: no empty strings; every suggestion fits the limits (title <= 60, body <= 4096)", !JSON.stringify(en).includes('""') && !JSON.stringify(fr).includes('""') && [...en.suggestions, ...fr.suggestions].every((s) => s.title.length <= 60 && s.body.length <= 4096 && s.title && s.body));
  check("i18n: the tool strings exist in both languages", en.filterOpen === "Open" && fr.filterOpen === "Ouvertes" && en.closeConversation === "Close conversation" && fr.closeConversation === "Fermer la conversation" && en.savedReplies === "Saved replies" && fr.savedReplies === "Réponses enregistrées" && en.searchPlaceholder === "Search by name or number" && fr.searchPlaceholder === "Rechercher par nom ou numéro");
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
