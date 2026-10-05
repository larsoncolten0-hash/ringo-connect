// Staff Inbox roles, DATABASE layer: the REAL Inbox migrations (Phase 4/7/8/9/11) + the REAL Team migrations + the Team permission guard + the staff
// migration (2026-12-14) on scratch in-memory PostgreSQL (PGlite). Every staff action is run the way production runs it: reads as the `authenticated`
// role with RLS on, mutations as `service_role` through the member functions (the trusted server route passes only the session user id).
// Covers: permission matrix + dependencies, Team plan gate, inactive/removed members, cross-organization isolation, forged ids, reply / media / status /
// mark-read / saved-reply authorization, attribution (sent_by_user_id = the real staff member), owner-only things, and the deletion guarantees.
//   Run:  node scripts/tests/whatsappInboxStaff.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MID = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner1 = U(1), owner2 = U(2), full = U(3), viewer = U(4), replier = U(5), noview = U(6), inactive = U(7), removed = U(8), org2staff = U(9), stranger = U(10), freeOwner = U(11), freeStaff = U(12), mediaNoReply = U(13), closer = U(14), other = U(15);
const prof1 = P(1), prof2 = P(2), profFree = P(3);

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key default gen_random_uuid(), name text, team_enabled boolean not null default false);
  create table public.users (id uuid primary key, email text not null, role text not null default 'user', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (true);
  create function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.users where id = auth.uid() and role = 'admin') $$;
  create table public.bk_customers (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict, name text not null, unique (profile_id, id));
`);
await db.exec(read("supabase/migrations/2026-10-01_team_management.sql").split("\n").slice(27, 261).join("\n"));
await db.exec(read("supabase/migrations/2026-10-03_team_rls_enterprise_gate.sql"));
await db.exec(read("supabase/migrations/2026-10-04_team_members_read_fix.sql"));
const planBiz = "d0000000-0000-4000-8000-000000000001", planFree = "d0000000-0000-4000-8000-000000000002";
await db.exec(`
  insert into public.plans (id, name, team_enabled) values ('${planBiz}', 'business', true), ('${planFree}', 'free', false);
  insert into public.users (id, email, plan_id) values ${[owner1, owner2, full, viewer, replier, noview, inactive, removed, org2staff, stranger, freeStaff, mediaNoReply, closer, other].map((u) => `('${u}', '${u}@x.test', '${planFree}')`).join(", ")}, ('${freeOwner}', 'f@x.test', '${planFree}');
  update public.users set plan_id = '${planBiz}' where id in ('${owner1}', '${owner2}');
  insert into public.profiles values ('${prof1}','${owner1}','owner1'), ('${prof2}','${owner2}','owner2'), ('${profFree}','${freeOwner}','freeowner');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-12_whatsapp_inbox_mark_read"]) await db.exec(read(`supabase/migrations/${m}.sql`));
