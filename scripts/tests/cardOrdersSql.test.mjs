// Paid card orders, DATABASE layer: the REAL Inbox + Team + staff migrations and the sales-bot migration, then 2026-12-25_card_orders.sql, its preflight, verify and rollback, on scratch
// in-memory PostgreSQL (PGlite). Nothing here connects to Supabase or any real database and nothing reads .env.local; the migration is only ever applied to this scratch database.
// Reads run as the `authenticated` role with RLS on; mutations run as `service_role` through the functions (the trusted server passes only the session user id).
// Covers: recording a paid order (derived from the sales-bot session, idempotent, validation), read isolation (owner / staff with inbox.view / everyone else), no direct writes, the
// permission matrix for marking completed (inbox.reply, Team gate, cross-organization), the transition rule (paid -> completed only, once), the audit events, the notification record,
// preflight / verify / rollback, and that the migration touches nothing of bookings, signup requests, payments or subscriptions.
//   Run:  node scripts/tests/cardOrdersSql.test.mjs
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
const owner1 = U(1), owner2 = U(2), viewer = U(4), replier = U(5), noview = U(6), inactive = U(7), removed = U(8), org2staff = U(9), stranger = U(10), freeOwner = U(11), freeStaff = U(12), other = U(15);
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
  insert into public.users (id, email, plan_id) values ${[owner1, owner2, viewer, replier, noview, inactive, removed, org2staff, stranger, freeStaff, other].map((u) => `('${u}', '${u}@x.test', '${planFree}')`).join(", ")}, ('${freeOwner}', 'f@x.test', '${planFree}');
  update public.users set plan_id = '${planBiz}' where id in ('${owner1}', '${owner2}');
  insert into public.profiles values ('${prof1}','${owner1}','owner1'), ('${prof2}','${owner2}','owner2'), ('${profFree}','${freeOwner}','freeowner');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-12_whatsapp_inbox_mark_read", "2026-12-13_whatsapp_inbox_team_permission_guard", "2026-12-14_whatsapp_inbox_staff", "2026-12-19_whatsapp_sales_bot"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);
await db.exec(`revoke all on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events, public.inbox_saved_replies, public.inbox_settings, public.inbox_conversation_state from anon, authenticated, service_role;
  grant select on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages, public.inbox_message_media, public.inbox_status_events to authenticated, service_role;
  grant select on public.inbox_saved_replies to authenticated, service_role;`);

const PH1 = "1110000000001", PH2 = "9990000000001", PH3 = "7770000000001";
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${prof1}', '${PH1}', '1110000000002'), ('${prof2}', '${PH2}', '9990000000002'), ('${profFree}', '${PH3}', '7770000000002')`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', ${sq(o.text ?? "hi")}, ${sq(o.name)}, null, null, null, null, null, null, null)`);
const WA = { c1: "237600000001", c1b: "237600000002", c1c: "237600000003", cB: "237611111111", cF: "237622222222" };
await ingest({ phone: PH1, id: "wamid.A1", from: WA.c1, ts: hoursAgo(1), name: "Customer One", text: "Hello org one" });
await ingest({ phone: PH1, id: "wamid.A2", from: WA.c1b, ts: hoursAgo(2), name: "Customer Two", text: "Second" });
await ingest({ phone: PH1, id: "wamid.A3", from: WA.c1c, ts: hoursAgo(3), name: "Customer Three", text: "Third" });
await ingest({ phone: PH2, id: "wamid.B1", from: WA.cB, ts: hoursAgo(1), name: "Bob Customer", text: "ORG TWO" });
await ingest({ phone: PH3, id: "wamid.F1", from: WA.cF, ts: hoursAgo(1), name: "Free Customer", text: "free org" });
const q1 = async (sql) => (await db.query(sql)).rows;
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf(WA.c1), conv1b = await convOf(WA.c1b), conv1c = await convOf(WA.c1c), convB = await convOf(WA.cB), convF = await convOf(WA.cF);

const role = (id, prof, key, perms) => `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${id}','${prof}','${key}','${key}','{${perms}}')`;
const R = { viewer: RID(2), reply: RID(3), noview: RID(4), other: RID(8), org2: RID(9), none: RID(10) };
await db.exec([
  role(R.viewer, prof1, "viewer", "inbox.view"), role(R.reply, prof1, "reply", "inbox.view,inbox.reply"), role(R.noview, prof1, "noview", "inbox.reply"),
  role(R.other, prof1, "ordinary", "orders.view"), role(R.org2, prof2, "org2full", "inbox.view,inbox.reply"),
].join("; "));
const member = (id, prof, user, roleId, status = "active") => `insert into public.organization_members (id, profile_id, user_id, role_id, status) values ('${id}','${prof}','${user}','${roleId}','${status}')`;
await db.exec([
  member(MID(2), prof1, viewer, R.viewer), member(MID(3), prof1, replier, R.reply), member(MID(4), prof1, noview, R.noview),
  member(MID(5), prof1, inactive, R.reply, "inactive"), member(MID(6), prof1, removed, R.reply, "removed"), member(MID(7), prof2, org2staff, R.org2), member(MID(10), prof1, other, R.other),
].join("; "));
await db.exec(`${role(R.none, profFree, "freefull", "inbox.view,inbox.reply")}; ${member(MID(11), profFree, freeStaff, R.none)}`);

