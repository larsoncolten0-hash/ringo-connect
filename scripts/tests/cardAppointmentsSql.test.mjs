// Card appointments, DATABASE layer: the REAL Inbox + Team + staff migrations, then 2026-12-23_card_appointments.sql, its preflight, verify and rollback, on scratch in-memory
// PostgreSQL (PGlite). Nothing here connects to Supabase or any real database and nothing reads .env.local; the migration is only ever applied to this scratch database.
// Reads run as the `authenticated` role with RLS on; mutations run as `service_role` through the functions (the trusted server passes only the session user id).
// Covers: creation + validation + the verified-number rule, idempotency, one open request per conversation, read isolation (owner / staff with inbox.view / everyone else),
// no direct writes, the permission matrix for confirm / decline / cancel (inbox.reply, Team gate, cross-organization, forged ids), the transition rules, the audit events,
// the notification record, preflight / verify / rollback, and that the migration touches nothing of bookings, signup, payment or subscription.
//   Run:  node scripts/tests/cardAppointmentsSql.test.mjs
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
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-12_whatsapp_inbox_mark_read", "2026-12-13_whatsapp_inbox_team_permission_guard", "2026-12-14_whatsapp_inbox_staff"]) await db.exec(read(`supabase/migrations/${m}.sql`));
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
const preflight = (await db.query(read("supabase/support/2026-12-23_card_appointments.preflight.sql"))).rows;
check("preflight: every prerequisite exists and none of the new objects exist yet (every row ok)", preflight.length === 5 && preflight.every((r) => r.ok === true), JSON.stringify(preflight.filter((r) => !r.ok)));

