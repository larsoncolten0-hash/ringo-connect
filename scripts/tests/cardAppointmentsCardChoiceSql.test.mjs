// Card appointments, CARD CHOICE migration (supabase/migrations/2026-12-24_card_appointments_card_choice.sql), its preflight, verify and rollback, on scratch in-memory PostgreSQL
// (PGlite) built exactly like cardAppointmentsSql.test.mjs. Nothing here connects to Supabase or any real database and nothing reads .env.local.
// Covers: preflight before / verify after, idempotency, old rows keep NULL card fields, card_appt_create_with_card (stores tier + price, repeat leaves the card untouched, both-or-neither,
// unknown tier, price range, inherited verified-number rule), the old function still works, no API-role execute, the receipt fields of card_appt_set_status, and the rollback.
//   Run:  node scripts/tests/cardAppointmentsCardChoiceSql.test.mjs
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

const M23 = read("supabase/migrations/2026-12-23_card_appointments.sql"), M24 = read("supabase/migrations/2026-12-24_card_appointments_card_choice.sql");
const PRE = read("supabase/support/2026-12-24_card_appointments_card_choice.preflight.sql"), VER = read("supabase/support/2026-12-24_card_appointments_card_choice.verify.sql"), RB = read("supabase/support/2026-12-24_card_appointments_card_choice.rollback.sql");
await db.exec(M23);
const mk = (conv, wa, o = {}) => rpc("card_appt_create", { p_conversation_id: conv, p_name: "Jean Mbah", p_phone: wa, p_time: "Saturday 10am", p_place: "Akwa", p_note: null, p_lang: "en", ...o });
const mkc = (conv, wa, tier, price, o = {}) => rpc("card_appt_create_with_card", { p_conversation_id: conv, p_name: "Jean Mbah", p_phone: wa, p_time: "Saturday 10am", p_place: "Akwa", p_note: null, p_lang: "en", p_card_tier: tier, p_card_price: price, ...o });
const old = await mk(conv1, WA.c1);   // a pre-existing request, created before the migration
const pre = (await db.query(PRE)).rows;
check("preflight (after 12-23, before 12-24): all rows ok", pre.length === 5 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));
await db.exec(M24);
const ver = (await db.query(VER)).rows;
check("verify after 12-24: all rows ok", ver.length >= 13 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));
check("12-24 is idempotent", await db.exec(M24).then(() => true, () => false));
check("pre-existing row keeps NULL card fields", (await q1(`select card_tier, card_price_xaf from public.card_appointments where id='${old.id}'`))[0].card_tier === null);
const c = await mkc(conv1b, WA.c1b, "premium", 10000);
const crow = (await q1(`select * from public.card_appointments where id='${c.id}'`))[0];
check("with_card creates and stores tier+price", c.result === "created" && crow.card_tier === "premium" && crow.card_price_xaf === 10000 && crow.status === "pending", JSON.stringify(c));
const rep = await mkc(conv1b, WA.c1b, "standard", 5000);
check("repeat returns existing and leaves the card untouched", rep.result !== "created" && (await q1(`select card_tier from public.card_appointments where id='${c.id}'`))[0].card_tier === "premium", JSON.stringify(rep));
check("tier without price -> invalid, nothing created", (await mkc(conv1c, WA.c1c, "pro", null)).result === "invalid" && (await q1(`select count(*)::int n from public.card_appointments where conversation_id='${conv1c}'`))[0].n === 0);
check("price without tier -> invalid", (await mkc(conv1c, WA.c1c, null, 5000)).result === "invalid");
check("unknown tier / zero / huge price -> invalid", (await mkc(conv1c, WA.c1c, "gold", 5000)).result === "invalid" && (await mkc(conv1c, WA.c1c, "pro", 0)).result === "invalid" && (await mkc(conv1c, WA.c1c, "pro", 10000001)).result === "invalid");
const none = await mkc(conv1c, WA.c1c, null, null);
check("neither tier nor price behaves like card_appt_create", none.result === "created" && (await q1(`select card_tier from public.card_appointments where id='${none.id}'`))[0].card_tier === null, JSON.stringify(none));
check("wrong phone is still refused (verified-number rule inherited)", (await mkc(convB, WA.cB, "pro", 5000, { p_phone: "237699999999" })).result !== "created");
check("old card_appt_create still works", (await mk(convF, WA.cF)).result !== undefined);
const denied = [];
for (const r of ["anon", "authenticated"]) { const x = await asRole(r, owner1, `select public.card_appt_create_with_card('${conv1}','a','b','c','d',null,'en','pro',5000)`); denied.push(!x.ok); }
check("anon and authenticated cannot execute the new function", denied.every(Boolean));
const st = await rpc("card_appt_set_status", { p_actor_user_id: owner1, p_appointment_id: c.id, p_to: "confirmed", p_details: null });
check("set_status returns receipt fields incl. card", st.result === "ok" && st.card_tier === "premium" && st.card_price_xaf === 10000 && st.customer_name === "Jean Mbah" && st.preferred_time === "Saturday 10am" && st.meeting_place === "Akwa", JSON.stringify(st));
const stNoCard = await rpc("card_appt_set_status", { p_actor_user_id: owner1, p_appointment_id: none.id, p_to: "declined", p_details: null });
check("set_status on a no-card row returns null card fields", stNoCard.result === "ok" && stNoCard.card_tier === null);
check("set_status still blocks a non-member and a bad transition", (await rpc("card_appt_set_status", { p_actor_user_id: owner2, p_appointment_id: c.id, p_to: "cancelled", p_details: null })).result !== "ok" && (await rpc("card_appt_set_status", { p_actor_user_id: owner1, p_appointment_id: none.id, p_to: "confirmed", p_details: null })).result === "invalid_transition");
await db.exec(RB);
check("rollback: columns and function gone, five functions remain, rows remain", (await q1(`select count(*)::int n from information_schema.columns where table_name='card_appointments' and column_name in ('card_tier','card_price_xaf')`))[0].n === 0 && (await q1(`select count(*)::int n from pg_proc where proname='card_appt_create_with_card'`))[0].n === 0 && (await q1(`select count(*)::int n from pg_proc where proname like 'card\_appt\_%'`))[0].n === 5 && (await q1(`select count(*)::int n from public.card_appointments`))[0].n >= 3);
check("rollback is safe twice and leaves the 12-23 verify green", await db.exec(RB).then(() => true, () => false));
const v23 = (await db.query(read("supabase/support/2026-12-23_card_appointments.verify.sql"))).rows;
check("12-23 verify is all ok after rollback", v23.every((r) => r.ok === true), JSON.stringify(v23.filter((r) => !r.ok)));
check("re-applying 12-24 after rollback works", await db.exec(M24).then(() => true, () => false));
const fails = results.filter((r) => !r.pass);
console.log(`card-choice migration (scratch PGlite): ${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
