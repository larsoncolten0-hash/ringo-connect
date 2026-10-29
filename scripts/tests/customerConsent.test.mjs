// Customer marketing consent (Phase 3A): the consent ledger, the effective-consent rule, the My Ringo consent API, the Community unsubscribe and the Connect flow, validated end to end and OFFLINE.
// The REAL migration files (2026-09-19 community, 2026-10-17 customers, 2026-10-23 community push, 2027-01-17 consent ledger), the REAL route files (src/app/api/customer/consent,
// src/app/api/community/manage/[token]), the REAL connect and consent libraries run against scratch in-memory PostgreSQL (PGlite). No Supabase, no network, no message is ever sent.
//   Run:  node scripts/tests/customerConsent.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({});
const { F, jiti } = H;
const { prof } = F;
const { check, eq, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIGS = ["2026-09-19_community_system", "2026-10-17_ringo_customers_core", "2026-10-23_community_push_channel", "2027-01-17_customer_consent_events"].map((f) => read(`supabase/migrations/${f}.sql`));
const CONS = jiti(path.join(SRC, "lib/customer/consent.ts"));
const CONNECT = jiti(path.join(SRC, "lib/customer/connect.ts"));
const HANDLERS = jiti(path.join(SRC, "lib/customer/consentHandlers.ts"));

async function fresh() {
  await H.fresh();
  await H.db.exec(`alter table public.ringo_customers add column name text not null default 'V', add column email text, add column phone text, add column email_verified_at timestamptz, add column preferred_language text,
    add column avatar_url text, add column last_login_at timestamptz, add column phone_verified_at timestamptz, add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
    create table public.products (id uuid primary key default gen_random_uuid());`);
  for (const m of MIGS) await H.db.exec(m);
  globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" });
  globalThis.__customer = null;
  globalThis.__sameOrigin = undefined;
}
const sdb = () => F.sessionFor(H.db, null, { role: "service_role" });
const cu = (n) => F.id("7", n);
const sid = (n) => F.id("8", n);
const q = (sql) => F.svcQuery(H.db, sql);
const as = (n, o = {}) => { globalThis.__customer = n ? { customer: { id: cu(n), name: "Person " + n, email: `p${n}@example.test`, phone: null, email_verified_at: o.confirmed === false ? null : "2026-10-01T10:00:00Z" }, sessionId: "s" + n } : null; };

async function person(n, o = {}) {
  const profile = o.profile ?? prof.c1;
  await H.db.exec(`insert into public.ringo_customers (id, name, email, email_verified_at) values ('${cu(n)}','Person ${n}','p${n}@example.test', ${o.confirmed === false ? "null" : "'2026-10-01T10:00:00Z'"}) on conflict do nothing`);
  if (o.connect === false) return;
  const status = o.status ?? "active";
  await H.db.exec(`insert into public.customer_connections (customer_id, profile_id, status, disconnected_at, marketing_consent, marketing_consent_at)
    values ('${cu(n)}','${profile}','${status}', ${status === "disconnected" ? "now()" : "null"}, ${o.consent ? "true" : "false"}, ${o.consent ? `'${o.consentAt ?? "2026-10-20T10:00:00Z"}'` : "null"})`);
}
/** A Community row linked to the connection. `touchedLater` simulates a preference changed long after the row was created. */
async function sub(n, o = {}) {
  const profile = o.profile ?? prof.c1;
  await H.db.exec(`insert into public.community_subscribers (id, profile_id, name, email, status, created_at) values ('${sid(n)}','${profile}','Person ${n}','p${n}@example.test','${o.status ?? "active"}','2026-10-20T10:00:00Z')`);
  await H.db.exec(`insert into public.community_subscription_preferences (subscriber_id, email_updates, push_updates, updated_at) values ('${sid(n)}', ${o.email === true}, ${o.push !== false}, '${o.touchedLater ? "2026-10-25T10:00:00Z" : "2026-10-20T10:00:00Z"}')`);
  if (o.link !== false) await H.db.exec(`update public.customer_connections set community_subscriber_id = '${sid(n)}' where customer_id = '${cu(n)}' and profile_id = '${profile}'`);
}
const events = (n, profile = prof.c1) => q(`select channel, action, source from public.customer_consent_events where customer_id = '${cu(n)}' and profile_id = '${profile}' order by seq`);
const conn = async (n, profile = prof.c1) => (await q(`select status, marketing_consent, to_char(marketing_consent_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') as at, community_subscriber_id from public.customer_connections where customer_id = '${cu(n)}' and profile_id = '${profile}'`))[0];
const prefs = async (n) => (await q(`select email_updates, push_updates from public.community_subscription_preferences where subscriber_id = '${sid(n)}'`))[0];
const subStatus = async (n) => (await q(`select status from public.community_subscribers where id = '${sid(n)}'`))[0]?.status;
const get = () => H.call(null, "GET", "customer/consent");
const put = (body) => H.call(null, "PUT", "customer/consent", { body });
const unsub = (token, body) => H.call(null, "POST", "community/manage/[token]", { params: { token }, body });
const token = async (n) => (await q(`select unsubscribe_token::text as t from public.community_subscribers where id = '${sid(n)}'`))[0].t;
const dbErr = async (sql, role = "service_role") => { await H.db.exec(`set role ${role}`); try { await H.db.exec(sql); return null; } catch (e) { return String(e.message); } finally { await H.db.exec("reset role"); } };

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("A. the rule (pure): ");
{
  const D = CONS.decideConsent;
  const base = { channel: "email", connection: { status: "active", marketing_consent: true }, emailConfirmed: true, subscriber: { status: "active", created_at: "2026-10-20T10:00:00Z" }, prefs: { email_updates: true, push_updates: true, updated_at: "2026-10-20T10:00:00Z" }, latest: null };
  const d = (o) => D({ ...base, ...o });
  const off = { email_updates: false, push_updates: true, updated_at: "2026-10-20T10:00:00Z" };
  check("legacy email consent (flag true, no ledger row) with the switch ON is ON, basis legacy", d({}).state === "on" && d({}).basis === "legacy" && d({}).effective === true);
  check("a ledger grant is ON with basis ledger", d({ latest: "granted" }).basis === "ledger" && d({ latest: "granted" }).effective);
  check("a later REVOKE vetoes a stale true flag", d({ latest: "revoked" }).state === "off" && d({ latest: "revoked" }).reason === "revoked");
  check("no flag = off, whatever the Community row says", d({ connection: { status: "active", marketing_consent: false } }).reason === "no_consent");
  check("a disconnected or missing connection is never consent", d({ connection: { status: "disconnected", marketing_consent: true } }).reason === "not_connected" && d({ connection: null }).reason === "not_connected");
  check("an unsubscribed or removed Community row ends legacy and ledger consent", d({ subscriber: { status: "unsubscribed", created_at: null } }).reason === "unsubscribed" && d({ subscriber: { status: "removed", created_at: null } }).reason === "removed_by_creator" && d({ latest: "granted", subscriber: { status: "unsubscribed", created_at: null } }).state === "off");
  check("LEGACY flag + switch OFF is OFF, however old or new the row is (no timing guess): it is never used to switch anything on", [off, { ...off, updated_at: "2026-10-20T10:00:01Z" }, { ...off, updated_at: "2026-12-01T00:00:00Z" }, { ...off, updated_at: null }].every((prefs) => d({ prefs }).state === "off" && d({ prefs }).reason === "legacy_not_applied"));
  check("LEGACY flag with no Community row or no preference row is OFF", d({ subscriber: null, prefs: null }).reason === "legacy_not_applied" && d({ prefs: null }).reason === "legacy_not_applied");
  check("legacy + switch on but address unconfirmed: pending (it cannot be sent yet)", d({ emailConfirmed: false }).state === "pending");
  check("a LEDGER grant whose switch is not applied yet is pending (unconfirmed address, row not created yet, or switch still off)", d({ latest: "granted", emailConfirmed: false }).reason === "email_unconfirmed" && d({ latest: "granted", subscriber: null, prefs: null }).reason === "no_community_row" && d({ latest: "granted", prefs: off }).reason === "not_applied" && d({ latest: "granted", prefs: off }).state === "pending");
  const p = (o) => D({ ...base, channel: "push", ...o });
  check("push needs a ledger GRANT: the membership default (push_updates true) is not consent", p({}).state === "off" && p({}).reason === "no_consent" && p({}).basis === "none");
  check("push granted + switch on = ON", p({ latest: "granted" }).state === "on");
  check("push granted but the switch is OFF is OFF (never waiting): a stale grant cannot read as consent after a withdrawal made while the ledger was down", p({ latest: "granted", prefs: { email_updates: false, push_updates: false, updated_at: null } }).state === "off" && p({ latest: "granted", prefs: { email_updates: false, push_updates: false, updated_at: null } }).reason === "switched_off");
  check("push revoked = off, unsubscribed = off, no row yet = pending", p({ latest: "revoked" }).state === "off" && p({ latest: "granted", subscriber: { status: "unsubscribed", created_at: null } }).state === "off" && p({ latest: "granted", subscriber: null, prefs: null }).state === "pending");
  check("email consent never counts for push, push never for email", p({ latest: "granted", connection: { status: "active", marketing_consent: false } }).state === "on" && d({ latest: "granted", connection: { status: "active", marketing_consent: false } }).state === "off");
  check("channels are exactly email and push (no WhatsApp)", CONS.CONSENT_CHANNELS.join() === "email,push" && !CONS.isConsentChannel("whatsapp"));
  const src = read("src/lib/customer/consent.ts");
  check("the rule has no clock in it", !/Date\.parse|Date\.now|new Date/.test(src.slice(src.indexOf("export function decideConsent"), src.indexOf("// Reading"))));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("B. the migration, executed: ");
await fresh();
{
  await person(1, { consent: true, consentAt: "2026-10-20T10:00:00Z" });
  await person(2);
  check("applying the migration changed no existing row: the legacy consent and its timestamp are intact", (await conn(1)).marketing_consent === true && /^2026-10-20 10:00:00/.test((await conn(1)).at));
  eq("no ledger history was fabricated for the legacy row", (await q("select count(*)::int as n from public.customer_consent_events"))[0].n, 0);
  const call = (c, p, ch, a, s) => sdb().rpc("customer_consent_set", { p_customer: c, p_profile: p, p_channel: ch, p_action: a, p_source: s });

  const g1 = await call(cu(2), prof.c1, "email", "granted", "my_ringo");
  check("granting appends one event and sets the flag", !g1.error && g1.data[0].out_changed === true && (await conn(2)).marketing_consent === true && (await events(2)).length === 1);
  const g2 = await call(cu(2), prof.c1, "email", "granted", "my_ringo");
  check("granting again appends nothing (idempotent)", g2.data[0].out_changed === false && (await events(2)).length === 1);
  const r1 = await call(cu(2), prof.c1, "email", "revoked", "my_ringo");
  check("revoking appends an event and clears the flag and its timestamp", r1.data[0].out_changed === true && (await conn(2)).marketing_consent === false && (await conn(2)).at === null);
  const r2 = await call(cu(2), prof.c1, "email", "revoked", "my_ringo");
  check("revoking twice appends nothing", r2.data[0].out_changed === false && (await events(2)).length === 2);
  const r3 = await call(cu(1), prof.c1, "email", "revoked", "community_unsubscribe");
  check("revoking LEGACY consent (no ledger row yet) records a real event and clears the legacy flag", r3.data[0].out_changed === true && (await conn(1)).marketing_consent === false && (await events(1)).length === 1);
  const g3 = await call(cu(1), prof.c1, "email", "granted", "my_ringo");
  check("a new explicit grant after a withdrawal is a new event and sets a new timestamp", g3.data[0].out_changed === true && (await conn(1)).marketing_consent === true && (await events(1)).map((e) => e.action).join() === "revoked,granted");

  await person(3, { status: "disconnected" });
  const g4 = await call(cu(3), prof.c1, "email", "granted", "my_ringo");
  check("granting needs an ACTIVE connection", !!g4.error && /consent_not_connected/.test(g4.error.message));
  const r4 = await call(cu(3), prof.c1, "email", "revoked", "my_ringo");
  check("withdrawing works for a disconnected customer (consent is separate from connection)", !r4.error);
  const g5 = await call(cu(9), prof.c1, "email", "granted", "my_ringo");
  const r5 = await call(cu(9), prof.c1, "email", "revoked", "my_ringo");
  check("no connection: granting is refused, withdrawing is a harmless no-op", !!g5.error && !r5.error && r5.data[0].out_changed === false);
  check("a bad channel, action or source is refused (no WhatsApp)", !!(await call(cu(2), prof.c1, "whatsapp", "granted", "my_ringo")).error && !!(await call(cu(2), prof.c1, "email", "maybe", "my_ringo")).error && !!(await call(cu(2), prof.c1, "email", "granted", "admin")).error);

  const p1 = await call(cu(2), prof.c1, "push", "granted", "my_ringo");
  check("push is recorded in the ledger and does NOT touch the email flag", p1.data[0].out_changed === true && (await conn(2)).marketing_consent === false);

  // privileges
  check("anon and authenticated cannot read the ledger", /permission denied/.test(await dbErr("select * from public.customer_consent_events", "anon")) && /permission denied/.test(await dbErr("select * from public.customer_consent_events", "authenticated")));
  check("anon and authenticated cannot append or call the writer", /permission denied/.test(await dbErr(`insert into public.customer_consent_events (customer_id, profile_id, channel, action, source) values ('${cu(2)}','${prof.c1}','email','granted','my_ringo')`, "authenticated")) && /permission denied/.test(await dbErr(`select * from public.customer_consent_set('${cu(2)}','${prof.c1}','email','granted','my_ringo')`, "authenticated")) && /permission denied/.test(await dbErr(`select * from public.customer_consent_set('${cu(2)}','${prof.c1}','email','granted','my_ringo')`, "anon")));
  check("the service role can neither update nor delete a decision", /permission denied/.test(await dbErr("update public.customer_consent_events set action = 'granted'")) && /permission denied/.test(await dbErr("delete from public.customer_consent_events")));
  const owner = async (sql) => { try { await H.db.exec(sql); return null; } catch (e) { return String(e.message); } };
  check("even the table owner cannot update or delete a decision (append-only trigger)", /append_only/.test(await owner("update public.customer_consent_events set action = 'granted'")) && /append_only/.test(await owner("delete from public.customer_consent_events")));
  check("the table constraints refuse a bad channel, action or source and a second purpose", /check/i.test(await owner(`insert into public.customer_consent_events (customer_id, profile_id, channel, action, source) values ('${cu(2)}','${prof.c1}','whatsapp','granted','my_ringo')`)) && /check/i.test(await owner(`insert into public.customer_consent_events (customer_id, profile_id, channel, action, source, purpose) values ('${cu(2)}','${prof.c1}','email','granted','my_ringo','sales')`)));
  const before = (await q("select count(*)::int as n from public.customer_consent_events"))[0].n;
  await H.db.exec(`delete from public.ringo_customers where id = '${cu(2)}'`);
  const after = (await q("select count(*)::int as n from public.customer_consent_events"))[0].n;
  check("removing a customer removes that customer's decisions (cascade) and only theirs", after < before && (await events(1)).length > 0);
  // ordering is strict even when clocks tie
  check("decisions have a strict order", (await q("select count(*)::int as n from (select seq from public.customer_consent_events group by seq having count(*) > 1) x"))[0].n === 0);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("C. the My Ringo consent API: ");
await fresh();
{
  let r = await get();
  check("no cookie = 401 on GET and PUT", r.status === 401 && (await put({ profile_id: prof.c1, channel: "email", enabled: true })).status === 401);
  await person(1, { profile: prof.c1 });
  await person(2, { profile: prof.c1, confirmed: false });
  await person(3, { profile: prof.nc });
  as(1);
  globalThis.__sameOrigin = false;
  check("a cross-site write is refused (403) and writes nothing", (await put({ profile_id: prof.c1, channel: "email", enabled: true })).status === 403 && (await events(1)).length === 0);
  globalThis.__sameOrigin = undefined;
  r = await put({ profile_id: prof.c1, channel: "email", enabled: "yes" });
  check("an invalid body is refused with a field", r.status === 400 && r.body.field === "enabled");
  check("a bad channel (whatsapp), a bad profile id and an unknown field are refused", (await put({ profile_id: prof.c1, channel: "whatsapp", enabled: true })).status === 400 && (await put({ profile_id: "x", channel: "email", enabled: true })).status === 400 && (await put({ profile_id: prof.c1, channel: "email", enabled: true, customer_id: cu(2) })).status === 400);
  r = await get();
  check("GET lists the active connection with everything OFF by default", r.status === 200 && r.body.items.length === 1 && r.body.items[0].email.on === false && r.body.items[0].push.on === false && r.body.items[0].email.state === "off");

  r = await put({ profile_id: prof.c1, channel: "email", enabled: true });
  check("granting email for a confirmed address with no Community row: recorded, Community row created, switch ON", r.status === 200 && r.body.item.email.on === true && (await events(1))[0].source === "my_ringo" && (await conn(1)).marketing_consent === true);
  const c1 = await conn(1);
  check("the Community row exists, is linked, and email_updates is on", !!c1.community_subscriber_id && (await q(`select email_updates from public.community_subscription_preferences where subscriber_id = '${c1.community_subscriber_id}'`))[0].email_updates === true);
  r = await put({ profile_id: prof.c1, channel: "push", enabled: true });
  check("granting push is a separate decision and switches only push", r.body.item.push.on === true && (await events(1)).map((e) => e.channel).join() === "email,push");
  r = await put({ profile_id: prof.c1, channel: "email", enabled: false });
  check("withdrawing email: off at once, the ledger records it, the flag and the Community switch are cleared; push is untouched", r.status === 200 && r.body.item.email.on === false && r.body.item.push.on === true && (await conn(1)).marketing_consent === false && (await q(`select email_updates from public.community_subscription_preferences where subscriber_id = '${c1.community_subscriber_id}'`))[0].email_updates === false);

  as(2, { confirmed: false });
  r = await put({ profile_id: prof.c1, channel: "email", enabled: true });
  check("an UNCONFIRMED address: the grant is recorded but stays pending (not on) until the address is confirmed", r.status === 200 && r.body.item.email.state === "pending" && r.body.item.email.on === false && (await conn(2)).marketing_consent === true);
  const pend = await q(`select cs.id, p.email_updates from public.customer_connections cc join public.community_subscribers cs on cs.id = cc.community_subscriber_id join public.community_subscription_preferences p on p.subscriber_id = cs.id where cc.customer_id = '${cu(2)}'`);
  check("...and no email switch was turned on for it (the Community row is only created once the address is confirmed)", pend.every((x) => x.email_updates === false));

  as(1);
  check("a profile the customer is not connected to is 404 and writes nothing", (await put({ profile_id: prof.c2, channel: "email", enabled: true })).status === 404 && (await put({ profile_id: prof.c2, channel: "email", enabled: false })).status === 404);
  check("another customer's connection is invisible: customer 1 cannot touch customer 3's profile", (await put({ profile_id: prof.nc, channel: "email", enabled: true })).status === 404 && (await events(3, prof.nc)).length === 0);
  as(3);
  r = await put({ profile_id: prof.nc, channel: "email", enabled: true });
  check("consent works the same for a non-church profile (it is not a church feature)", r.status === 200 && r.body.item.email.on === true);
  as(1);
  r = await get();
  check("each customer sees only their own connections", r.body.items.length === 1 && r.body.items[0].profile_id === prof.c1);

  // disconnect: consent is separate from connection; a disconnected customer cannot grant
  await H.db.exec(`update public.customer_connections set status = 'disconnected', disconnected_at = now() where customer_id = '${cu(1)}'`);
  check("a disconnected customer cannot grant (409) but can still withdraw", (await put({ profile_id: prof.c1, channel: "email", enabled: true })).status === 409 && (await put({ profile_id: prof.c1, channel: "push", enabled: false })).status === 200);
  check("a disconnected connection is not listed", (await get()).body.items.length === 0);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("D. an unsubscribe cannot be undone: ");
await fresh();
{
  const sync = async (n, confirmed = true) => CONNECT.syncMarketingSubscribers(sdb(), { id: cu(n), name: "Person " + n, email: `p${n}@example.test`, phone: null });
  // 1. legacy consent + full unsubscribe by token, then the address is confirmed
  await person(1, { consent: true });
  await sub(1, { email: true });
  let r = await unsub(await token(1), { unsubscribe: true });
  check("the unsubscribe succeeds", r.status === 200 && (await subStatus(1)) === "unsubscribed");
  check("it records a withdrawal for BOTH channels in the ledger, with its source, and clears the legacy flag", (await events(1)).map((e) => `${e.channel}:${e.action}:${e.source}`).sort().join() === "email:revoked:community_unsubscribe,push:revoked:community_unsubscribe" && (await conn(1)).marketing_consent === false);
  await sync(1);
  check("confirming the email afterwards does NOT switch anything back on", (await prefs(1)).email_updates === false && (await subStatus(1)) === "unsubscribed");

  // 2. the unsubscribe happened BEFORE the ledger existed: legacy flag still true, status unsubscribed, no ledger row
  await person(2, { consent: true });
  await sub(2, { email: false, status: "unsubscribed" });
  await sync(2);
  check("a pre-ledger unsubscribe (status only) is not undone by a stale legacy flag", (await prefs(2)).email_updates === false && (await subStatus(2)) === "unsubscribed");

  // 3. email switched off on the preferences page long after connecting (pre-ledger), legacy flag still true
  await person(3, { consent: true });
  await sub(3, { email: false, touchedLater: true });
  await sync(3);
  check("a legacy flag cannot re-enable an email switch the person turned off later", (await prefs(3)).email_updates === false);

  // 4. a creator removed the subscriber
  await person(4, { consent: true });
  await sub(4, { email: false, status: "removed" });
  await sync(4);
  check("a removed subscriber is never switched back on", (await prefs(4)).email_updates === false && (await subStatus(4)) === "removed");

  // 5. REGRESSION (the five-second window): a LEGACY flag whose email switch was turned off right after the row was created. No timing is involved: a legacy flag never switches anything on.
  await person(5, { consent: true, confirmed: false });
  await sub(5, { email: false });
  await H.db.exec(`update public.community_subscription_preferences set updated_at = '2026-10-20T10:00:02Z' where subscriber_id = '${sid(5)}'`); // 2 s after the row was created
  await H.db.exec(`update public.ringo_customers set email_verified_at = now() where id = '${cu(5)}'`);
  await sync(5);
  check("a legacy flag + switch turned off 2 seconds after creation is NOT re-enabled when the address is confirmed", (await prefs(5)).email_updates === false);
  await person(11, { consent: true, confirmed: false });
  await sub(11, { email: false });
  await H.db.exec(`update public.ringo_customers set email_verified_at = now() where id = '${cu(11)}'`);
  await sync(11);
  check("...and neither is a legacy flag with the switch untouched (it cannot be told apart, so it is never applied; the person can turn it on themselves)", (await prefs(11)).email_updates === false);
  // a consent recorded NOW (ledger) against an unconfirmed address is applied at confirmation - that is the legitimate case
  const connectNow = (n, confirmed) => CONNECT.connectCustomerToProfile(sdb(), { customer: { id: cu(n), name: "Person " + n, email: `p${n}@example.test`, phone: null, emailConfirmed: confirmed }, profile: { id: prof.c1, name: "Grace", username: "grace" }, marketingConsent: true, source: "ringo_profile" });
  const emailOf = async (subId) => (await q(`select email_updates from public.community_subscription_preferences where subscriber_id = '${subId}'`))[0].email_updates;
  await person(12, { connect: false, confirmed: false });
  await connectNow(12, false);
  const sid12 = (await conn(12)).community_subscriber_id;
  check("a ledger-backed tick against an unconfirmed address waits (switch off)", (await emailOf(sid12)) === false);
  await H.db.exec(`update public.ringo_customers set email_verified_at = now() where id = '${cu(12)}'`);
  await sync(12);
  check("...and IS applied when the address is confirmed", (await emailOf(sid12)) === true);
  await person(13, { connect: false, confirmed: false });
  await connectNow(13, false);
  const sid13 = (await conn(13)).community_subscriber_id;
  as(13, { confirmed: false });
  r = await put({ profile_id: prof.c1, channel: "email", enabled: false }); // the person switches it off again in My Ringo
  as(null);
  await H.db.exec(`update public.ringo_customers set email_verified_at = now() where id = '${cu(13)}'`);
  await sync(13);
  check("a ledger-backed tick that the person switched off again (even seconds later) is NOT applied at confirmation", (await emailOf(sid13)) === false && (await conn(13)).marketing_consent === false);

  // 6. ledger revoke wins over a true flag even if the flag was somehow left true
  await person(6, { consent: true, confirmed: false });
  await sub(6, { email: false });
  await sdb().rpc("customer_consent_set", { p_customer: cu(6), p_profile: prof.c1, p_channel: "email", p_action: "revoked", p_source: "my_ringo" });
  await H.db.exec(`update public.customer_connections set marketing_consent = true, marketing_consent_at = now() where customer_id = '${cu(6)}'`);
  await H.db.exec(`update public.ringo_customers set email_verified_at = now() where id = '${cu(6)}'`);
  await sync(6);
  check("a ledger revoke vetoes even a flag that was set back to true by something else", (await prefs(6)).email_updates === false);

  // 7. switching email off on the Community preferences page (linked customer) is a recorded withdrawal
  await person(7, { consent: true });
  await sub(7, { email: true });
  r = await unsub(await token(7), { email_updates: false });
  check("turning email off on the preferences page records a withdrawal (community_manage) and clears the flag", r.status === 200 && (await events(7)).some((e) => e.channel === "email" && e.action === "revoked" && e.source === "community_manage") && (await conn(7)).marketing_consent === false);
  await sync(7);
  check("...and a later confirmation does not undo it", (await prefs(7)).email_updates === false);

  // 8. turning it ON from the preferences page is an explicit grant, recorded; it FAILS CLOSED when the ledger cannot record it
  await person(8, { consent: false });
  await sub(8, { email: false });
  r = await unsub(await token(8), { email_updates: true });
  check("turning email on for a linked customer is recorded as a grant (community_manage)", r.status === 200 && (await events(8)).some((e) => e.action === "granted" && e.source === "community_manage") && (await prefs(8)).email_updates === true && (await conn(8)).marketing_consent === true);
  await person(9, { consent: false });
  await sub(9, { email: false });
  await H.db.exec("drop function public.customer_consent_set(uuid, uuid, text, text, text)");
  r = await unsub(await token(9), { email_updates: true });
  check("with the ledger unavailable, turning email ON is refused (503) and nothing is switched on", r.status === 503 && (await prefs(9)).email_updates === false && (await conn(9)).marketing_consent === false);
  // unsubscribing still works with the ledger unavailable
  await person(10, { consent: true });
  await sub(10, { email: true });
  r = await unsub(await token(10), { unsubscribe: true });
  check("with the ledger unavailable, an unsubscribe still works: flag, switches and status are cleared", r.status === 200 && (await subStatus(10)) === "unsubscribed" && (await prefs(10)).email_updates === false && (await prefs(10)).push_updates === false && (await conn(10)).marketing_consent === false);

  // 9. a subscriber with no linked customer keeps the old behaviour
  await H.db.exec(`insert into public.community_subscribers (id, profile_id, name, email) values ('${sid(20)}','${prof.c1}','Fan','fan@example.test')`);
  await H.db.exec(`insert into public.community_subscription_preferences (subscriber_id, email_updates) values ('${sid(20)}', false)`);
  r = await unsub(await token(20), { email_updates: true });
  check("a subscriber without a My Ringo account is unaffected by the ledger (old behaviour)", r.status === 200 && (await prefs(20)).email_updates === true);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("E. the Connect flow and withdrawal without the ledger: ");
await fresh();
{
  const connect = (n, tick, o = {}) => CONNECT.connectCustomerToProfile(sdb(), { customer: { id: cu(n), name: "Person " + n, email: `p${n}@example.test`, phone: null, emailConfirmed: o.confirmed !== false }, profile: { id: prof.c1, name: "Grace", username: "grace" }, marketingConsent: tick, source: "ringo_profile" });
  await person(1, { connect: false });
  let r = await connect(1, false);
  check("connecting WITHOUT the tick records no consent anywhere", r.ok && r.consentRecorded === false && (await conn(1)).marketing_consent === false && (await events(1)).length === 0);
  await person(2, { connect: false });
  r = await connect(2, true);
  check("connecting WITH the tick records an explicit grant (connect_form), sets the flag and switches email on", r.ok && r.consentRecorded === true && (await events(2))[0].source === "connect_form" && (await conn(2)).marketing_consent === true && (await q(`select p.email_updates from public.customer_connections cc join public.community_subscription_preferences p on p.subscriber_id = cc.community_subscriber_id where cc.customer_id = '${cu(2)}'`))[0].email_updates === true);
  await person(3, { connect: false, confirmed: false });
  r = await connect(3, true, { confirmed: false });
  check("a tick against an unconfirmed address is recorded but not applied", r.consentRecorded === true && (await events(3)).length === 1 && (await q(`select p.email_updates from public.customer_connections cc join public.community_subscription_preferences p on p.subscriber_id = cc.community_subscriber_id where cc.customer_id = '${cu(3)}'`))[0].email_updates === false);
  // disconnect then reconnect without a tick: the old opt-in is NOT restored
  await H.db.exec(`update public.customer_connections set status = 'disconnected', disconnected_at = now() where customer_id = '${cu(2)}'`);
  r = await connect(2, false);
  const st = await conn(2);
  check("reconnecting without a tick does not restore the old opt-in: flag off, withdrawals recorded (reconnect_reset)", st.status === "active" && st.marketing_consent === false && (await events(2)).filter((e) => e.source === "reconnect_reset").length >= 1);
  check("...and the Community row that is linked again has email OFF", (await q(`select p.email_updates from public.customer_connections cc join public.community_subscription_preferences p on p.subscriber_id = cc.community_subscriber_id where cc.customer_id = '${cu(2)}'`))[0].email_updates === false);

  // the ledger is unavailable at connect: the connection still succeeds, consent stays OFF
  await H.db.exec("drop function public.customer_consent_set(uuid, uuid, text, text, text)");
  await person(4, { connect: false });
  r = await connect(4, true);
  check("with the ledger unavailable, connecting succeeds but consent is NOT granted (fail closed)", r.ok && r.consentRecorded === false && (await conn(4)).marketing_consent === false);

  // withdrawal through the API without the ledger
  await person(5, { consent: true });
  await sub(5, { email: true });
  as(5);
  const w = await put({ profile_id: prof.c1, channel: "email", enabled: false });
  check("withdrawing through the API with the ledger unavailable still works and says so", w.status === 200 && w.body.ledger_recorded === false && (await conn(5)).marketing_consent === false && (await prefs(5)).email_updates === false);
  const g = await put({ profile_id: prof.c1, channel: "email", enabled: true });
  check("granting through the API with the ledger unavailable is refused (503) and nothing changes", g.status === 503 && g.body.error === "consent_unavailable" && (await conn(5)).marketing_consent === false && (await prefs(5)).email_updates === false);
  check("GET still works and shows the withdrawn channel as OFF", (await get()).status === 200 && (await get()).body.items[0].email.on === false);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("F. static guarantees: ");
{
  const mig = read("supabase/migrations/2027-01-17_customer_consent_events.sql").replace(/--[^\n]*/g, "");
  const files = ["src/lib/customer/consent.ts", "src/lib/customer/consentHandlers.ts", "src/app/api/customer/consent/route.ts", "src/components/my-ringo/ConsentSection.tsx"].map((f) => [f, read(f)]);
  check("the migration is additive: one new table, no change to an existing table's structure, one transaction", (mig.match(/create table/gi) || []).length === 1 && !/alter table public\.(customer_connections|community_|ringo_customers|profiles)/i.test(mig) && /^\s*begin;/m.test(mig) && /commit;\s*$/.test(mig.trim()));
  check("the migration writes no consent row of its own (no insert into the ledger, no backfill)", !/insert into public\.customer_consent_events[^;]*select/i.test(mig) && !/insert into public\.customer_consent_events/i.test(mig.replace(/create or replace function[\s\S]*?\$\$;/gi, "")));
  check("the migration has a rollback and a verify file", fs.existsSync(path.join(REPO, "supabase/support/2027-01-17_customer_consent_events.rollback.sql")) && fs.existsSync(path.join(REPO, "supabase/support/2027-01-17_customer_consent_events.verify.sql")));
  check("no consent file can send anything (no email, push or WhatsApp sender is imported) and none mentions WhatsApp as a channel", files.every(([, c]) => !/sendEmail|sendPush|notifyCustomer|whatsapp\s*:/i.test(c.replace(/\/\/[^\n]*/g, ""))));
  check("the route takes the customer from the cookie, checks the origin, and never reads a customer id from the request", /getCustomerFromCookie/.test(files[2][1]) && /isSameOrigin/.test(files[2][1]) && !/customer_id|customerId\s*[:=]\s*(body|params)/.test(files[2][1]));
  check("the handlers accept only profile_id, channel and enabled", /\["profile_id", "channel", "enabled"\]/.test(files[1][1]));
  const comm = read("src/app/api/community/manage/[token]/route.ts");
  check("the Community unsubscribe and preference routes go through the consent library", /withdrawForSubscriber/.test(comm) && /grantConsent/.test(comm) && /withdrawConsent/.test(comm));
  const conn_ = read("src/lib/customer/connect.ts");
  check("connect.ts no longer writes marketing_consent = true directly and syncs through the one rule", !/marketing_consent:\s*true/.test(conn_) && /applyPendingEmail/.test(conn_) && !/\.eq\("marketing_consent", true\)/.test(conn_));
}

await H.close();
process.exit(summary());
