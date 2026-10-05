// Staff Inbox roles, APPLICATION layer end to end: the REAL routes (reply, media, close/reopen, mark read, saved replies), the REAL staff-aware guards
// (src/lib/inbox/actor.ts, actorRoute.ts), the REAL pages and the REAL components (EN and FR) on top of the REAL migrations in scratch in-memory PostgreSQL
// (PGlite). Meta is replaced by an in-process fake (no network); every id, number and name is synthetic. Ringo AI for staff is covered in
// whatsappInboxAi.test.mjs (routes) and here only for the guard's wiring.
//   Run:  node scripts/tests/whatsappInboxStaffRoutes.test.mjs
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
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);

// ---- TS/TSX loader with stand-ins for the framework modules ----------------------------------------------------------------------------------
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
class RedirectSignal extends Error { constructor(url) { super("REDIRECT"); this.url = url; } }
class NotFoundSignal extends Error { constructor() { super("NOT_FOUND"); } }
const activity = [];
globalThis.__cookie = null;
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: (url) => { throw new RedirectSignal(url); }, notFound: () => { throw new NotFoundSignal(); }, useRouter: () => ({ refresh() {} }) },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => globalThis.__sb(), createAdminClient: () => globalThis.__admin() },
  // the active-organization cookie is a UX hint only: the tests drive it directly to prove it never grants anything
  "@/lib/team/access": { getActiveOrgCookie: () => globalThis.__cookie },
  "@/lib/team/activity": { logOrgActivity: async (e) => { activity.push(e); } },
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
const routes = {
  messages: src("app/api/inbox/conversations/[id]/messages/route.ts"),
  media: src("app/api/inbox/conversations/[id]/media/route.ts"),
  status: src("app/api/inbox/conversations/[id]/status/route.ts"),
  readRoute: src("app/api/inbox/conversations/[id]/read/route.ts"),
  create: src("app/api/inbox/saved-replies/route.ts"),
  item: src("app/api/inbox/saved-replies/[id]/route.ts"),
  settings: src("app/api/inbox/settings/route.ts"),
};
const AR = src("lib/inbox/actorRoute.ts");
const ACT = src("lib/inbox/actor.ts");
const pageList = src("app/dashboard/inbox/page.tsx").default;
const pageThread = src("app/dashboard/inbox/[id]/page.tsx").default;
const pageReplies = src("app/dashboard/inbox/replies/page.tsx").default;
const layout = src("app/dashboard/inbox/layout.tsx").default;
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const Manager = src("components/inbox/SavedRepliesManager.tsx").default;
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