// the read-only PREFLIGHT runs on the database as it is BEFORE the two new migrations (everything it needs is there, nothing of the new work is)
const preflightRows = (await db.query(read("supabase/support/2026-12-14_whatsapp_inbox_staff.preflight.sql"))).rows;
for (const m of ["2026-12-13_whatsapp_inbox_team_permission_guard", "2026-12-14_whatsapp_inbox_staff"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);
// the Inbox tables keep their write-protection (the blanket grant above is the Team tables' Supabase default; restore the Inbox privileges exactly as the migrations set them)
await db.exec(`revoke all on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events, public.inbox_saved_replies, public.inbox_settings, public.inbox_conversation_state from anon, authenticated, service_role;
  grant select on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events to authenticated, service_role;
  grant select on public.inbox_saved_replies to authenticated, service_role;`);

const PH1 = "1110000000001", PH2 = "9990000000001", PH3 = "7770000000001";
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${prof1}', '${PH1}', '1110000000002'), ('${prof2}', '${PH2}', '9990000000002'), ('${profFree}', '${PH3}', '7770000000002')`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', ${sq(o.text ?? "hi")}, ${sq(o.name)}, null, null, null, null, null, null, null)`);
await ingest({ phone: PH1, id: "wamid.A1", from: "237600000001", ts: hoursAgo(1), name: "Customer One", text: "Hello org one" });
await ingest({ phone: PH1, id: "wamid.A2", from: "237600000002", ts: hoursAgo(2), name: "Customer Two", text: "Second" });
await ingest({ phone: PH2, id: "wamid.B1", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer", text: "ORG TWO PRIVATE" });
await ingest({ phone: PH3, id: "wamid.F1", from: "237622222222", ts: hoursAgo(1), name: "Free Customer", text: "free org" });
const q1 = async (sql) => (await db.query(sql)).rows;
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv1b = await convOf("237600000002"), convB = await convOf("237611111111"), convF = await convOf("237622222222");

// ---- Team setup (owners set Inbox roles directly: the guard allows the owner) ---------------------------------------------------------------
const role = (id, prof, key, perms) => `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${id}','${prof}','${key}','${key}','{${perms}}')`;
const R = { full: RID(1), viewer: RID(2), reply: RID(3), noview: RID(4), media: RID(5), closer: RID(6), mediaNoReply: RID(7), other: RID(8), org2: RID(9), none: RID(10), saved: RID(11) };
await db.exec([
  role(R.full, prof1, "full", "inbox.view,inbox.reply,inbox.media,inbox.saved_replies,inbox.ai,inbox.mark_read,inbox.close"),
  role(R.viewer, prof1, "viewer", "inbox.view"),
  role(R.reply, prof1, "reply", "inbox.view,inbox.reply"),
  role(R.noview, prof1, "noview", "inbox.reply,inbox.media,inbox.close,inbox.mark_read,inbox.saved_replies,inbox.ai"),   // dependencies: no inbox.view
  role(R.mediaNoReply, prof1, "medianoreply", "inbox.view,inbox.media"),                                                   // media without reply
  role(R.closer, prof1, "closer", "inbox.view,inbox.close,inbox.mark_read"),
  role(R.saved, prof1, "saved", "inbox.view,inbox.saved_replies"),
  role(R.other, prof1, "ordinary", "orders.view"),
  role(R.org2, prof2, "org2full", "inbox.view,inbox.reply,inbox.media,inbox.saved_replies,inbox.ai,inbox.mark_read,inbox.close"),
].join("; "));
const member = (id, prof, user, roleId, status = "active") => `insert into public.organization_members (id, profile_id, user_id, role_id, status) values ('${id}','${prof}','${user}','${roleId}','${status}')`;
await db.exec([
  member(MID(1), prof1, full, R.full), member(MID(2), prof1, viewer, R.viewer), member(MID(3), prof1, replier, R.reply), member(MID(4), prof1, noview, R.noview),
  member(MID(5), prof1, inactive, R.full, "inactive"), member(MID(6), prof1, removed, R.full, "removed"), member(MID(7), prof2, org2staff, R.org2),
  member(MID(8), prof1, mediaNoReply, R.mediaNoReply), member(MID(9), prof1, closer, R.closer), member(MID(10), prof1, other, R.other),
].join("; "));
// an org on a plan WITHOUT Team Management that nevertheless has a staff row with Inbox permissions (e.g. downgraded after the fact)
await db.exec(`${role(R.none, profFree, "freefull", "inbox.view,inbox.reply,inbox.media,inbox.saved_replies,inbox.ai,inbox.mark_read,inbox.close")}; ${member(MID(11), profFree, freeStaff, R.none)}`);

// ---- run as the trusted server (service_role) or as a signed-in browser (authenticated, RLS on) --------------------------------------------
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => undefined, () => undefined); return p; };
const svc = (sql) => serial(async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } });
const rpc = async (fn, args) => (await svc(`select public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ")}) as r`)).rows[0].r;
const asUser = (user, sql) => serial(async () => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, code: e.code, msg: String(e.message) }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)"); }
});
const can = async (user, prof, perm) => (await svc(`select public.inbox_member_can(${sq(user)}, ${sq(prof)}, ${sq(perm)}) as r`)).rows[0].r;
const PERMS = ["inbox.view", "inbox.reply", "inbox.media", "inbox.saved_replies", "inbox.ai", "inbox.mark_read", "inbox.close"];