const MIGRATION = read("supabase/migrations/2026-12-23_card_appointments.sql");
await db.exec(MIGRATION);
const verify = (await db.query(read("supabase/support/2026-12-23_card_appointments.verify.sql"))).rows;
check("verify: after the migration every row is ok (functions, definer + search_path, grants, RLS, policies, index, composite key, permission re-check, verified number, no bookings / payment / plan reference)", verify.length >= 15 && verify.every((r) => r.ok === true), JSON.stringify(verify.filter((r) => !r.ok)));
await db.exec(MIGRATION);
check("the migration is idempotent: applying it a second time changes nothing (still 4 policies, 5 functions, no error)", (await q1(`select count(*)::int n from pg_policies where tablename in ('card_appointments','card_appointment_events')`))[0].n === 4 && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_appt\\_%'`))[0].n === 5);

// ============================================================ creating a request (the bot)
const mk = (conv, wa, o = {}) => rpc("card_appt_create", { p_conversation_id: conv, p_name: "Jean Mbah", p_phone: wa, p_time: "Saturday 10am", p_place: "Akwa, near the Total station", p_note: null, p_lang: "en", ...o });
const c1 = await mk(conv1, WA.c1, { p_note: "  Please call first  " });
const row1 = (await q1(`select * from public.card_appointments where id = '${c1.id}'`))[0];
check("create: a valid request is stored PENDING for the conversation's own organization, with the verified number, the trimmed note and the language, and the profile is derived (never supplied)", c1.result === "created" && c1.status === "pending" && c1.profile_id === prof1 && row1.status === "pending" && row1.profile_id === prof1 && row1.customer_phone === WA.c1 && row1.note === "Please call first" && row1.lang === "en" && row1.decided_by === null && row1.decided_at === null);
check("create: the first audit event is written (customer, nothing -> pending, no user)", JSON.stringify(await q1(`select actor_kind, actor_user_id, from_status, to_status from public.card_appointment_events where appointment_id = '${c1.id}'`)) === JSON.stringify([{ actor_kind: "customer", actor_user_id: null, from_status: null, to_status: "pending" }]));
const again = await mk(conv1, WA.c1);
check("create: IDEMPOTENT: the same conversation again returns the existing open request (same id), stores nothing new, writes no second event", again.result === "exists" && again.id === c1.id && again.status === "pending" && (await q1(`select count(*)::int n from public.card_appointments where conversation_id = '${conv1}'`))[0].n === 1 && (await q1(`select count(*)::int n from public.card_appointment_events where appointment_id = '${c1.id}'`))[0].n === 1);
const parallel = await Promise.all([mk(conv1b, WA.c1b), mk(conv1b, WA.c1b), mk(conv1b, WA.c1b)]);
check("create: three simultaneous submissions (a webhook retry storm) produce exactly one request and one 'created'", parallel.filter((x) => x.result === "created").length === 1 && parallel.filter((x) => x.result === "exists").length === 2 && (await q1(`select count(*)::int n from public.card_appointments where conversation_id = '${conv1b}'`))[0].n === 1);
const before = (await q1(`select count(*)::int n from public.card_appointments`))[0].n;
const bad = {
  "a number that is not the conversation's verified WhatsApp number": await mk(convB, "237699999999"),
  "no phone": await mk(convB, null),
  "a one-letter name": await mk(convB, WA.cB, { p_name: "J" }),
  "an 81-letter name": await mk(convB, WA.cB, { p_name: "x".repeat(81) }),
  "a 2-letter time": await mk(convB, WA.cB, { p_time: "ab" }),
  "an 81-letter time": await mk(convB, WA.cB, { p_time: "x".repeat(81) }),
  "a 2-letter place": await mk(convB, WA.cB, { p_place: "ab" }),
  "a 161-letter place": await mk(convB, WA.cB, { p_place: "x".repeat(161) }),
  "a 201-letter note": await mk(convB, WA.cB, { p_note: "x".repeat(201) }),
  "a control-character-only name": await mk(convB, WA.cB, { p_name: "\u0001\u0002\u0003" }),
  "no conversation": await mk(null, WA.cB),
};
check("create: every invalid input is refused server-side and stores nothing", Object.entries(bad).every(([, v]) => v.result === "invalid") && (await q1(`select count(*)::int n from public.card_appointments`))[0].n === before, JSON.stringify(Object.entries(bad).filter(([, v]) => v.result !== "invalid").map(([k]) => k)));
check("create: an unknown conversation is skipped", (await mk("00000000-0000-4000-8000-000000000999", WA.cB)).result === "skip");
const cB = await mk(convB, WA.cB, { p_lang: "xx", p_note: "   ", p_name: "Bob\u0007 Customer" });
const rowB = (await q1(`select * from public.card_appointments where id = '${cB.id}'`))[0];
check("create: an unknown language becomes 'en', a blank note becomes null, control characters are replaced, and another organization gets its own organization id", cB.result === "created" && rowB.lang === "en" && rowB.note === null && rowB.customer_name === "Bob Customer" && rowB.profile_id === prof2);

// ============================================================ reading (RLS): owner + staff with inbox.view only
const seen = async (user) => { const r = await asUser(user, `select id from public.card_appointments order by created_at`); return r.ok ? r.rows.map((x) => x.id).sort() : null; };
const ids1 = [c1.id, parallel.find((x) => x.result === "created").id].sort();
check("read: the owner sees exactly their organization's requests", JSON.stringify(await seen(owner1)) === JSON.stringify(ids1));
check("read: a team member with inbox.view (and one with view + reply) sees the same", JSON.stringify(await seen(viewer)) === JSON.stringify(ids1) && JSON.stringify(await seen(replier)) === JSON.stringify(ids1));
check("read: nobody else sees any: a role without inbox.view, a role without any inbox permission, an inactive or removed member, a stranger, the other organization's owner and staff, a free-plan organization's staff (Team gate)", (await Promise.all([noview, other, inactive, removed, stranger, freeStaff].map(seen))).every((x) => Array.isArray(x) && x.length === 0) && JSON.stringify(await seen(owner2)) === JSON.stringify([cB.id]) && JSON.stringify(await seen(org2staff)) === JSON.stringify([cB.id]));
check("read: the audit events follow the same rule (owner and viewer see them, a stranger and the other organization see none of this organization's)", (await asUser(owner1, `select count(*)::int n from public.card_appointment_events`)).rows[0].n === 2 && (await asUser(viewer, `select count(*)::int n from public.card_appointment_events`)).rows[0].n === 2 && (await asUser(stranger, `select count(*)::int n from public.card_appointment_events`)).rows[0].n === 0 && (await asUser(org2staff, `select count(*)::int n from public.card_appointment_events where appointment_id = '${c1.id}'`)).rows[0].n === 0);
check("read: an anonymous visitor can read nothing (no privilege)", (await asRole("anon", "", `select id from public.card_appointments`)).ok === false);

// ============================================================ no direct writes, no direct function calls from the browser
const insertSql = `insert into public.card_appointments (profile_id, conversation_id, customer_name, customer_phone, preferred_time, meeting_place) values ('${prof1}', '${conv1}', 'Mallory', '${WA.c1}', 'now now', 'here here')`;
check("write: no API role can insert, update or delete a request or an event directly (owner, staff, anonymous and service_role alike)", (await Promise.all([
  asUser(owner1, insertSql), asUser(replier, insertSql), asRole("anon", "", insertSql), svcTry(insertSql),
  asUser(owner1, `update public.card_appointments set status = 'confirmed' where id = '${c1.id}'`), asUser(replier, `update public.card_appointments set status = 'confirmed' where id = '${c1.id}'`), svcTry(`update public.card_appointments set status = 'confirmed' where id = '${c1.id}'`),
  asUser(owner1, `delete from public.card_appointments where id = '${c1.id}'`), svcTry(`delete from public.card_appointments where id = '${c1.id}'`),
  asUser(owner1, `delete from public.card_appointment_events`), svcTry(`insert into public.card_appointment_events (appointment_id, actor_kind, to_status) values ('${c1.id}', 'staff', 'confirmed')`),
])).every((r) => r.ok === false || r.count === 0) && (await q1(`select status from public.card_appointments where id = '${c1.id}'`))[0].status === "pending");
check("write: a signed-in browser cannot call any of the functions (owner or staff), only the trusted server (service_role) can", (await Promise.all([
  asUser(owner1, `select public.card_appt_set_status('${owner1}', '${c1.id}', 'confirmed', null)`), asUser(replier, `select public.card_appt_create('${conv1}', 'X Y', '${WA.c1}', 'abc', 'abc', null, 'en')`),
  asUser(owner1, `select public.card_appt_status('${conv1}')`), asUser(owner1, `select public.card_appt_locate('${c1.id}')`), asUser(owner1, `select public.card_appt_record_notify('${owner1}', '${c1.id}', 'sent')`),
  asRole("anon", "", `select public.card_appt_status('${conv1}')`),
])).every((r) => r.ok === false));
check("write: one open request per conversation holds even for a direct insert by a superuser (partial unique index), and a request cannot point at another organization's conversation (composite key)", await (async () => { const a = await db.exec(insertSql).then(() => "inserted", () => "refused"); const b = await db.exec(`insert into public.card_appointments (profile_id, conversation_id, customer_name, customer_phone, preferred_time, meeting_place) values ('${prof2}', '${conv1b}', 'Mallory', '${WA.c1b}', 'now now', 'here here')`).then(() => "inserted", () => "refused"); return a === "refused" && b === "refused"; })());

// ============================================================ status, locate
const st1 = await rpc("card_appt_status", { p_conversation_id: conv1 });
check("status: the newest request and whether it is still open; 'none' for a conversation without one", st1.result === "ok" && st1.status === "pending" && st1.open === true && st1.id === c1.id && (await rpc("card_appt_status", { p_conversation_id: convF })).result === "none" && (await rpc("card_appt_status", { p_conversation_id: null })).result === "none");
check("locate: returns the conversation and organization of an appointment; unknown or null is not_found", (await rpc("card_appt_locate", { p_appointment_id: c1.id })).conversation_id === conv1 && (await rpc("card_appt_locate", { p_appointment_id: c1.id })).profile_id === prof1 && (await rpc("card_appt_locate", { p_appointment_id: "00000000-0000-4000-8000-000000000999" })).result === "not_found" && (await rpc("card_appt_locate", { p_appointment_id: null })).result === "not_found");

// ============================================================ confirm / decline / cancel: who may, and what changes
const setS = (actor, id, to, details = null) => rpc("card_appt_set_status", { p_actor_user_id: actor, p_appointment_id: id, p_to: to, p_details: details });
const statusOf = async (id) => (await q1(`select status from public.card_appointments where id = '${id}'`))[0].status;
const denied = [
  ["a view-only member (inbox.view)", await setS(viewer, c1.id, "confirmed")],
  ["a member without inbox.view (reply alone is not enough: the permission depends on view)", await setS(noview, c1.id, "confirmed")],
  ["a member with no inbox permission", await setS(other, c1.id, "confirmed")],
  ["an inactive member", await setS(inactive, c1.id, "confirmed")],
  ["a removed member", await setS(removed, c1.id, "confirmed")],
  ["a stranger", await setS(stranger, c1.id, "confirmed")],
  ["the OTHER organization's owner", await setS(owner2, c1.id, "confirmed")],
  ["the OTHER organization's staff with inbox.reply", await setS(org2staff, c1.id, "confirmed")],
  ["no actor", await setS(null, c1.id, "confirmed")],
];
check("confirm: every unauthorized actor is refused and the request stays pending", denied.every(([, r]) => ["forbidden", "not_found"].includes(r.result)) && (await statusOf(c1.id)) === "pending" && (await q1(`select count(*)::int n from public.card_appointment_events where appointment_id = '${c1.id}'`))[0].n === 1, JSON.stringify(denied.map(([k, r]) => [k, r.result])));
check("confirm: a member holding inbox.view but not inbox.reply gets 'forbidden', a non-member gets 'not_found' (indistinguishable from a missing request)", denied[0][1].result === "forbidden" && denied[2][1].result === "forbidden" && denied[5][1].result === "not_found" && denied[6][1].result === "not_found" && denied[7][1].result === "not_found");
check("confirm: a staff member of an organization whose plan has no Team Management is refused even with the permission (Team gate)", (await setS(freeStaff, (await mk(convF, WA.cF)).id, "confirmed")).result === "not_found");
check("confirm: bad requests are refused: unknown request, a made-up status, 'pending' as a target, details over 300 characters", (await setS(owner1, "00000000-0000-4000-8000-000000000999", "confirmed")).result === "not_found" && (await setS(owner1, c1.id, "activated")).result === "invalid" && (await setS(owner1, c1.id, "pending")).result === "invalid" && (await setS(owner1, c1.id, null)).result === "invalid" && (await setS(owner1, c1.id, "confirmed", "x".repeat(301))).result === "invalid" && (await statusOf(c1.id)) === "pending");
const ok1 = await setS(replier, c1.id, "confirmed", "  Saturday 10:30, Akwa, ask for Paul  ");
const after1 = (await q1(`select * from public.card_appointments where id = '${c1.id}'`))[0];
check("confirm: a team member with inbox.reply confirms: status, who, when and the details are recorded, and the reply carries what the bot needs (conversation, organization, language)", ok1.result === "ok" && ok1.status === "confirmed" && ok1.from === "pending" && ok1.conversation_id === conv1 && ok1.profile_id === prof1 && ok1.lang === "en" && after1.status === "confirmed" && after1.decided_by === replier && after1.decided_at !== null && after1.decision_details === "Saturday 10:30, Akwa, ask for Paul");
check("confirm: the audit event names the REAL staff member, the change and the details", JSON.stringify((await q1(`select actor_kind, actor_user_id, from_status, to_status, note from public.card_appointment_events where appointment_id = '${c1.id}' order by created_at, to_status`)).slice(-1)) === JSON.stringify([{ actor_kind: "staff", actor_user_id: replier, from_status: "pending", to_status: "confirmed", note: "Saturday 10:30, Akwa, ask for Paul" }]));
const ev0 = (await q1(`select count(*)::int n from public.card_appointment_events where appointment_id = '${c1.id}'`))[0].n;
const noop = await setS(owner1, c1.id, "confirmed");
check("confirm: asking for the status it already has is a no-op: no second event, nothing overwritten (a double click is safe)", noop.result === "noop" && (await q1(`select count(*)::int n from public.card_appointment_events where appointment_id = '${c1.id}'`))[0].n === ev0 && (await q1(`select decided_by from public.card_appointments where id = '${c1.id}'`))[0].decided_by === replier);
check("transition: a confirmed request can be cancelled (by the owner: event kind 'owner') but never declined or re-confirmed after it is final", (await setS(owner1, c1.id, "declined")).result === "invalid_transition" && (await setS(owner1, c1.id, "cancelled", "customer asked")).result === "ok" && (await statusOf(c1.id)) === "cancelled" && (await q1(`select actor_kind from public.card_appointment_events where appointment_id = '${c1.id}' and to_status = 'cancelled'`))[0].actor_kind === "owner");
check("transition: cancelled and declined are final (no way back to confirmed, declined, cancelled)", (await setS(owner1, c1.id, "confirmed")).result === "invalid_transition" && (await setS(owner1, c1.id, "declined")).result === "invalid_transition" && await (async () => { const d = await mk(conv1, WA.c1); const dec = await setS(replier, d.id, "declined", "no capacity"); return d.result === "created" && dec.result === "ok" && (await setS(replier, d.id, "confirmed")).result === "invalid_transition" && (await setS(replier, d.id, "cancelled")).result === "invalid_transition"; })());
check("transition: after a request is declined or cancelled, the customer can ask again (a new pending request), and the full history stays", (await q1(`select count(*)::int n from public.card_appointments where conversation_id = '${conv1}'`))[0].n === 2 && (await mk(conv1, WA.c1)).result === "created" && (await q1(`select count(*)::int n from public.card_appointments where conversation_id = '${conv1}'`))[0].n === 3 && (await rpc("card_appt_status", { p_conversation_id: conv1 })).status === "pending");
check("transition: pending -> declined and pending -> cancelled both work; pending is the only state that can be confirmed", await (async () => { const e = await mk(conv1b, WA.c1b); if (e.result !== "exists") { /* the first conversation-1b request is still open */ } const x = (await q1(`select id, status from public.card_appointments where conversation_id = '${conv1b}'`))[0]; return x.status === "pending" && (await setS(owner1, x.id, "cancelled")).result === "ok" && (await statusOf(x.id)) === "cancelled"; })());

// ============================================================ recording whether the customer could be told
const nid = (await mk(conv1b, WA.c1b)).id;
check("notify: the outcome of telling the customer is recorded by an authorized actor only ('sent' sets the time; 'window_closed' and 'failed' do not claim it was sent)", (await rpc("card_appt_record_notify", { p_actor_user_id: viewer, p_appointment_id: nid, p_outcome: "sent" })) === "not_found" && (await rpc("card_appt_record_notify", { p_actor_user_id: stranger, p_appointment_id: nid, p_outcome: "sent" })) === "not_found" && (await rpc("card_appt_record_notify", { p_actor_user_id: replier, p_appointment_id: nid, p_outcome: "window_closed" })) === "ok" && await (async () => { const r = (await q1(`select customer_notify_status s, customer_notified_at t from public.card_appointments where id = '${nid}'`))[0]; return r.s === "window_closed" && r.t === null; })() && (await rpc("card_appt_record_notify", { p_actor_user_id: owner1, p_appointment_id: nid, p_outcome: "sent" })) === "ok" && (await q1(`select customer_notify_status s, customer_notified_at t from public.card_appointments where id = '${nid}'`))[0].t !== null && (await rpc("card_appt_record_notify", { p_actor_user_id: owner1, p_appointment_id: nid, p_outcome: "delivered" })) === "invalid");
check("notify: a status change never depends on the notification (recording one does not change the status)", (await statusOf(nid)) === "pending");

// ============================================================ completed, and the notification outcome that belongs to ONE status
const notifyOf = async (id) => (await q1(`select customer_notify_status s, customer_notified_at t, status from public.card_appointments where id = '${id}'`))[0];
const note = (actor, id, outcome) => rpc("card_appt_record_notify", { p_actor_user_id: actor, p_appointment_id: id, p_outcome: outcome });
const comp = await mk(conv1c, WA.c1c);
check("completed: a pending request cannot be completed (only a confirmed one can), and 'completed' is accepted as a target", (await setS(replier, comp.id, "completed")).result === "invalid_transition" && (await statusOf(comp.id)) === "pending");
check("completed: permission is the same as for every decision: a view-only member, a stranger and the other organization are refused and nothing changes", (await setS(replier, comp.id, "confirmed")).result === "ok" && (await setS(viewer, comp.id, "completed")).result === "forbidden" && (await setS(stranger, comp.id, "completed")).result === "not_found" && (await setS(owner2, comp.id, "completed")).result === "not_found" && (await setS(org2staff, comp.id, "completed")).result === "not_found" && (await statusOf(comp.id)) === "confirmed");
await note(replier, comp.id, "sent");
const nSent = await notifyOf(comp.id);
check("notify: after a confirmation the outcome 'sent' is stored with its time", nSent.s === "sent" && nSent.t !== null);
const dupConfirm = await setS(owner1, comp.id, "confirmed");
const nSame = await notifyOf(comp.id);
check("no-op: asking again for the status it already has changes NOTHING (no event, no new decision, and the stored notification outcome is preserved exactly)", dupConfirm.result === "noop" && nSame.s === "sent" && String(nSame.t) === String(nSent.t) && (await q1(`select count(*)::int n from public.card_appointment_events where appointment_id = '${comp.id}'`))[0].n === 2);
const done = await setS(replier, comp.id, "completed", "Met on Saturday");
const nDone = await notifyOf(comp.id);
check("completed: a confirmed request is completed by an authorized member (details and decider recorded) and the previous 'sent' outcome is cleared in the same change", done.result === "ok" && done.status === "completed" && done.from === "confirmed" && nDone.status === "completed" && nDone.s === null && nDone.t === null && (await q1(`select decided_by, decision_details from public.card_appointments where id = '${comp.id}'`))[0].decided_by === replier);
check("completed: it is final: no way to confirmed, declined or cancelled (and 'completed' again is a harmless no-op)", (await setS(owner1, comp.id, "confirmed")).result === "invalid_transition" && (await setS(owner1, comp.id, "declined")).result === "invalid_transition" && (await setS(owner1, comp.id, "cancelled")).result === "invalid_transition" && (await setS(owner1, comp.id, "completed")).result === "noop" && (await statusOf(comp.id)) === "completed");
check("completed: the audit trail has every step with the real actor (customer created, staff confirmed, staff completed with the note), in order", JSON.stringify(await q1(`select actor_kind, actor_user_id, from_status, to_status, note from public.card_appointment_events where appointment_id = '${comp.id}' order by created_at, to_status desc`)) === JSON.stringify([
  { actor_kind: "customer", actor_user_id: null, from_status: null, to_status: "pending", note: null },
  { actor_kind: "staff", actor_user_id: replier, from_status: "pending", to_status: "confirmed", note: null },
  { actor_kind: "staff", actor_user_id: replier, from_status: "confirmed", to_status: "completed", note: "Met on Saturday" },
]));
const stDone = await rpc("card_appt_status", { p_conversation_id: conv1c });
check("completed: a completed request is no longer OPEN (the status answer says so) and the customer can ask for a new meeting: a second request is created, the first stays as history", stDone.status === "completed" && stDone.open === false && await (async () => { const again2 = await mk(conv1c, WA.c1c); return again2.result === "created" && again2.id !== comp.id && (await q1(`select count(*)::int n from public.card_appointments where conversation_id = '${conv1c}'`))[0].n === 2 && (await statusOf(comp.id)) === "completed" && (await rpc("card_appt_status", { p_conversation_id: conv1c })).status === "pending"; })());
const second = (await q1(`select id from public.card_appointments where conversation_id = '${conv1c}' and status = 'pending'`))[0].id;
check("completed: the constraint accepts completed in the table and in the events, and still refuses anything else", await db.exec(`update public.card_appointments set status = 'bogus' where id = '${second}'`).then(() => false, () => true) && await db.exec(`insert into public.card_appointment_events (appointment_id, actor_kind, to_status) values ('${second}', 'staff', 'bogus')`).then(() => false, () => true) && await db.exec(`insert into public.card_appointment_events (appointment_id, actor_kind, from_status, to_status) values ('${second}', 'staff', 'confirmed', 'completed')`).then(() => true, () => false));

// the regression: a notification that FAILED to be recorded after a later change can never show the previous notification as the result
await setS(owner1, second, "confirmed");
await note(owner1, second, "sent");
const before2 = await notifyOf(second);
await setS(replier, second, "cancelled", "customer asked to cancel");
const afterCancel = await notifyOf(second);
check("REGRESSION: confirm -> told (sent) -> cancel, and the recording of the cancel notice never happens: the row does NOT still say 'sent' (outcome and time are cleared with the change), so the page can only say 'not told yet'", before2.s === "sent" && afterCancel.status === "cancelled" && afterCancel.s === null && afterCancel.t === null);
check("REGRESSION: when the cancel notice is then recorded as failed or window-closed, that is exactly what is stored (never 'sent'), and a repeated cancel is a no-op that keeps it", (await note(replier, second, "failed")) === "ok" && (await notifyOf(second)).s === "failed" && (await notifyOf(second)).t === null && (await setS(owner1, second, "cancelled")).result === "noop" && (await notifyOf(second)).s === "failed" && (await note(replier, second, "window_closed")) === "ok" && (await notifyOf(second)).s === "window_closed");
check("REGRESSION: every real change clears the outcome, whichever way it goes (pending -> declined, pending -> confirmed, confirmed -> completed)", await (async () => {
  const out = [];
  for (const [conv, wa, path] of [[conv1b, WA.c1b, ["declined"]], [conv1c, WA.c1c, ["confirmed", "completed"]]]) {
    let x = (await q1(`select id, status from public.card_appointments where conversation_id = '${conv}' order by created_at desc limit 1`))[0];
    if (x.status !== "pending") x = { id: (await mk(conv, wa)).id };
    for (const to of path) {
      await note(owner1, x.id, "sent");
      const pre = (await notifyOf(x.id)).s;
      await setS(owner1, x.id, to);
      const post = await notifyOf(x.id);
      out.push(pre === "sent" && post.s === null && post.t === null);
    }
  }
  return out.length === 3 && out.every(Boolean);
})());

// ============================================================ isolation from everything else
const fnSrc = (await q1(`select string_agg(prosrc, E'\\n') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'card\\_appt\\_%'`))[0].s;
check("isolation: no function mentions bookings, signup requests, payments, plans, add-ons or subscriptions: a request can never activate a card or record a payment", !/bookings|signup_requests|payment|subscription|plans\b|addons|customer_paid/i.test(fnSrc));
check("isolation: the migration file creates or alters nothing outside its two tables and five functions", !/\b(alter table|drop table|create table)\b(?![^;]*card_appointment)/i.test(MIGRATION.replace(/--.*$/gm, "")) && !/\balter table public\.(?!card_appointment)/i.test(MIGRATION.replace(/--.*$/gm, "")) && !/\b(bookings|signup_requests|plans|addons)\b/i.test(MIGRATION.replace(/--.*$/gm, "")));

// ============================================================ rollback
const messagesBefore = (await q1(`select count(*)::int n from public.inbox_messages`))[0].n, convsBefore = (await q1(`select count(*)::int n from public.inbox_conversations`))[0].n, rolesBefore = (await q1(`select count(*)::int n from public.organization_roles`))[0].n;
const rb = read("supabase/support/2026-12-23_card_appointments.rollback.sql");
await db.exec(rb);
check("rollback: removes the two tables and the five functions and leaves every message, conversation and role intact", (await q1(`select count(*)::int n from pg_tables where tablename in ('card_appointments','card_appointment_events')`))[0].n === 0 && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_appt\\_%'`))[0].n === 0 && (await q1(`select count(*)::int n from public.inbox_messages`))[0].n === messagesBefore && (await q1(`select count(*)::int n from public.inbox_conversations`))[0].n === convsBefore && (await q1(`select count(*)::int n from public.organization_roles`))[0].n === rolesBefore);
check("rollback: is safe to run twice, and the migration can be applied again afterwards", await db.exec(rb).then(() => true, () => false) && await db.exec(MIGRATION).then(() => true, () => false) && (await q1(`select count(*)::int n from pg_proc where proname like 'card\\_appt\\_%'`))[0].n === 5);

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