// ---- scratch database (same shape as whatsappInboxStaff.test.mjs) ----------------------------------------------------------------------------
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MID = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner1 = U(1), owner2 = U(2), full = U(3), viewer = U(4), replier = U(5), closer = U(6), inactive = U(7), removed = U(8), org2staff = U(9), stranger = U(10), freeOwner = U(11), freeStaff = U(12), savedOnly = U(13), dualOwner = U(14);
const prof1 = P(1), prof2 = P(2), profFree = P(3), profDual = P(4);

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key default gen_random_uuid(), name text, team_enabled boolean not null default false);
  create table public.users (id uuid primary key, email text not null, role text not null default 'user', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (true);
  create function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  create table public.bk_customers (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict, name text not null, unique (profile_id, id));
`);
await db.exec(read("supabase/migrations/2026-10-01_team_management.sql").split("\n").slice(27, 261).join("\n"));
await db.exec(read("supabase/migrations/2026-10-03_team_rls_enterprise_gate.sql"));
await db.exec(read("supabase/migrations/2026-10-04_team_members_read_fix.sql"));
const planBiz = "d0000000-0000-4000-8000-000000000001", planFree = "d0000000-0000-4000-8000-000000000002";
const allUsers = [owner1, owner2, full, viewer, replier, closer, inactive, removed, org2staff, stranger, freeOwner, freeStaff, savedOnly, dualOwner];
await db.exec(`
  insert into public.plans (id, name, team_enabled) values ('${planBiz}', 'business', true), ('${planFree}', 'free', false);
  insert into public.users (id, email, plan_id) values ${allUsers.map((u) => `('${u}', '${u}@x.test', '${planFree}')`).join(", ")};
  update public.users set plan_id = '${planBiz}' where id in ('${owner1}', '${owner2}', '${dualOwner}');
  insert into public.profiles values ('${prof1}','${owner1}','owner1','Owner One Biz'), ('${prof2}','${owner2}','owner2',null), ('${profFree}','${freeOwner}','freeowner',null), ('${profDual}','${dualOwner}','dualowner',null);
  insert into public.profiles (id, user_id, username, name) values ('a0000000-0000-4000-8000-0000000000f1','${full}','fullstaff','Fatou Full'), ('a0000000-0000-4000-8000-0000000000f2','${closer}','closerstaff',null), ('a0000000-0000-4000-8000-0000000000f3','${replier}','replierstaff','Rita Replier');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-12_whatsapp_inbox_mark_read", "2026-12-13_whatsapp_inbox_team_permission_guard", "2026-12-14_whatsapp_inbox_staff"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;
  revoke all on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events, public.inbox_saved_replies, public.inbox_settings, public.inbox_conversation_state from anon, authenticated, service_role;
  grant select on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events, public.inbox_saved_replies, public.inbox_settings, public.inbox_conversation_state to authenticated, service_role;`);
const PH1 = "1110000000001", PH2 = "9990000000001", PH3 = "7770000000001", PH4 = "5550000000001";
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${prof1}', '${PH1}', '1110000000002'), ('${prof2}', '${PH2}', '9990000000002'), ('${profFree}', '${PH3}', '7770000000002'), ('${profDual}', '${PH4}', '5550000000002')`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', ${sq(o.text ?? "hi")}, ${sq(o.name)}, null, null, null, null, null, null, null)`);
await ingest({ phone: PH1, id: "wamid.A1", from: "237600000001", ts: hoursAgo(1), name: "Customer One", text: "Hello org one" });
await ingest({ phone: PH1, id: "wamid.A2", from: "237600000002", ts: hoursAgo(2), name: "Customer Two", text: "Second" });
await ingest({ phone: PH1, id: "wamid.A3", from: "237600000003", ts: hoursAgo(1), name: "Customer Three", text: "Third" });
await ingest({ phone: PH2, id: "wamid.B1", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer", text: "ORG TWO PRIVATE" });
await ingest({ phone: PH3, id: "wamid.F1", from: "237622222222", ts: hoursAgo(1), name: "Free Customer", text: "free org" });
await ingest({ phone: PH4, id: "wamid.D1", from: "237633333333", ts: hoursAgo(1), name: "Dual Customer", text: "dual org" });
const q1 = async (sql) => (await db.query(sql)).rows;
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), conv3 = await convOf("237600000003"), convB = await convOf("237611111111"), convF = await convOf("237622222222"), convD = await convOf("237633333333");

const R = { full: RID(1), viewer: RID(2), reply: RID(3), closer: RID(4), saved: RID(5), org2: RID(6), none: RID(7) };
const role = (id, prof, key, perms) => `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${id}','${prof}','${key}','${key}','{${perms}}')`;
const ALL = "inbox.view,inbox.reply,inbox.media,inbox.saved_replies,inbox.ai,inbox.mark_read,inbox.close";
await db.exec([role(R.full, prof1, "full", ALL), role(R.viewer, prof1, "viewer", "inbox.view"), role(R.reply, prof1, "reply", "inbox.view,inbox.reply,inbox.saved_replies"), role(R.closer, prof1, "closer", "inbox.view,inbox.close,inbox.mark_read"),
  role(R.saved, prof1, "saved", "inbox.view,inbox.saved_replies"), role(R.org2, prof2, "org2", ALL), role(R.none, profFree, "freefull", ALL)].join("; "));
const member = (id, prof, user, roleId, status = "active") => `insert into public.organization_members (id, profile_id, user_id, role_id, status) values ('${id}','${prof}','${user}','${roleId}','${status}')`;
await db.exec([member(MID(1), prof1, full, R.full), member(MID(2), prof1, viewer, R.viewer), member(MID(3), prof1, replier, R.reply), member(MID(4), prof1, closer, R.closer), member(MID(5), prof1, inactive, R.full, "inactive"),
  member(MID(6), prof1, removed, R.full, "removed"), member(MID(7), prof2, org2staff, R.org2), member(MID(8), profFree, freeStaff, R.none), member(MID(9), prof1, savedOnly, R.saved),
  // a person who OWNS an Inbox of their own AND is staff in organization 1 (dual role)
  member(MID(10), prof1, dualOwner, R.viewer)].join("; "));

// ---- stand-ins: session client (RLS as the signed-in user), service client (rpc -> real functions as service_role), Meta (fake fetch), requests ------
const mkClient = makeClientFactory(db);
globalThis.__user = null;
globalThis.__sb = () => {
  const c = mkClient(globalThis.__user ? "authenticated" : "anon", () => globalThis.__user);
  return { auth: { getUser: async () => ({ data: { user: globalThis.__user ? { id: globalThis.__user } : null } }) }, from: (t) => c.from(t) };
};
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
let rpcCalls = [];
globalThis.__admin = () => {
  const svc = mkClient("service_role", () => null);
  return {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      const named = Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ");
      try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
    },
    from: (t) => svc.from(t),
  };
};
const logs = []; const origErr = console.error;
console.error = (...a) => logs.push(a.join(" "));
const TOKEN = "TEST_TOKEN_NOT_REAL";
process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
let metaCalls = [];
let wamidSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  metaCalls.push({ url: String(url), init });
  if (/\/media$/.test(String(url))) return new Response(JSON.stringify({ id: "MEDIA_ID_1" }), { status: 200 });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT.${++wamidSeq}` }] }), { status: 200 });
};
const as = (u) => { globalThis.__user = u; };
const reset = () => { rpcCalls = []; metaCalls = []; activity.length = 0; globalThis.__cookie = null; };
const call = async (handler, url, method, body, { user = full, contentType = "application/json", raw, params } = {}) => {
  as(user);
  const res = await handler(new Request(`http://localhost${url}`, { method, headers: contentType ? { "content-type": contentType } : {}, body: method === "GET" ? undefined : raw !== undefined ? raw : JSON.stringify(body ?? {}) }), { params });
  return { status: res.status, body: await res.json() };
};
const reply = (conv, rq, o = {}, extra = {}) => call(routes.messages.POST, `/api/inbox/conversations/${conv}/messages`, "POST", { text: "Staff reply text", client_request_id: rq, ...extra }, { ...o, params: { id: conv } });
const setStatus = (conv, status, o) => call(routes.status.POST, `/api/inbox/conversations/${conv}/status`, "POST", { status }, { ...o, params: { id: conv } });
const markRead = (conv, o) => call(routes.readRoute.POST, `/api/inbox/conversations/${conv}/read`, "POST", {}, { ...o, params: { id: conv } });
const createReply = (title, body, o) => call(routes.create.POST, "/api/inbox/saved-replies", "POST", { title, body }, o);
const updateReply = (id, title, body, o) => call(routes.item.PATCH, `/api/inbox/saved-replies/${id}`, "PATCH", { title, body }, { ...o, params: { id } });
const deleteReply = (id, o) => call(routes.item.DELETE, `/api/inbox/saved-replies/${id}`, "DELETE", {}, { ...o, params: { id } });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const sendMedia = async (conv, rq, user, extra = {}) => {
  as(user);
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "pic.png");
  form.append("client_request_id", rq);
  form.append("caption", "A caption");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const res = await routes.media.POST(new Request(`http://localhost/api/inbox/conversations/${conv}/media`, { method: "POST", headers: { "x-ringo-upload": "1" }, body: form }), { params: { id: conv } });
  return { status: res.status, body: await res.json() };
};
const msg = async (rq) => (await q1(`select id, sent_by_user_id, status, body, provider_message_id, direction from public.inbox_messages where client_request_id = '${rq}'`))[0];
const unread = async (c) => Number((await q1(`select unread_count from public.inbox_conversations where id = '${c}'`))[0].unread_count);
const status = async (c) => (await q1(`select status from public.inbox_conversations where id = '${c}'`))[0].status;
const count = async (t) => Number((await q1(`select count(*)::int n from public.${t}`))[0].n);