// ============================================================ 1. permission matrix, dependencies, gates
check("owner: every Inbox permission, regardless of roles (owner is unrestricted)", (await Promise.all(PERMS.map((p) => can(owner1, prof1, p)))).every(Boolean));
check("full role: every permission", (await Promise.all(PERMS.map((p) => can(full, prof1, p)))).every(Boolean));
check("viewer: inbox.view only", (await can(viewer, prof1, "inbox.view")) && (await Promise.all(PERMS.slice(1).map((p) => can(viewer, prof1, p)))).every((x) => x === false));
check("reply role: view + reply, nothing else", (await can(replier, prof1, "inbox.reply")) && (await can(replier, prof1, "inbox.view")) && !(await can(replier, prof1, "inbox.media")) && !(await can(replier, prof1, "inbox.close")) && !(await can(replier, prof1, "inbox.ai")));
check("dependencies: reply / media / saved_replies / ai / mark_read / close WITHOUT inbox.view grant nothing", (await Promise.all(PERMS.map((p) => can(noview, prof1, p)))).every((x) => x === false));
check("dependencies: inbox.media without inbox.reply grants neither media nor reply", !(await can(mediaNoReply, prof1, "inbox.media")) && !(await can(mediaNoReply, prof1, "inbox.reply")) && (await can(mediaNoReply, prof1, "inbox.view")));
check("each permission works independently with only its dependency (close, mark_read, saved_replies need only view)", (await can(closer, prof1, "inbox.close")) && (await can(closer, prof1, "inbox.mark_read")) && !(await can(closer, prof1, "inbox.reply")) && (await can(await Promise.resolve(U(1)), prof1, "inbox.close")));
check("an ordinary role (no inbox permission) grants nothing", (await Promise.all(PERMS.map((p) => can(other, prof1, p)))).every((x) => x === false));
check("inactive and removed members have no access", (await Promise.all(PERMS.map((p) => can(inactive, prof1, p)))).every((x) => x === false) && (await Promise.all(PERMS.map((p) => can(removed, prof1, p)))).every((x) => x === false));
check("Team plan gate: a member of an organization WITHOUT Team Management gets nothing", (await Promise.all(PERMS.map((p) => can(freeStaff, profFree, p)))).every((x) => x === false));
check("cross-organization: org-1 staff have nothing in org 2, org-2 staff nothing in org 1, strangers nothing anywhere", (await can(full, prof2, "inbox.view")) === false && (await can(org2staff, prof1, "inbox.view")) === false && (await can(org2staff, prof2, "inbox.view")) === true && (await can(stranger, prof1, "inbox.view")) === false);
check("a role belonging to ANOTHER organization grants nothing (membership of org 1 pointing at org 2's role)", await (async () => { await svc(`update public.organization_members set role_id = '${R.org2}' where id = '${MID(10)}'`); const v = await can(other, prof1, "inbox.view"); await svc(`update public.organization_members set role_id = '${R.other}' where id = '${MID(10)}'`); return v === false; })());
check("unknown or delete-like permission names are never granted (not even to the owner)", (await can(owner1, prof1, "inbox.delete")) === false && (await can(full, prof1, "inbox.delete_messages")) === false && (await can(full, prof1, "orders.view")) === false && (await can(full, prof1, null)) === false);
check("null / malformed inputs answer false", (await can(null, prof1, "inbox.view")) === false && (await can(full, null, "inbox.view")) === false);
check("revocation is immediate: deactivating a member removes access on the next call, reactivating restores it", await (async () => { await asUser(owner1, `update public.organization_members set status = 'inactive' where id = '${MID(3)}'`); const off = await can(replier, prof1, "inbox.reply"); await asUser(owner1, `update public.organization_members set status = 'active' where id = '${MID(3)}'`); return off === false && (await can(replier, prof1, "inbox.reply")) === true; })());
check("a role change takes effect immediately (owner removes inbox.reply from the reply role)", await (async () => { await asUser(owner1, `update public.organization_roles set permissions = '{inbox.view}' where id = '${R.reply}'`); const off = await can(replier, prof1, "inbox.reply"); await asUser(owner1, `update public.organization_roles set permissions = '{inbox.view,inbox.reply}' where id = '${R.reply}'`); return off === false && (await can(replier, prof1, "inbox.reply")) === true; })());

const rel = async (user, conv, perm) => (await svc(`select public.inbox_actor_access(${sq(user)}, ${sq(conv)}, ${sq(perm)}) as r`)).rows[0].r;
check("inbox_actor_access: owner / member / forbidden / not_found", (await rel(owner1, conv1, "inbox.reply")) === "owner" && (await rel(replier, conv1, "inbox.reply")) === "member" && (await rel(viewer, conv1, "inbox.reply")) === "forbidden" && (await rel(stranger, conv1, "inbox.view")) === "not_found" && (await rel(full, convB, "inbox.view")) === "not_found" && (await rel(inactive, conv1, "inbox.view")) === "not_found" && (await rel(freeStaff, convF, "inbox.view")) === "not_found" && (await rel(full, "00000000-0000-4000-8000-00000000ffff", "inbox.view")) === "not_found");
const ws = async (user) => (await svc(`select public.inbox_member_workspaces(${sq(user)}) as r`)).rows[0].r;
check("inbox_member_workspaces: lists only the member's own organization with the permissions that actually work", JSON.stringify((await ws(replier))) === JSON.stringify([{ profile_id: prof1, permissions: ["inbox.reply", "inbox.view"] }]) && (await ws(noview)).length === 0 && (await ws(viewer))[0].permissions.join() === "inbox.view" && (await ws(inactive)).length === 0 && (await ws(freeStaff)).length === 0 && (await ws(stranger)).length === 0 && (await ws(owner1)).length === 0);