let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => undefined, () => undefined); return p; };
const svc = (sql) => serial(async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } });
const svcTry = (sql) => serial(async () => { await db.exec("set role service_role"); try { await db.query(sql); return { ok: true }; } catch (e) { return { ok: false, code: e.code, msg: String(e.message) }; } finally { await db.exec("reset role"); } });
const rpc = async (fn, args) => (await svc(`select public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ")}) as r`)).rows[0].r;
const asRole = (role_, user, sql) => serial(async () => {
  await db.exec(`set role ${role_}; select set_config('request.jwt.claim.sub', '${user || ""}', false)`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, code: e.code, msg: String(e.message) }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)"); }
});
const asUser = (user, sql) => asRole("authenticated", user, sql);

// ============================================================ the preflight, on the database as it is BEFORE the migration
const preflight = (await db.query(read("supabase/support/2026-12-25_card_orders.preflight.sql"))).rows;
check("preflight: every prerequisite exists and none of the new objects exist yet (every row ok)", preflight.length === 5 && preflight.every((r) => r.ok === true), JSON.stringify(preflight.filter((r) => !r.ok)));

const MIGRATION = read("supabase/migrations/2026-12-25_card_orders.sql");
await db.exec(MIGRATION);
const verify = (await db.query(read("supabase/support/2026-12-25_card_orders.verify.sql"))).rows;
check("verify: after the migration every row is ok (functions, definer + search_path, grants, RLS, policies, unique signup request, composite key, permission re-check, derived conversation, no payment / plan reference)", verify.length >= 15 && verify.every((r) => r.ok === true), JSON.stringify(verify.filter((r) => !r.ok)));
await db.exec(MIGRATION);
check("the migration is idempotent: applying it a second time changes nothing (still 4 policies, 4 functions, no error)", (await q1(`select count(*)::int n from pg_policies where tablename in ('card_orders','card_order_events')`))[0].n === 4 && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_order\\_%'`))[0].n === 4);

// the sales-bot sessions the payment hook finds by signup request (inserted directly, as the bot's own save function would)
const S1 = "f1000000-0000-4000-8000-000000000001", S2 = "f1000000-0000-4000-8000-000000000002", S3 = "f1000000-0000-4000-8000-000000000003", SNONE = "f1000000-0000-4000-8000-0000000000ff";
await db.exec(`insert into public.wa_sales_sessions (conversation_id, profile_id, state, data, signup_request_id) values
  ('${conv1}', '${prof1}', 'PAYMENT', '{"lang":"fr","tier":"pro"}'::jsonb, '${S1}'),
  ('${conv1b}', '${prof1}', 'PAYMENT', '{"lang":"en","tier":"weird"}'::jsonb, '${S2}'),
  ('${convB}', '${prof2}', 'PAYMENT', '{"lang":"en","tier":"premium"}'::jsonb, '${S3}')`);

// ============================================================ recording a paid order (the payment hook)
const rec = (sr, o = {}) => rpc("card_order_record_paid", { p_signup_request_id: sr, p_name: "Jean Mbah", p_place: "Akwa, Douala", p_amount: 5000, ...o });
const o1 = await rec(S1);
const row1 = (await q1(`select * from public.card_orders where id = '${o1.id}'`))[0];
check("record: a paid order is stored PAID, and the organization, conversation, WhatsApp number, card and language are all derived from the linked sales-bot session (never supplied)", o1.result === "created" && o1.status === "paid" && row1.profile_id === prof1 && row1.conversation_id === conv1 && row1.customer_phone === WA.c1 && row1.card_tier === "pro" && row1.lang === "fr" && row1.amount_xaf === 5000 && row1.delivery_place === "Akwa, Douala" && row1.customer_name === "Jean Mbah" && row1.status === "paid" && row1.completed_at === null, JSON.stringify(row1));
check("record: the first audit event is written (system, nothing -> paid, no user)", JSON.stringify(await q1(`select actor_kind, actor_user_id, from_status, to_status from public.card_order_events where order_id = '${o1.id}'`)) === JSON.stringify([{ actor_kind: "system", actor_user_id: null, from_status: null, to_status: "paid" }]));
const again = await rec(S1);
check("record: IDEMPOTENT: the same signup request again (a payment-confirmed retry) returns the existing order, stores nothing new and writes no second event", again.result === "exists" && again.id === o1.id && (await q1(`select count(*)::int n from public.card_orders where signup_request_id = '${S1}'`))[0].n === 1 && (await q1(`select count(*)::int n from public.card_order_events where order_id = '${o1.id}'`))[0].n === 1);
const parallel = await Promise.all([rec(S2), rec(S2), rec(S2)]);
check("record: three simultaneous confirmations produce exactly one order and one 'created'", parallel.filter((x) => x.result === "created").length === 1 && parallel.filter((x) => x.result === "exists").length === 2 && (await q1(`select count(*)::int n from public.card_orders where signup_request_id = '${S2}'`))[0].n === 1);
const o2 = (await q1(`select * from public.card_orders where signup_request_id = '${S2}'`))[0];
check("record: an unknown card in the session is stored as no card (never an invented one), and the language defaults to English", o2.card_tier === null && o2.lang === "en");
check("record: a signup request that did not come from the bot, a missing id and a negative amount are refused without storing anything", (await rec(SNONE)).result === "none" && (await rpc("card_order_record_paid", { p_signup_request_id: null, p_name: "x", p_place: null, p_amount: 1 })).result === "none" && (await rec(S3, { p_amount: -5 })).result === "invalid" && (await q1(`select count(*)::int n from public.card_orders where signup_request_id in ('${SNONE}','${S3}')`))[0].n === 0);
const o3 = await rec(S3, { p_name: "   ", p_place: "  \u0001  ", p_amount: null });
const row3 = (await q1(`select * from public.card_orders where id = '${o3.id}'`))[0];
check("record: a blank name is stored as '-', a control-character place as nothing, and an unknown amount as null (the order is still filed)", o3.result === "created" && row3.customer_name === "-" && row3.delivery_place === null && row3.amount_xaf === null);
check("record: an unknown signup request id stays unrecorded (no session, no order)", (await q1(`select count(*)::int n from public.card_orders`))[0].n === 3);

// ============================================================ who can read
const readIds = async (user) => { const r = await asUser(user, `select id from public.card_orders`); return r.ok ? r.rows.length : -1; };
check("read: the owner and a team member with inbox.view see their own organization's paid orders; a member without inbox.view, another organization's owner, a stranger and anon see none", await readIds(owner1) === 2 && await readIds(viewer) === 2 && await readIds(replier) === 2 && await readIds(noview) === 0 && await readIds(owner2) === 1 && await readIds(stranger) === 0 && (await asRole("anon", "", `select id from public.card_orders`)).ok === false);
check("read: a team member on a plan without Team access sees nothing, and the audit events follow the same rule", await readIds(freeStaff) === 0 && (await asUser(owner1, `select id from public.card_order_events`)).rows.length === 2 && (await asUser(noview, `select id from public.card_order_events`)).rows.length === 0 && (await asUser(owner2, `select id from public.card_order_events where order_id = '${o1.id}'`)).rows.length === 0);
const w = async (user, sql) => (await asUser(user, sql)).ok;
check("no direct writes: no API role can insert, update or delete an order or an event (the owner included); service_role has no table privilege either", !(await w(owner1, `update public.card_orders set status = 'completed' where id = '${o1.id}'`)) && !(await w(owner1, `delete from public.card_orders where id = '${o1.id}'`)) && !(await w(owner1, `insert into public.card_orders (profile_id, conversation_id, signup_request_id, customer_name, customer_phone) values ('${prof1}', '${conv1c}', '${SNONE}', 'x', '123456')`)) && !(await w(owner1, `insert into public.card_order_events (order_id, actor_kind, to_status) values ('${o1.id}', 'owner', 'completed')`)) && !(await svcTry(`update public.card_orders set status = 'completed'`)).ok && !(await svcTry(`select * from public.card_orders`)).ok);
check("no direct execution: anon and authenticated cannot call any of the four functions", (await asRole("authenticated", owner1, `select public.card_order_set_status('${owner1}', '${o1.id}', 'completed', null)`)).ok === false && (await asRole("anon", "", `select public.card_order_record_paid('${S1}', 'x', null, 1)`)).ok === false);

// ============================================================ marking completed
const setS = (actor, id, to = "completed", details = null) => rpc("card_order_set_status", { p_actor_user_id: actor, p_order_id: id, p_to: to, p_details: details });
const loc = await rpc("card_order_locate", { p_order_id: o1.id });
check("locate: returns only the conversation and organization of the order; an unknown or missing id is not_found", loc.result === "ok" && loc.conversation_id === conv1 && loc.profile_id === prof1 && Object.keys(loc).sort().join() === "conversation_id,profile_id,result" && (await rpc("card_order_locate", { p_order_id: SNONE })).result === "not_found" && (await rpc("card_order_locate", { p_order_id: null })).result === "not_found");
check("permissions: a viewer (inbox.view only) and a member without inbox.reply are forbidden; another organization's owner, a stranger, an inactive and a removed member and a free-plan organization's staff cannot even see the order (not_found / forbidden), and nothing changes", (await setS(viewer, o1.id)).result === "forbidden" && (await setS(noview, o1.id)).result === "forbidden" && ["not_found", "forbidden"].includes((await setS(owner2, o1.id)).result) && ["not_found", "forbidden"].includes((await setS(stranger, o1.id)).result) && ["not_found", "forbidden"].includes((await setS(inactive, o1.id)).result) && ["not_found", "forbidden"].includes((await setS(removed, o1.id)).result) && ["not_found", "forbidden"].includes((await setS(freeStaff, o1.id)).result) && (await q1(`select status from public.card_orders where id = '${o1.id}'`))[0].status === "paid" && (await q1(`select count(*)::int n from public.card_order_events where order_id = '${o1.id}'`))[0].n === 1);
check("input: only 'completed' is accepted, a 301-letter note is refused, a missing actor or order is not_found", (await setS(owner1, o1.id, "paid")).result === "invalid" && (await setS(owner1, o1.id, "cancelled")).result === "invalid" && (await setS(owner1, o1.id, null)).result === "invalid" && (await setS(owner1, o1.id, "completed", "x".repeat(301))).result === "invalid" && (await setS(null, o1.id)).result === "not_found" && (await setS(owner1, null)).result === "not_found" && (await q1(`select status from public.card_orders where id = '${o1.id}'`))[0].status === "paid");
// a notification outcome recorded before the change must be cleared by the change
check("notify: an outcome can be recorded by the owner or a replier; a viewer, a stranger and a bad outcome are refused", (await rpc("card_order_record_notify", { p_actor_user_id: owner1, p_order_id: o1.id, p_outcome: "failed" })) === "ok" && (await rpc("card_order_record_notify", { p_actor_user_id: viewer, p_order_id: o1.id, p_outcome: "sent" })) === "not_found" && (await rpc("card_order_record_notify", { p_actor_user_id: stranger, p_order_id: o1.id, p_outcome: "sent" })) === "not_found" && (await rpc("card_order_record_notify", { p_actor_user_id: owner1, p_order_id: o1.id, p_outcome: "delivered" })) === "invalid" && (await rpc("card_order_record_notify", { p_actor_user_id: owner1, p_order_id: SNONE, p_outcome: "sent" })) === "not_found");
const done = await setS(owner1, o1.id, "completed", "  Delivered to the customer  ");
const after = (await q1(`select status, completed_by, completed_at, completion_details, customer_notify_status, customer_notified_at from public.card_orders where id = '${o1.id}'`))[0];
check("complete: the owner marks a paid order completed: the change is stored with who and when and the trimmed note, the earlier notification outcome is cleared in the same statement, and the result carries the language and name the thank-you needs", done.result === "ok" && done.status === "completed" && done.from === "paid" && done.lang === "fr" && done.customer_name === "Jean Mbah" && after.status === "completed" && after.completed_by === owner1 && after.completed_at !== null && after.completion_details === "Delivered to the customer" && after.customer_notify_status === null && after.customer_notified_at === null);
check("complete: the audit event records the real actor kind (owner) and the status before and after", JSON.stringify((await q1(`select actor_kind, actor_user_id, from_status, to_status, note from public.card_order_events where order_id = '${o1.id}' order by created_at, id`)).slice(-1)) === JSON.stringify([{ actor_kind: "owner", actor_user_id: owner1, from_status: "paid", to_status: "completed", note: "Delivered to the customer" }]));
check("notify: after the change the outcome is recorded again ('sent' sets the time, 'window_closed' clears it)", (await rpc("card_order_record_notify", { p_actor_user_id: owner1, p_order_id: o1.id, p_outcome: "sent" })) === "ok" && (await q1(`select customer_notify_status s, customer_notified_at t from public.card_orders where id = '${o1.id}'`))[0].s === "sent" && (await q1(`select customer_notified_at t from public.card_orders where id = '${o1.id}'`))[0].t !== null && (await rpc("card_order_record_notify", { p_actor_user_id: replier, p_order_id: o1.id, p_outcome: "window_closed" })) === "ok" && (await q1(`select customer_notified_at t from public.card_orders where id = '${o1.id}'`))[0].t === null);
await rpc("card_order_record_notify", { p_actor_user_id: owner1, p_order_id: o1.id, p_outcome: "sent" });
const dup = await setS(owner1, o1.id);
check("complete: asking again is a no-op: nothing changes (not even the stored notification outcome), no second event, no second thank-you can be triggered from it", dup.result === "noop" && dup.status === "completed" && (await q1(`select customer_notify_status s from public.card_orders where id = '${o1.id}'`))[0].s === "sent" && (await q1(`select count(*)::int n from public.card_order_events where order_id = '${o1.id}'`))[0].n === 2);
const stf = await setS(replier, o2.id, "completed");
check("complete: a team member with inbox.reply can do it too and the event says staff; completed is final (it can never go back to paid)", stf.result === "ok" && (await q1(`select actor_kind from public.card_order_events where order_id = '${o2.id}' order by created_at, id`)).slice(-1)[0].actor_kind === "staff" && (await setS(owner1, o2.id, "paid")).result === "invalid");
const race = await Promise.all([setS(owner2, o3.id), setS(org2staff, o3.id), setS(owner2, o3.id)]);
check("complete: three simultaneous clicks change it exactly once (one ok, two no-ops) and write exactly one event", race.filter((x) => x.result === "ok").length === 1 && race.filter((x) => x.result === "noop").length === 2 && (await q1(`select count(*)::int n from public.card_order_events where order_id = '${o3.id}' and to_status = 'completed'`))[0].n === 1);

// ============================================================ isolation from everything else
const fnSrc = (await q1(`select string_agg(prosrc, E'\\n') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'card\\_order\\_%'`))[0].s;
check("isolation: no function touches bookings, signup requests, payments, plans, add-ons or subscriptions: a paid-orders row can never change what was paid or what the customer owns", !/bookings|signup_requests|payment|subscription|plans\b|addons|customer_paid|card_appointments/i.test(fnSrc));
check("isolation: the migration file creates or alters nothing outside its two tables and four functions", !/\b(alter table|drop table|create table)\b(?![^;]*card_order)/i.test(MIGRATION.replace(/--.*$/gm, "")) && !/\balter table public\.(?!card_order)/i.test(MIGRATION.replace(/--.*$/gm, "")) && !/\bdrop (function|policy|index|trigger)\b/i.test(MIGRATION.replace(/--.*$/gm, "")));

// ============================================================ rollback
const messagesBefore = (await q1(`select count(*)::int n from public.inbox_messages`))[0].n, convsBefore = (await q1(`select count(*)::int n from public.inbox_conversations`))[0].n, sessionsBefore = (await q1(`select count(*)::int n from public.wa_sales_sessions`))[0].n;
const rb = read("supabase/support/2026-12-25_card_orders.rollback.sql");
await db.exec(rb);
check("rollback: removes the two tables and the four functions and leaves every message, conversation and sales-bot session intact", (await q1(`select count(*)::int n from pg_tables where tablename in ('card_orders','card_order_events')`))[0].n === 0 && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_order\\_%'`))[0].n === 0 && (await q1(`select count(*)::int n from public.inbox_messages`))[0].n === messagesBefore && (await q1(`select count(*)::int n from public.inbox_conversations`))[0].n === convsBefore && (await q1(`select count(*)::int n from public.wa_sales_sessions`))[0].n === sessionsBefore);
check("rollback: is safe to run twice, and the migration can be applied again afterwards", await db.exec(rb).then(() => true, () => false) && await db.exec(MIGRATION).then(() => true, () => false) && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_order\\_%'`))[0].n === 4);

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