try {
  // ============================================================ guard: who may do what
  reset();
  let r = await reply(conv1, RQ(1));
  const m1 = await msg(RQ(1));
  check("staff reply: a team member with inbox.reply sends a reply -> 200 sent", r.status === 200 && r.body.ok === true && r.body.state === "sent", JSON.stringify(r));
  check("staff reply: attributed to the REAL staff member (sent_by_user_id), outbound, wamid stored — not the owner", m1.sent_by_user_id === full && m1.sent_by_user_id !== owner1 && m1.direction === "outbound" && m1.status === "sent" && /^wamid\.OUT/.test(m1.provider_message_id));
  check("staff reply: Meta was contacted exactly once, FROM the business number (phone_number_id) TO the customer the conversation decides, with the server-side token", metaCalls.length === 1 && metaCalls[0].url.includes(`/${PH1}/messages`) && JSON.parse(metaCalls[0].init.body).to === "237600000001" && String(metaCalls[0].init.headers.Authorization).includes(TOKEN));
  check("staff reply: the database calls were the MEMBER variants only, carrying the staff user (never an owner id, profile, recipient or phone)", rpcCalls.some((c) => c.fn === "inbox_member_prepare_outbound_text") && rpcCalls.some((c) => c.fn === "inbox_member_complete_outbound") && !rpcCalls.some((c) => c.fn === "inbox_prepare_outbound_text" || c.fn === "inbox_complete_outbound") && rpcCalls.filter((c) => c.fn.startsWith("inbox_member_")).every((c) => c.args.p_actor_user_id === full && !JSON.stringify(c.args).includes(owner1)));
  const before = metaCalls.length;
  r = await reply(conv1, RQ(1));
  check("staff reply: idempotent — replaying the same client_request_id returns the original and does NOT contact Meta again", r.status === 200 && metaCalls.length === before && (await count("inbox_messages")) === (await q1(`select count(*)::int n from public.inbox_messages`))[0].n);
  reset();
  r = await reply(conv1, RQ(2), {}, { profile_id: prof2, to: "237699999999", phone_number_id: "123", waba_id: "456", sent_by_user_id: owner1, recipient: "x", organization_id: prof2 });
  const m2 = await msg(RQ(2));
  check("forged profile / organization / recipient / phone / sender fields in the body are ignored: sent to the conversation's own customer, from its own number, attributed to the session user", r.status === 200 && JSON.parse(metaCalls[0].init.body).to === "237600000001" && metaCalls[0].url.includes(`/${PH1}/`) && m2.sent_by_user_id === full && !rpcCalls.some((c) => JSON.stringify(c.args).includes("237699999999") || JSON.stringify(c.args).includes(prof2)), JSON.stringify({ r, meta: metaCalls.map((m) => m.url), rpc: rpcCalls.map((c) => c.fn), m2 }));
  reset();
  r = await reply(conv1, RQ(3), { user: viewer });
  check("a member WITHOUT inbox.reply (viewer) -> 403 forbidden, nothing stored, Meta never contacted", r.status === 403 && r.body.error === "forbidden" && metaCalls.length === 0 && !(await msg(RQ(3))));
  reset();
  const results2 = await Promise.all([[stranger, 403], [org2staff, 403], [freeStaff, 403]].map(async ([u, st], i) => ({ u, st, r: await reply(conv1, RQ(10 + i), { user: u }), meta: metaCalls.length })));
  check("anyone else (stranger, staff of ANOTHER organization, staff of an organization without Team Management) -> 403, nothing stored, Meta never contacted", results2.every((x) => x.r.status === x.st) && metaCalls.length === 0 && !(await msg(RQ(10))) && !(await msg(RQ(11))) && !(await msg(RQ(12))));
  reset();
  check("inactive and removed members lose access immediately (403)", (await reply(conv1, RQ(13), { user: inactive })).status === 403 && (await reply(conv1, RQ(14), { user: removed })).status === 403 && metaCalls.length === 0);
  check("unauthenticated -> 401, no database call, no Meta call", (await reply(conv1, RQ(15), { user: null })).status === 401 && metaCalls.length === 0 && rpcCalls.length === 0);
  check("a staff member cannot reach a conversation of ANOTHER organization they happen to know the id of (org-2 conversation -> 403/404, nothing sent)", (await reply(convB, RQ(16), { user: full })).status !== 200 && metaCalls.length === 0 && !(await msg(RQ(16))));
  check("malformed conversation id -> refused (403/404/422) and nothing sent", [403, 404, 422].includes((await reply("not-a-uuid", RQ(17), { user: full })).status) && metaCalls.length === 0, JSON.stringify(await reply("not-a-uuid", RQ(18), { user: full })));
  reset();
  r = await reply(conv1, RQ(20), { user: owner1 });
  const m20 = await msg(RQ(20));
  check("owner behaviour is UNCHANGED: the owner replies through the original functions, is the sender, and no member function is involved", r.status === 200 && m20.sent_by_user_id === owner1 && rpcCalls.some((c) => c.fn === "inbox_prepare_outbound_text") && !rpcCalls.some((c) => c.fn.startsWith("inbox_member_")), JSON.stringify({ r, m20, rpc: rpcCalls.map((c) => c.fn) }));
  check("owner behaviour is unchanged: no organization lookup call at all for an owner replying to their own conversation", !rpcCalls.some((c) => c.fn === "inbox_actor_access" || c.fn === "inbox_member_workspaces"));
  reset();
  check("an Inbox owner replying to a conversation that is NOT theirs (and they are not staff there) is refused by the database as before (404)", (await reply(convB, RQ(21), { user: owner1 })).status === 404 && metaCalls.length === 0);
  reset();
  r = await reply(convD, RQ(22), { user: dualOwner });
  check("a person who OWNS an Inbox acts as OWNER in their own organization (even though they are also a viewer in organization 1)", r.status === 200 && (await msg(RQ(22))).sent_by_user_id === dualOwner, JSON.stringify({ r, rpc: rpcCalls.map((c) => c.fn) }));
  r = await reply(conv1, RQ(23), { user: dualOwner });
  check("…and as STAFF in organization 1: their viewer role cannot reply there (403) — owning another Inbox grants nothing in someone else's", r.status === 403 && !(await msg(RQ(23))));

  // ============================================================ media
  reset();
  r = await sendMedia(conv1, RQ(30), full);
  const mm = await msg(RQ(30));
  check("staff media: a member with inbox.media sends an image -> 200, attributed to them, uploaded and sent from the business number", r.status === 200 && r.body.ok === true && mm.sent_by_user_id === full && metaCalls.length === 2 && metaCalls[0].url.includes(`/${PH1}/media`) && metaCalls[1].url.includes(`/${PH1}/messages`) && rpcCalls.some((c) => c.fn === "inbox_member_prepare_outbound_media") && rpcCalls.some((c) => c.fn === "inbox_member_complete_outbound_media"), JSON.stringify(r));
  reset();
  check("staff media: without inbox.media (reply role) -> 403, no upload, nothing stored", (await sendMedia(conv1, RQ(31), replier)).status === 403 && metaCalls.length === 0 && !(await msg(RQ(31))));
  check("staff media: a viewer, another organization's staff and a stranger are refused (403) before any upload", (await sendMedia(conv1, RQ(32), viewer)).status === 403 && (await sendMedia(conv1, RQ(33), org2staff)).status === 403 && (await sendMedia(conv1, RQ(34), stranger)).status === 403 && metaCalls.length === 0);
  check("staff media: existing validation is intact (a non-PNG disguised as .png is refused, nothing uploaded)", await (async () => { as(full); const form = new FormData(); form.append("file", new Blob([new TextEncoder().encode("MZ-not-an-image")], { type: "image/png" }), "evil.png"); form.append("client_request_id", RQ(35)); const res = await routes.media.POST(new Request("http://localhost/x", { method: "POST", headers: { "x-ringo-upload": "1" }, body: form }), { params: { id: conv1 } }); return res.status === 422 && metaCalls.length === 0; })());
  reset();
  check("owner media is unchanged (original functions, owner as sender)", (await sendMedia(conv1, RQ(36), owner1)).status === 200 && rpcCalls.some((c) => c.fn === "inbox_prepare_outbound_media") && !rpcCalls.some((c) => c.fn.startsWith("inbox_member_")) && (await msg(RQ(36))).sent_by_user_id === owner1);

  // ============================================================ close / reopen and mark read (+ the activity log)
  reset();
  r = await setStatus(conv2, "closed", { user: closer });
  check("staff close: a member with inbox.close closes a conversation -> 200 closed", r.status === 200 && r.body.state === "closed" && (await status(conv2)) === "closed", JSON.stringify(r));
  check("staff close: recorded in the organization activity log with the REAL staff user (conversation id only, no text)", activity.length === 1 && activity[0].action === "inbox_conversation_closed" && activity[0].actorUserId === closer && activity[0].profileId === prof1 && JSON.stringify(activity[0].details) === JSON.stringify({ conversationId: conv2 }));
  r = await setStatus(conv2, "open", { user: closer });
  check("staff reopen: -> 200 open, logged as reopened", r.status === 200 && (await status(conv2)) === "open" && activity.at(-1).action === "inbox_conversation_reopened");
  reset();
  check("close without inbox.close (viewer, reply role) -> 403, nothing changed, nothing logged", (await setStatus(conv2, "closed", { user: viewer })).status === 403 && (await setStatus(conv2, "closed", { user: replier })).status === 403 && (await status(conv2)) === "open" && activity.length === 0);
  check("close by another organization's staff / a stranger -> 403, nothing changed", (await setStatus(conv2, "closed", { user: org2staff })).status === 403 && (await setStatus(conv2, "closed", { user: stranger })).status === 403 && (await status(conv2)) === "open");
  check("close: an invalid status is refused (422) for staff too", (await setStatus(conv2, "archived", { user: closer })).status === 422);
  reset();
  check("owner close is unchanged (owner function, nothing logged)", (await setStatus(conv2, "closed", { user: owner1 })).status === 200 && rpcCalls.some((c) => c.fn === "inbox_set_conversation_status") && activity.length === 0 && (await setStatus(conv2, "open", { user: owner1 })).status === 200);
  reset();
  const u0 = await unread(conv3);
  r = await markRead(conv3, { user: closer });
  check("staff mark read: a member with inbox.mark_read -> 200 cleared, unread 0, logged with the staff user", r.status === 200 && r.body.state === "cleared" && u0 > 0 && (await unread(conv3)) === 0 && activity.length === 1 && activity[0].action === "inbox_conversation_read" && activity[0].actorUserId === closer);
  r = await markRead(conv3, { user: closer });
  check("staff mark read: repeating it is harmless (unchanged) and logs nothing more", r.status === 200 && r.body.state === "unchanged" && activity.length === 1);
  reset();
  const u1 = await unread(conv1);
  check("mark read without inbox.mark_read (viewer, reply role, other org, stranger) -> 403, count untouched", (await markRead(conv1, { user: viewer })).status === 403 && (await markRead(conv1, { user: replier })).status === 403 && (await markRead(conv1, { user: org2staff })).status === 403 && (await markRead(conv1, { user: stranger })).status === 403 && (await unread(conv1)) === u1 && activity.length === 0);
  reset();
  check("owner mark read is unchanged (owner function, nothing logged)", (await markRead(conv1, { user: owner1 })).state !== "x" && rpcCalls.some((c) => c.fn === "inbox_mark_conversation_read") && activity.length === 0);

  // ============================================================ saved replies: create / edit for staff, delete owner-only
  reset();
  r = await createReply("Staff greeting", "Hello from the team", { user: full });
  check("staff saved reply: a member with inbox.saved_replies creates one -> 201, stored under the ORGANIZATION's profile", r.status === 201 && (await q1(`select profile_id from public.inbox_saved_replies where id = '${r.body.id}'`))[0].profile_id === prof1, JSON.stringify(r));
  const srId = r.body.id;
  check("staff saved reply: the call was the member variant with the staff user and the server-resolved organization", rpcCalls.filter((c) => c.fn === "inbox_member_saved_reply_save").length === 1 && !rpcCalls.some((c) => c.fn === "inbox_saved_reply_save") && rpcCalls.find((c) => c.fn === "inbox_member_saved_reply_save").args.p_actor_user_id === full && rpcCalls.find((c) => c.fn === "inbox_member_saved_reply_save").args.p_profile_id === prof1, JSON.stringify(rpcCalls));
  r = await updateReply(srId, "Staff greeting", "Hello, edited", { user: savedOnly });
  check("staff saved reply: a member with inbox.saved_replies edits it -> 200", r.status === 200 && (await q1(`select body from public.inbox_saved_replies where id = '${srId}'`))[0].body === "Hello, edited");
  reset();
  check("staff saved reply: without inbox.saved_replies (viewer, closer) -> 403, nothing stored", (await createReply("x", "y", { user: viewer })).status === 403 && (await createReply("x", "y", { user: closer })).status === 403 && (await updateReply(srId, "t", "b", { user: viewer })).status === 403 && !rpcCalls.some((c) => /saved_reply_save/.test(c.fn)));
  const c1 = Number((await q1(`select count(*)::int n from public.inbox_saved_replies where profile_id = '${prof1}'`))[0].n);
  const other = await createReply("Org two template", "Only for org two", { user: org2staff });
  check("staff saved reply: another organization's staff can only ever write to THEIR OWN organization (server-resolved), never to organization 1; a stranger cannot write at all", other.status === 201 && (await q1(`select profile_id from public.inbox_saved_replies where id = '${other.body.id}'`))[0].profile_id === prof2 && Number((await q1(`select count(*)::int n from public.inbox_saved_replies where profile_id = '${prof1}'`))[0].n) === c1 && (await createReply("x", "y", { user: stranger })).status === 403 && (await updateReply(srId, "hijack", "hijack", { user: org2staff })).status !== 200 && (await q1(`select body from public.inbox_saved_replies where id = '${srId}'`))[0].body === "Hello, edited");
  reset();
  const delByStaff = await Promise.all([full, savedOnly, replier, closer, viewer].map((u) => deleteReply(srId, { user: u })));
  check("DELETE saved reply: NO team member can (even with every Inbox permission) -> 403, the reply still exists, no delete call", delByStaff.every((x) => x.status === 403) && (await q1(`select 1 from public.inbox_saved_replies where id = '${srId}'`)).length === 1 && !rpcCalls.some((c) => /delete/.test(c.fn)));
  check("DELETE saved reply: the OWNER still can (owner-only)", (await deleteReply(srId, { user: owner1 })).status === 200 && (await q1(`select 1 from public.inbox_saved_replies where id = '${srId}'`)).length === 0);
  const mc = AR.memberRpcClient({ rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: "ok", error: null }; } });
  reset();
  const blocked = await Promise.all(["inbox_saved_reply_delete", "inbox_settings_save", "inbox_claim_follow_ups", "delete_everything", "inbox_member_saved_reply_save", "constructor", "__proto__", "toString"].map((fn) => mc.rpc(fn, {})));
  check("memberRpcClient: anything without a member variant (saved-reply delete, settings, automation, member functions themselves, prototype keys) fails closed and never reaches the database", blocked.every((x) => x.error?.code === "not_allowed" && x.data === null) && rpcCalls.length === 0);
  await mc.rpc("inbox_prepare_outbound_text", { a: 1 });
  check("memberRpcClient: owner names are mapped to member functions; the mapping is frozen and contains no delete", rpcCalls.length === 1 && rpcCalls[0].fn === "inbox_member_prepare_outbound_text" && Object.isFrozen(AR.MEMBER_FUNCTIONS) && Object.keys(AR.MEMBER_FUNCTIONS).length === 8 && ![...Object.keys(AR.MEMBER_FUNCTIONS), ...Object.values(AR.MEMBER_FUNCTIONS)].some((f) => /delete|remove|drop|truncate|settings|automation/i.test(f)));
  reset();
  check("settings route is owner-only: a team member (even with every Inbox permission) cannot save Inbox settings (403), no database call", (await call(routes.settings.POST, "/api/inbox/settings", "POST", { mode: "always" }, { user: full })).status === 403 && rpcCalls.length === 0);

  // ============================================================ the active-organization cookie is only a hint
  reset();
  globalThis.__cookie = prof1; as(stranger);
  let a = await ACT.resolveInboxActor();
  check("cookie: a stranger with the cookie pointing at organization 1 gets nothing (the cookie never grants)", a.ok === false);
  as(full); globalThis.__cookie = prof2;
  a = await ACT.resolveInboxActor();
  check("cookie: staff of organization 1 with the cookie pointing at organization 2 (where they are nobody) still resolve to organization 1 only", a.ok && a.actor.kind === "staff" && a.actor.profileId === prof1);
  as(viewer); globalThis.__cookie = prof1;
  a = await ACT.resolveInboxActor();
  check("staff actor: organization from the database, permissions = exactly what works for the role (viewer: inbox.view)", a.ok && a.actor.kind === "staff" && a.actor.profileId === prof1 && a.actor.permissions.join() === "inbox.view");
  reset(); as(owner1); globalThis.__cookie = null;
  a = await ACT.resolveInboxActor();
  check("owner actor: own profile, every Inbox permission, and no staff lookup", a.ok && a.actor.kind === "owner" && a.actor.profileId === prof1 && a.actor.permissions.length === 7 && !rpcCalls.some((c) => c.fn === "inbox_member_workspaces"));
  as(dualOwner); globalThis.__cookie = null;
  a = await ACT.resolveInboxActor();
  check("dual role: with no hint a person who owns an Inbox gets their own", a.ok && a.actor.kind === "owner" && a.actor.profileId === profDual);
  globalThis.__cookie = prof1;
  a = await ACT.resolveInboxActor();
  check("dual role: with the cookie on an organization where they ARE a verified viewer they act as staff there (and only with the viewer permissions)", a.ok && a.actor.kind === "staff" && a.actor.profileId === prof1 && a.actor.permissions.join() === "inbox.view");
  globalThis.__cookie = prof2;
  a = await ACT.resolveInboxActor();
  check("dual role: a cookie on an organization where they are NOT a member falls back to their own Inbox", a.ok && a.actor.kind === "owner" && a.actor.profileId === profDual);
  reset(); as(freeStaff);
  check("staff of an organization WITHOUT Team Management get no Inbox (Team plan gate)", (await ACT.resolveInboxActor()).ok === false && (await ACT.staffInboxNavVisible(freeStaff)) === false);
  check("nav: shown for staff with inbox.view; not for inactive, removed, no-view or strangers", (await ACT.staffInboxNavVisible(viewer)) === true && (await ACT.staffInboxNavVisible(inactive)) === false && (await ACT.staffInboxNavVisible(removed)) === false && (await ACT.staffInboxNavVisible(stranger)) === false);

  // ============================================================ pages (server) as staff
  const props = async (el) => (el && el.props) || {};
  reset(); as(viewer);
  let el = await pageList({ searchParams: {} });
  let p = await props(el);
  check("page (staff viewer): the list holds ONLY organization 1's conversations, as staff with inbox.view; automation (owner-only tables) is not loaded", p.list.ok && p.list.items.length === 3 && !JSON.stringify(p.list).includes("Bob Customer") && p.access.kind === "staff" && p.access.permissions.join() === "inbox.view" && p.automation === null);
  as(owner1);
  el = await pageList({ searchParams: {} });
  p = await props(el);
  check("page (owner): unchanged — own conversations, owner access, automation view loaded", p.list.ok && p.list.items.length === 3 && p.access.kind === "owner" && p.automation !== null);
  as(full); globalThis.__cookie = null;
  el = await pageThread({ params: { id: conv1 }, searchParams: {} });
  p = await props(el);
  check("page (staff full): the thread opens with messages, saved replies available (inbox.saved_replies), sender labels for staff-sent messages", p.thread.ok && p.thread.thread.messages.length >= 1 && Array.isArray(p.savedReplies) && Object.values(p.senders).includes("Fatou Full"), JSON.stringify(p.senders));
  as(viewer);
  el = await pageThread({ params: { id: conv1 }, searchParams: {} });
  p = await props(el);
  check("page (staff viewer): the thread opens but saved replies are NOT loaded (needs inbox.saved_replies)", p.thread.ok && p.savedReplies === null);
  as(viewer);
  let sig = null; try { await pageThread({ params: { id: convB }, searchParams: {} }); } catch (e) { sig = e; }
  p = sig ? {} : await props(await pageThread({ params: { id: convB }, searchParams: {} }));
  check("page (staff): another organization's conversation id shows 'not found', never its content", !JSON.stringify(p).includes("ORG TWO PRIVATE") && (p.thread?.ok === false || sig !== null));
  as(stranger);
  sig = null; try { await layout({ children: null }); } catch (e) { sig = e; }
  check("layout: a stranger is redirected to /dashboard", sig instanceof RedirectSignal && sig.url === "/dashboard");
  as(null);
  sig = null; try { await layout({ children: null }); } catch (e) { sig = e; }
  check("layout: signed out -> /auth/login", sig instanceof RedirectSignal && sig.url === "/auth/login");
  as(viewer);
  sig = null; try { await pageReplies(); } catch (e) { sig = e; }
  check("replies page: a staff member WITHOUT inbox.saved_replies is sent back to the Inbox", sig instanceof RedirectSignal && sig.url === "/dashboard/inbox");
  as(savedOnly);
  el = await pageReplies();
  check("replies page: staff with inbox.saved_replies get the manager WITHOUT delete (canDelete=false)", el.props.canDelete === false && el.props.available === true);
  as(owner1);
  el = await pageReplies();
  check("replies page: the owner keeps delete", el.props.canDelete === true);

  // ============================================================ components (EN + FR)
  const thread = { conversation: { id: conv1, channel: "whatsapp", status: "open", replyWindowOpen: true }, contact: { name: "Customer One", waId: "237600000001" }, messages: [{ id: "m1", direction: "inbound", status: "received", at: new Date().toISOString(), display: { kind: "text", text: "Hi" }, unconfirmed: false }, { id: "m2", direction: "outbound", status: "failed", at: new Date().toISOString(), display: { kind: "text", text: "Out" }, unconfirmed: false }], truncated: false };
  const view = (access, extra = {}) => render("en", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: conv1, thread: { ok: true, thread }, access, senders: { m2: "Fatou Full" }, ...extra }));
  const owner = view({ kind: "owner", permissions: [] }, { savedReplies: [] });
  const fullH = view({ kind: "staff", permissions: ["inbox.view", "inbox.reply", "inbox.media", "inbox.saved_replies", "inbox.ai", "inbox.mark_read", "inbox.close"] }, { savedReplies: [] });
  const viewerH = view({ kind: "staff", permissions: ["inbox.view"] });
  const replyH = view({ kind: "staff", permissions: ["inbox.view", "inbox.reply"] });
  check("UI owner: unchanged — composer with attach, AI panel, close button, settings link, retry on a failed message", /type="file"/.test(owner) && /AI assistant/.test(owner) && /Close conversation/.test(owner) && /\/dashboard\/inbox\/settings/.test(owner) && /Retry/.test(owner));
  check("UI staff (every permission): composer with attach, AI panel, close button — but NO settings/automation link", /type="file"/.test(fullH) && /AI assistant/.test(fullH) && /Close conversation/.test(fullH) && !/\/dashboard\/inbox\/settings/.test(fullH));
  check("UI staff viewer (inbox.view only): no composer, no attach, no AI panel, no close button, no retry; a read-only notice instead", !new RegExp(`id="reply-${conv1}"`).test(viewerH) && !/type="file"/.test(viewerH) && !/AI assistant/.test(viewerH) && !/Close conversation/.test(viewerH) && !/Retry/.test(viewerH) && /data-testid="staff-read-only"/.test(viewerH) && /you don&#x27;t have permission to reply/.test(viewerH));
  check("UI staff reply-only: composer WITHOUT attach (no inbox.media), no AI panel, no close button", new RegExp(`id="reply-${conv1}"`).test(replyH) && !/type="file"/.test(replyH) && !/AI assistant/.test(replyH) && !/Close conversation/.test(replyH));
  check("UI: staff-sent messages show who sent them (EN) and the same in French", /data-sender="true">· by Fatou Full/.test(fullH) && /par Fatou Full/.test(render("fr", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: conv1, thread: { ok: true, thread }, access: { kind: "staff", permissions: ["inbox.view", "inbox.reply"] }, senders: { m2: "Fatou Full" } }))));
  check("UI (FR): the read-only notice is translated", /vous n&#x27;avez pas la permission d&#x27;y répondre/.test(render("fr", React.createElement(InboxView, { list: { ok: true, items: [] }, selectedId: conv1, thread: { ok: true, thread }, access: { kind: "staff", permissions: ["inbox.view"] } }))));
  const mgrOwner = render("en", React.createElement(Manager, { items: [{ id: "x", title: "T", body: "B" }], available: true }));
  const mgrStaff = render("en", React.createElement(Manager, { items: [{ id: "x", title: "T", body: "B" }], available: true, canDelete: false }));
  check("UI saved replies: the owner sees Edit + Delete; a team member sees Edit only (no delete control at all)", />Delete</.test(mgrOwner) && />Edit</.test(mgrOwner) && !/>Delete</.test(mgrStaff) && />Edit</.test(mgrStaff));
  check("UI: the mark-read marker is only mounted for members with inbox.mark_read", !/ConversationReadMarker/.test(viewerH) && read("src/components/inbox/InboxView.tsx").includes('can("inbox.mark_read") && <ConversationReadMarker'));
} finally {
  console.error = origErr;
  globalThis.fetch = realFetch;
}