// ============================================================ 2. staff READ access (authenticated, RLS)
const seen = async (user, table, col = "1 as x") => { const r = await asUser(user, `select ${col} from public.${table}`); return { ...r, rows: r.rows ?? [] }; };
let r = await asUser(viewer, `select id from public.inbox_conversations`);
check("RLS: staff with inbox.view see their organization's conversations — and only those", r.ok && r.rows.length === 2 && !r.rows.some((x) => x.id === convB || x.id === convF), JSON.stringify(r).slice(0, 200));
r = await asUser(viewer, `select body from public.inbox_messages`);
check("RLS: …and its messages, never another organization's", r.ok && r.rows.length === 2 && !JSON.stringify(r.rows).includes("ORG TWO PRIVATE"), JSON.stringify(r));
r = await asUser(viewer, `select display_name, external_id from public.inbox_contacts`);
check("RLS: …and its contacts (name + phone)", r.ok && r.rows.length === 2);
check("RLS: media metadata and status events are readable too (inbox.view)", (await seen(viewer, "inbox_message_media")).ok && (await seen(viewer, "inbox_status_events")).ok);
check("RLS: staff WITHOUT inbox.view (even with reply/media/close...) see nothing", (await seen(noview, "inbox_conversations")).rows.length === 0 && (await seen(noview, "inbox_messages")).rows.length === 0 && (await seen(other, "inbox_conversations")).rows.length === 0);
check("RLS: inactive / removed members see nothing, immediately", (await seen(inactive, "inbox_conversations")).rows.length === 0 && (await seen(removed, "inbox_messages")).rows.length === 0);
check("RLS: Team plan gate - staff of an organization without Team Management see nothing", (await seen(freeStaff, "inbox_conversations")).rows.length === 0);
check("RLS: cross-organization - org-2 staff see only org 2; org-1 staff never see org 2", (await asUser(org2staff, `select id from public.inbox_conversations`)).rows.length === 1 && (await asUser(org2staff, `select id from public.inbox_conversations`)).rows[0].id === convB && (await seen(stranger, "inbox_conversations")).rows.length === 0);
check("RLS: forging a profile id in the query does not widen access (filtering by another profile returns nothing)", (await asUser(viewer, `select id from public.inbox_conversations where profile_id = '${prof2}'`)).rows.length === 0);
check("RLS: staff cannot read the WhatsApp account row (WABA / phone number ids), inbox settings or automation state", (await seen(full, "wa_accounts")).rows.length === 0 && (await seen(full, "inbox_settings")).rows.length === 0 && (await seen(full, "inbox_conversation_state")).rows.length === 0);
await asUser(owner1, `select 1`);
check("the owner still reads their own data and WhatsApp account (existing owner-read policies untouched)", (await seen(owner1, "inbox_conversations")).rows.length === 2 && (await seen(owner1, "wa_accounts")).rows.length === 1);
await db.exec(`insert into public.inbox_saved_replies (profile_id, title, body) values ('${prof1}', 'Hello', 'Hi there')`);
check("RLS: saved replies readable only with inbox.saved_replies (view alone is not enough)", (await seen(full, "inbox_saved_replies")).rows.length === 1 && (await seen(viewer, "inbox_saved_replies")).rows.length === 0 && (await seen(replier, "inbox_saved_replies")).rows.length === 0 && (await seen(org2staff, "inbox_saved_replies")).rows.length === 0);

// ============================================================ 3. replies (text): authorization, attribution, idempotency
const prep = (user, conv, rq, body = "Staff reply") => rpc("inbox_member_prepare_outbound_text", { p_actor_user_id: user, p_conversation_id: conv, p_client_request_id: rq, p_body: body });
let res = await prep(replier, conv1, RQ(1));
check("reply: a staff member with inbox.reply gets a queued message; the recipient and business number come from the database", res.result === "created" && res.to === "237600000001" && res.phone_number_id === PH1, JSON.stringify(res));
const row = async (id) => (await q1(`select sent_by_user_id, status, direction, body, profile_id from public.inbox_messages where id = '${id}'`))[0];
check("attribution: the message row is attributed to the REAL staff member (not the owner)", (await row(res.message_id)).sent_by_user_id === replier && (await row(res.message_id)).sent_by_user_id !== owner1 && (await row(res.message_id)).status === "queued");
res = await prep(replier, conv1, RQ(1));
check("idempotency: the same request id from the same member returns the original row, no second message", res.result === "existing" && (await q1(`select count(*)::int n from public.inbox_messages where client_request_id = '${RQ(1)}'`))[0].n === 1);
res = await prep(full, conv1, RQ(1));
check("idempotency: another member replaying that request id is refused (conflict)", res.result === "conflict");
res = await prep(replier, conv1, RQ(1), "A different text");
check("idempotency: same request id with different text is a conflict (existing rule preserved)", res.result === "conflict");
check("reply: viewer (no inbox.reply), no-view member, inactive, removed, other-org staff, stranger, no-Team-plan staff -> not_found, nothing stored", await (async () => { const before = (await q1(`select count(*)::int n from public.inbox_messages`))[0].n; const rs = await Promise.all([viewer, noview, inactive, removed, org2staff, stranger, freeStaff, other].map((u, i) => prep(u, conv1, RQ(10 + i)))); const after = (await q1(`select count(*)::int n from public.inbox_messages`))[0].n; return rs.every((x) => x.result === "not_found") && after === before; })());
check("reply: a forged conversation of ANOTHER organization -> not_found (replier cannot write into org 2)", (await prep(replier, convB, RQ(30))).result === "not_found" && (await prep(org2staff, conv1, RQ(31))).result === "not_found");
check("reply: malformed / null ids -> invalid", (await prep(null, conv1, RQ(32))).result === "invalid" && (await prep(replier, null, RQ(33))).result === "invalid" && (await prep(replier, conv1, null)).result === "invalid");
check("reply: the existing 24-hour window rule still applies to staff", await (async () => { await ingest({ phone: PH1, id: "wamid.OLD", from: "237600000009", ts: hoursAgo(30), name: "Old", text: "old" }); const old = await convOf("237600000009"); return (await prep(replier, old, RQ(34))).result === "window_closed"; })());
const mid1 = (await q1(`select id from public.inbox_messages where client_request_id = '${RQ(1)}'`))[0].id;
check("complete: only the member who created the message can complete it; another member / the viewer cannot", (await rpc("inbox_member_complete_outbound", { p_actor_user_id: full, p_message_id: mid1, p_provider_message_id: "wamid.OUT1" })) === "not_found" && (await rpc("inbox_member_complete_outbound", { p_actor_user_id: viewer, p_message_id: mid1, p_provider_message_id: "wamid.OUT1" })) === "not_found" && (await row(mid1)).status === "queued");
check("complete: the creator completes it -> sent, wamid stored, attribution unchanged", (await rpc("inbox_member_complete_outbound", { p_actor_user_id: replier, p_message_id: mid1, p_provider_message_id: "wamid.OUT1" })) === "ok" && (await row(mid1)).status === "sent" && (await row(mid1)).sent_by_user_id === replier);
const res2 = await prep(replier, conv1b, RQ(2), "Will fail");
check("fail: only the creator can mark it failed", (await rpc("inbox_member_fail_outbound", { p_actor_user_id: full, p_message_id: res2.message_id, p_error_codes: [131047] })) === "not_found" && (await rpc("inbox_member_fail_outbound", { p_actor_user_id: replier, p_message_id: res2.message_id, p_error_codes: [131047] })) === "ok" && (await row(res2.message_id)).status === "failed");
check("owner behaviour is unchanged: the owner still uses the original function and is the sender of their own messages", await (async () => { const o = await rpc("inbox_prepare_outbound_text", { p_actor_user_id: owner1, p_conversation_id: conv1, p_client_request_id: RQ(40), p_body: "Owner reply" }); return o.result === "created" && (await row(o.message_id)).sent_by_user_id === owner1; })());
check("the ORIGINAL owner functions still refuse staff (staff cannot call them with their own id)", (await rpc("inbox_prepare_outbound_text", { p_actor_user_id: replier, p_conversation_id: conv1, p_client_request_id: RQ(41), p_body: "x" })).result === "not_found" && (await rpc("inbox_set_conversation_status", { p_actor_user_id: full, p_conversation_id: conv1, p_status: "closed" })) === "not_found" && (await rpc("inbox_mark_conversation_read", { p_actor_user_id: full, p_conversation_id: conv1 })) === "not_found");

// ============================================================ 4. media
const pmedia = (user, conv, rq, kind = "image", caption = "cap") => rpc("inbox_member_prepare_outbound_media", { p_actor_user_id: user, p_conversation_id: conv, p_client_request_id: rq, p_kind: kind, p_caption: caption });
res = await pmedia(full, conv1, RQ(50));
check("media: a member with inbox.media (+ reply + view) prepares a media message, attributed to them", res.result === "created" && (await row(res.message_id)).sent_by_user_id === full && res.to === "237600000001");
check("media: inbox.reply alone is not enough; media WITHOUT reply is refused; viewer / no-view / other org refused", (await pmedia(replier, conv1, RQ(51))).result === "not_found" && (await pmedia(mediaNoReply, conv1, RQ(52))).result === "not_found" && (await pmedia(viewer, conv1, RQ(53))).result === "not_found" && (await pmedia(noview, conv1, RQ(54))).result === "not_found" && (await pmedia(org2staff, conv1, RQ(55))).result === "not_found");
check("media: a replay by the same member returns the original row (no second message)", (await pmedia(full, conv1, RQ(50))).result === "existing" && (await q1(`select count(*)::int n from public.inbox_messages where client_request_id = '${RQ(50)}'`))[0].n === 1);
check("media: complete is creator-only and needs inbox.media", (await rpc("inbox_member_complete_outbound_media", { p_actor_user_id: replier, p_message_id: res.message_id, p_provider_message_id: "wamid.M1", p_media_id: "m1", p_mime_type: "image/png", p_filename: null, p_sha256: null })) === "not_found" && (await rpc("inbox_member_complete_outbound_media", { p_actor_user_id: full, p_message_id: res.message_id, p_provider_message_id: "wamid.M1", p_media_id: "m1", p_mime_type: "image/png", p_filename: null, p_sha256: null })) === "ok" && (await row(res.message_id)).status === "sent");