// ============================================================ static: nothing in the staff path can delete, and no browser value is trusted
{
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const staffFiles = ["src/lib/inbox/actor.ts", "src/lib/inbox/actorRoute.ts", "src/lib/inbox/readState.ts", "src/lib/inbox/senders.ts", "src/lib/ai/inboxStaffAccess.ts", "src/app/api/inbox/conversations/[id]/read/route.ts", "src/app/api/inbox/conversations/[id]/status/route.ts"];
  const s = staffFiles.map(code).join("\n");
  check("static: no staff-path file deletes anything (no DELETE verb, no .delete(), no delete SQL, no delete function)", !/\.delete\(|delete from|export async function DELETE|inbox_saved_reply_delete|truncate/i.test(s));
  check("static: the staff routes read no profile / organization / owner / sender / recipient / role / permission from the request body", !/body\.(profile|organization|org|owner|user|actor|sender|to|recipient|phone|waba|role|permission|quota)/i.test(s) && !/searchParams|request\.url/.test(s));
  check("static: only the ONE trusted route layer creates service clients for staff (guards), and the browser components never import it", /createAdminClient/.test(code("src/lib/inbox/actorRoute.ts")) && !/actorRoute|inbox\/actor"|createAdminClient|supabase\/server/.test(["src/components/inbox/InboxView.tsx", "src/components/inbox/ConversationReadMarker.tsx", "src/components/inbox/SavedRepliesManager.tsx", "src/components/inbox/ReplyComposer.tsx", "src/components/team/RolesPanel.tsx"].map(code).join("\n")));
  const perms = read("src/lib/team/permissions.ts");
  check("static: the permission catalog has exactly the seven Inbox permissions and NO delete / remove / settings Inbox permission", (perms.match(/"inbox\.[a-z_]+"/g) || []).filter((v, i, a) => a.indexOf(v) === i).sort().join() === ['"inbox.ai"', '"inbox.close"', '"inbox.mark_read"', '"inbox.media"', '"inbox.reply"', '"inbox.saved_replies"', '"inbox.view"'].sort().join() && !/inbox\.(delete|remove|settings|automation|admin)/i.test(perms));
  const team = ["src/app/api/team/roles/route.ts", "src/app/api/team/roles/[id]/route.ts", "src/app/api/team/members/[id]/route.ts", "src/app/api/team/invitations/route.ts", "src/app/api/team/invitations/[id]/route.ts"].map(code).join("\n");
  check("static: every Team route that can give or move Inbox access repeats the owner-only rule (defense in depth)", (team.match(/inbox_owner_only|inboxOwnerOnlyResponse/g) || []).length >= 5);
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