// ============================================================ 5. close / reopen and mark read
const setStatus = (user, conv, s) => rpc("inbox_member_set_conversation_status", { p_actor_user_id: user, p_conversation_id: conv, p_status: s });
const convStatus = async (c) => (await q1(`select status, unread_count from public.inbox_conversations where id = '${c}'`))[0];
check("close/reopen: staff with inbox.close can close and reopen (status lifecycle unchanged)", (await setStatus(closer, conv1b, "closed")) === "ok" && (await convStatus(conv1b)).status === "closed" && (await setStatus(closer, conv1b, "open")) === "ok" && (await convStatus(conv1b)).status === "open" && (await setStatus(closer, conv1b, "open")) === "noop");
check("close/reopen: without inbox.close (viewer, reply, no-view, inactive, other org) -> not_found, nothing changed", (await Promise.all([viewer, replier, noview, inactive, org2staff, stranger, freeStaff].map((u) => setStatus(u, conv1b, "closed")))).every((x) => x === "not_found") && (await convStatus(conv1b)).status === "open");
check("close/reopen: invalid status -> invalid", (await setStatus(closer, conv1b, "archived")) === "invalid");
const unreadBefore = (await convStatus(conv1)).unread_count;
check("mark read: without inbox.mark_read -> not_found and the count is untouched", (await rpc("inbox_member_mark_conversation_read", { p_actor_user_id: viewer, p_conversation_id: conv1 })) === "not_found" && (await rpc("inbox_member_mark_conversation_read", { p_actor_user_id: org2staff, p_conversation_id: conv1 })) === "not_found" && (await convStatus(conv1)).unread_count === unreadBefore && unreadBefore > 0);
check("mark read: with inbox.mark_read -> ok, count 0, repeat is a noop; other conversations untouched", (await rpc("inbox_member_mark_conversation_read", { p_actor_user_id: closer, p_conversation_id: conv1 })) === "ok" && (await convStatus(conv1)).unread_count === 0 && (await rpc("inbox_member_mark_conversation_read", { p_actor_user_id: closer, p_conversation_id: conv1 })) === "noop" && (await convStatus(convB)).unread_count > 0);

// ============================================================ 6. saved replies: create / edit yes, delete NEVER for staff
const saveReply = (user, prof, id, title, body) => rpc("inbox_member_saved_reply_save", { p_actor_user_id: user, p_profile_id: prof, p_reply_id: id, p_title: title, p_body: body });
res = await saveReply(full, prof1, null, "Opening hours", "We open at 9");
check("saved replies: staff with inbox.saved_replies can create", res.result === "created" && (await q1(`select count(*)::int n from public.inbox_saved_replies where profile_id = '${prof1}'`))[0].n === 2);
const srId = res.id;
check("saved replies: …and edit", (await saveReply(full, prof1, srId, "Opening hours", "We open at 8")).result === "updated" && (await q1(`select body from public.inbox_saved_replies where id = '${srId}'`))[0].body === "We open at 8");
check("saved replies: without the permission (viewer, reply, no-view, other org, stranger, forged profile) -> not_found", (await Promise.all([viewer, replier, noview, inactive, stranger].map((u) => saveReply(u, prof1, null, "x", "y")))).every((x) => x.result === "not_found") && (await saveReply(full, prof2, null, "x", "y")).result === "not_found" && (await saveReply(org2staff, prof1, null, "x", "y")).result === "not_found");
check("saved replies: the existing title / limit validation still applies to staff", (await saveReply(full, prof1, null, "opening HOURS", "dup")).result === "duplicate_title" && (await saveReply(full, prof1, null, "", "y")).result === "invalid");
check("saved replies: staff CANNOT delete — the delete function refuses a staff user id, and no member delete function exists", (await rpc("inbox_saved_reply_delete", { p_actor_user_id: full, p_profile_id: prof1, p_reply_id: srId })) === "not_found" && (await q1(`select count(*)::int n from pg_proc where proname like 'inbox\\_member\\_%delete%' or proname like '%member%delete%'`))[0].n === 0 && (await q1(`select 1 from public.inbox_saved_replies where id = '${srId}'`)).length === 1);
check("saved replies: the OWNER can still delete (owner-only)", (await rpc("inbox_saved_reply_delete", { p_actor_user_id: owner1, p_profile_id: prof1, p_reply_id: srId })) === "ok");

// ============================================================ 7. direct execution and owner-only surfaces
const execDenied = async (role, sql) => serial(async () => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch (e) { return /permission denied/i.test(String(e.message)); } finally { await db.exec("reset role"); } });
check("direct RPC: anon and authenticated cannot execute any member / actor function (service_role only)", (await Promise.all(["anon", "authenticated"].flatMap((role) => [
  `select public.inbox_member_prepare_outbound_text('${full}', '${conv1}', '${RQ(60)}', 'x')`, `select public.inbox_member_can('${full}', '${prof1}', 'inbox.view')`, `select public.inbox_actor_access('${full}', '${conv1}', 'inbox.view')`,
  `select public.inbox_member_workspaces('${full}')`, `select public.inbox_member_set_conversation_status('${full}', '${conv1}', 'closed')`, `select public.inbox_member_mark_conversation_read('${full}', '${conv1}')`,
  `select public.inbox_member_saved_reply_save('${full}', '${prof1}', null, 'a', 'b')`, `select public.inbox_member_complete_outbound('${full}', '${mid1}', 'w')`, `select public.inbox_member_fail_outbound('${full}', '${mid1}', '{}')`,
  `select public.inbox_member_prepare_outbound_media('${full}', '${conv1}', '${RQ(61)}', 'image', null)`].map((s) => execDenied(role, s))))).every(Boolean));
check("direct RPC: the only function a browser session may execute is the RLS helper inbox_staff_can_read, and it answers only about the caller", await (async () => { const a = await asUser(full, `select public.inbox_staff_can_read('${prof1}', 'inbox.view') as r`); const b = await asUser(full, `select public.inbox_staff_can_read('${prof2}', 'inbox.view') as r`); const c = await asUser(stranger, `select public.inbox_staff_can_read('${prof1}', 'inbox.view') as r`); return a.rows[0].r === true && b.rows[0].r === false && c.rows[0].r === false; })());
check("owner-only: the settings and automation functions have NO member variant and refuse a staff id", (await q1(`select count(*)::int n from pg_proc where proname in ('inbox_member_settings_save', 'inbox_member_settings', 'inbox_member_automation')`))[0].n === 0 && ((await rpc("inbox_settings_save", { p_actor_user_id: full, p_profile_id: prof1, p_settings: {} }))?.result ?? (await rpc("inbox_settings_save", { p_actor_user_id: full, p_profile_id: prof1, p_settings: {} }))) !== "saved");
check("owner-only: a staff user id cannot change the WhatsApp account (no write privilege, no staff policy)", (await asUser(full, `update public.wa_accounts set phone_number_id = 'x'`)).ok === false);

// ============================================================ 8. DELETION GUARANTEES (the critical part)
const del = async (user, table) => asUser(user, `delete from public.${table}`);
for (const t of ["inbox_messages", "inbox_conversations", "inbox_contacts", "inbox_message_media", "inbox_status_events"]) {
  const rs = await Promise.all([full, viewer, closer, replier, owner1].map((u) => del(u, t)));
  check(`delete: nobody with a session (staff, viewer, even the owner) can DELETE from ${t} (no privilege)`, rs.every((x) => x.ok === false && /permission denied/i.test(x.msg)), JSON.stringify(rs.map((x) => x.msg)));
}
check("delete: staff cannot UPDATE / INSERT history directly either (no write privilege on any history table)", (await asUser(full, `update public.inbox_messages set body = 'tampered'`)).ok === false && (await asUser(full, `insert into public.inbox_messages (profile_id, conversation_id, channel, direction, status) values ('${prof1}','${conv1}','whatsapp','inbound','received')`)).ok === false && (await asUser(full, `update public.inbox_conversations set unread_count = 0`)).ok === false);
check("delete: service_role itself has no DELETE privilege on the history tables either", (await Promise.all(["inbox_messages", "inbox_conversations", "inbox_contacts", "inbox_message_media", "inbox_status_events", "wa_accounts"].map((t) => execDenied("service_role", `delete from public.${t}`)))).every(Boolean));
check("delete: no staff DELETE policy exists anywhere in the Inbox schema (every Inbox policy is SELECT)", (await q1(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename like 'inbox\\_%' and cmd <> 'SELECT'`))[0].n === 0 && (await q1(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename like 'wa\\_%' and cmd <> 'SELECT'`))[0].n === 0);
check("delete: every staff / member / actor function is free of delete statements; the ONLY inbox_ function that deletes is the owner-only saved-reply delete", await (async () => { const fns = await q1(`select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (proname like 'inbox\\_%' or proname like 'team\\_%')`); const deleters = fns.filter((f) => /delete\s+from/i.test(f.prosrc)).map((f) => f.proname); const staff = fns.filter((f) => /^inbox_(member_|actor_|staff_)/.test(f.proname)); return staff.length >= 13 && staff.every((f) => !/delete|truncate|drop /i.test(f.prosrc)) && deleters.join() === "inbox_saved_reply_delete"; })());
check("delete: a staff-grantable delete permission cannot exist — the permission check recognises exactly seven names", await (async () => { const src = (await q1(`select prosrc from pg_proc where proname = 'inbox_member_can'`))[0].prosrc; return (src.match(/when 'inbox\.[a-z_]+'/g) || []).length === 7 && !/delet/i.test(src); })());
check("delete: a staff member (even with every Inbox permission) also cannot create a delete permission — the Team guard refuses writing inbox.* (incl. inbox.delete) to roles", await (async () => { await svc(`update public.organization_roles set permissions = permissions || '{staff.manage}' where id = '${R.full}'`); const a = await asUser(full, `update public.organization_roles set permissions = permissions || '{inbox.delete}' where id = '${R.full}'`); const b = await asUser(full, `insert into public.organization_roles (profile_id, key, name, permissions) values ('${prof1}','d','d','{inbox.delete_messages}')`); await svc(`update public.organization_roles set permissions = array_remove(permissions, 'staff.manage') where id = '${R.full}'`); return a.ok === false && b.ok === false; })());
check("history is intact after every attempt above (no message, conversation, contact lost)", (await q1(`select count(*)::int n from public.inbox_conversations`))[0].n >= 5 && (await q1(`select count(*)::int n from public.inbox_messages`))[0].n >= 7 && (await q1(`select count(*)::int n from public.inbox_contacts`))[0].n >= 5);

// ============================================================ 9. migration hygiene
const mig = read("supabase/migrations/2026-12-14_whatsapp_inbox_staff.sql").replace(/--.*$/gm, "");
check("migration: no table / column / index change, no delete / update statement of its own on history, no staff write policy", !/create table|alter table|create index|delete from|truncate|drop policy|drop function/i.test(mig) && (mig.match(/create policy|create policy %I|for select/gi) || []).length >= 1 && !/for (insert|update|delete|all)/i.test(mig) && (mig.match(/update public\.inbox_messages m set sent_by_user_id/g) || []).length === 2);
check("migration: every function pins search_path; execute is service_role only except the one RLS helper", (mig.match(/security definer\s+set search_path = public, pg_temp/g) || []).length === 13 && /grant execute on function public\.inbox_staff_can_read\(uuid, text\) to authenticated;/.test(mig) && (mig.match(/grant execute on function [^;]* to authenticated/g) || []).length === 1);
check("migration: nothing in it names or grants a delete permission", !/inbox\.delete|inbox\.remove|delete_messages|delete_conversations/i.test(mig));
check("preflight script: runs on the pre-migration database, 4 rows, every ok = true (prerequisites present, no new object yet)", preflightRows.length === 4 && preflightRows.every((x) => x.ok === true), preflightRows.filter((x) => x.ok !== true).map((x) => `${x.label} expect=${x.expect} actual=${x.actual}`).join(" ; "));
// the scripts run on the same database
const preflightFresh = new PGlite();
check("support scripts exist (preflight, verify, rollback) and are read-only where required", ["preflight", "verify"].every((k) => { const t = read(`supabase/support/2026-12-14_whatsapp_inbox_staff.${k}.sql`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, ""); return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(t); }) && fs.existsSync(path.join(REPO, "supabase/support/2026-12-14_whatsapp_inbox_staff.rollback.sql")));
await preflightFresh.close?.();
const verifyRows = (await db.query(read("supabase/support/2026-12-14_whatsapp_inbox_staff.verify.sql"))).rows;
check("verify script: runs against the migrated database, 14 rows, every ok = true", verifyRows.length === 14 && verifyRows.every((x) => x.ok === true), verifyRows.filter((x) => x.ok !== true).map((x) => `${x.label} expect=${x.expect} actual=${x.actual}`).join(" ; "));
const rb = read("supabase/support/2026-12-14_whatsapp_inbox_staff.rollback.sql");
await db.exec(rb);
check("rollback: removes the policies and the 13 functions and leaves every message, conversation and role intact", (await q1(`select count(*)::int n from pg_proc where proname like 'inbox\\_member\\_%' or proname in ('inbox_staff_can_read', 'inbox_actor_access', 'inbox_actor_relation')`))[0].n === 0 && (await q1(`select count(*)::int n from pg_policies where policyname like '% staff read'`))[0].n === 0 && (await q1(`select count(*)::int n from public.inbox_messages`))[0].n >= 7 && (await seen(owner1, "inbox_conversations")).rows.length >= 2 && (await seen(viewer, "inbox_conversations")).rows.length === 0);

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
