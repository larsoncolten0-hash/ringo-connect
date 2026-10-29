// Customer marketing consent (Phase 3A) - the security and consistency review, validated OFFLINE on scratch in-memory PostgreSQL (PGlite) with the REAL migrations and the REAL code:
//   G. the Community preferences page: only a CHANGE is a decision (saving unrelated preferences never grants), a disconnected customer can always withdraw and can never grant, refusals are explicit;
//   H. a ledger outage: a withdrawal made while the ledger was down stays withdrawn after recovery, and the ledger catches up on the next decision;
//   I. the announcement sender: a withdrawn customer is never emailed or pushed, nobody else is affected, transactional notifications never pass through consent;
//   J. the migration lifecycle: append-only (update, delete, truncate), re-run, foreign-object refusal, preconditions, the verify script, and rollback protection.
// No Supabase, no network, no message is ever sent (the senders are recording doubles).
//   Run:  node scripts/tests/customerConsentSafety.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({});
const { F, jiti } = H;
const { prof } = F;
const { check, eq, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG_FILES = ["2026-09-19_community_system", "2026-10-17_ringo_customers_core", "2026-10-23_community_push_channel", "2027-01-17_customer_consent_events"];
const MIGS = MIG_FILES.map((f) => read(`supabase/migrations/${f}.sql`));
const LEDGER_MIG = MIGS[3];
const CONS = jiti(path.join(SRC, "lib/customer/consent.ts"));
const CONNECT = jiti(path.join(SRC, "lib/customer/connect.ts"));

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
  await H.db.exec(`insert into public.ringo_customers (id, name, email, email_verified_at) values ('${cu(n)}','Person ${n}','p${n}@example.test', ${o.confirmed === false ? "null" : "'2026-10-01T10:00:00Z'"}) on conflict do nothing`);
  const status = o.status ?? "active";
  await H.db.exec(`insert into public.customer_connections (customer_id, profile_id, status, disconnected_at, marketing_consent, marketing_consent_at)
    values ('${cu(n)}','${prof.c1}','${status}', ${status === "disconnected" ? "now()" : "null"}, ${o.consent ? "true" : "false"}, ${o.consent ? "'2026-10-20T10:00:00Z'" : "null"})`);
}
async function sub(n, o = {}) {
  await H.db.exec(`insert into public.community_subscribers (id, profile_id, name, email, status, created_at) values ('${sid(n)}','${prof.c1}','Person ${n}','p${n}@example.test','${o.status ?? "active"}','2026-10-20T10:00:00Z')`);
  await H.db.exec(`insert into public.community_subscription_preferences (subscriber_id, email_updates, push_updates) values ('${sid(n)}', ${o.email === true}, ${o.push !== false})`);
  if (o.link !== false) await H.db.exec(`update public.customer_connections set community_subscriber_id = '${sid(n)}' where customer_id = '${cu(n)}' and profile_id = '${prof.c1}'`);
}
const events = (n) => q(`select channel, action, source from public.customer_consent_events where customer_id = '${cu(n)}' order by seq`);
const conn = async (n) => (await q(`select status, marketing_consent from public.customer_connections where customer_id = '${cu(n)}'`))[0];
const prefs = async (n) => (await q(`select email_updates, push_updates, notify_products from public.community_subscription_preferences where subscriber_id = '${sid(n)}'`))[0];
const token = async (n) => (await q(`select unsubscribe_token::text as t from public.community_subscribers where id = '${sid(n)}'`))[0].t;
const manage = (n, body) => token(n).then((t) => H.call(null, "POST", "community/manage/[token]", { params: { token: t }, body }));
const get = () => H.call(null, "GET", "customer/consent");
const put = (body) => H.call(null, "PUT", "customer/consent", { body });
const owner = async (sql) => { try { await H.db.exec(sql); return null; } catch (e) { return String(e.message); } };
const rpc = (c, ch, a, s = "my_ringo") => sdb().rpc("customer_consent_set", { p_customer: cu(c), p_profile: prof.c1, p_channel: ch, p_action: a, p_source: s });
const dropWriter = () => H.db.exec("drop function public.customer_consent_set(uuid, uuid, text, text, text)");
const restoreWriter = () => H.db.exec(LEDGER_MIG);

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("G. the Community preferences page: ");
await fresh();
{
  // a legacy member (consent flag on, switches on, no ledger row) saves the page without changing email or push
  await person(1, { consent: true });
  await sub(1, { email: true, push: true });
  let r = await manage(1, { email_updates: true, whatsapp_updates: false, push_updates: true, notify_products: false, notify_music: true, notify_events: true, notify_announcements: true, notify_offers: true });
  check("saving unrelated preferences records NO consent decision (an unchanged switch is not a grant)", r.status === 200 && (await events(1)).length === 0 && (await prefs(1)).notify_products === false);
  check("...and leaves the legacy flag and both switches exactly as they were", (await conn(1)).marketing_consent === true && (await prefs(1)).email_updates === true && (await prefs(1)).push_updates === true);
  r = await manage(1, { email_updates: false, push_updates: true });
  check("turning email OFF (a change) is recorded as a withdrawal and clears the legacy flag", r.status === 200 && (await events(1)).map((e) => `${e.channel}:${e.action}:${e.source}`).join() === "email:revoked:community_manage" && (await conn(1)).marketing_consent === false && (await prefs(1)).email_updates === false);
  check("turning push OFF (a change) is recorded too, and the switch is off", (await manage(1, { push_updates: false })).status === 200 && (await events(1)).some((e) => e.channel === "push" && e.action === "revoked") && (await prefs(1)).push_updates === false);

  // a disconnected customer
  await person(2, { consent: true, status: "disconnected" });
  await sub(2, { email: true, push: true });
  r = await manage(2, { email_updates: false });
  check("a DISCONNECTED customer can always withdraw: applied and recorded", r.status === 200 && (await prefs(2)).email_updates === false && (await events(2)).some((e) => e.channel === "email" && e.action === "revoked") && (await conn(2)).marketing_consent === false);
  r = await manage(2, { email_updates: true, notify_products: false });
  check("...but cannot grant: 409 not_connected, the switch stays OFF, nothing is recorded as a grant", r.status === 409 && r.body.error === "not_connected" && r.body.blocked.join() === "email_updates" && (await prefs(2)).email_updates === false && !(await events(2)).some((e) => e.action === "granted"));
  check("...and the rest of the change in the same request still applies", (await prefs(2)).notify_products === false);
  check("a disconnected customer is not listed or switched on in My Ringo either", (await (async () => { as(2); const g = await get(); as(null); return g.body.items.length; })()) === 0);
  await person(3, { consent: true, status: "disconnected" });
  await sub(3, { email: true, push: true });
  r = await manage(3, { unsubscribe: true });
  check("a full unsubscribe works for a disconnected customer and records both withdrawals", r.status === 200 && (await events(3)).map((e) => e.channel).sort().join() === "email,push" && (await conn(3)).marketing_consent === false);

  // a connected customer: an explicit change ON is a recorded grant; with the writer missing it is refused (503) and nothing is switched on
  await person(4, { consent: false });
  await sub(4, { email: false, push: false });
  r = await manage(4, { push_updates: true });
  check("a connected customer turning push ON is an explicit, recorded grant", r.status === 200 && (await events(4)).some((e) => e.channel === "push" && e.action === "granted" && e.source === "community_manage") && (await prefs(4)).push_updates === true);
  await person(5, { consent: false });
  await sub(5, { email: false, push: false });
  await dropWriter();
  r = await manage(5, { email_updates: true });
  check("with the ledger unavailable the grant is refused (503 consent_unavailable) and nothing is switched on", r.status === 503 && r.body.error === "consent_unavailable" && (await prefs(5)).email_updates === false && (await conn(5)).marketing_consent === false);
  await restoreWriter();
  const page = read("src/app/community/manage/[token]/page.tsx");
  check("the page no longer reports 'saved' for a refused save: it shows what is stored and says why", /res\.status === 409/.test(page) && /setSaved\(res\.ok\)/.test(page) && /consentNotConnected/.test(page) && /consentUnavailable/.test(page));
  const T = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;
  check("both refusal messages exist in English and French", T.en.communityJoin.consentNotConnected && T.fr.communityJoin.consentNotConnected && T.en.communityJoin.consentUnavailable && T.fr.communityJoin.consentUnavailable && T.en.communityJoin.consentNotConnected !== T.fr.communityJoin.consentNotConnected);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("H. a ledger outage and its recovery: ");
await fresh();
{
  await person(1);
  await sub(1, { email: false, push: false });
  as(1);
  let r = await put({ profile_id: prof.c1, channel: "email", enabled: true });
  await put({ profile_id: prof.c1, channel: "push", enabled: true });
  check("setup: email and push are granted and ON", r.body.item.email.on === true && (await get()).body.items[0].push.on === true);
  const before = (await events(1)).length;
  await dropWriter();
  r = await put({ profile_id: prof.c1, channel: "email", enabled: false });
  const r2 = await put({ profile_id: prof.c1, channel: "push", enabled: false });
  check("withdrawals made while the writer is unavailable still work and say the ledger did not record them", r.status === 200 && r2.status === 200 && r.body.ledger_recorded === false && r2.body.ledger_recorded === false && (await events(1)).length === before);
  check("the live state is withdrawn: the email flag, both switches", (await conn(1)).marketing_consent === false && (await prefs(1)).email_updates === false && (await prefs(1)).push_updates === false);
  await restoreWriter();
  const g = (await get()).body.items[0];
  check("AFTER RECOVERY the older grants are still the latest ledger rows, yet both channels read OFF (the stale grant does not become consent)", (await events(1)).slice(-2).every((e) => e.action === "granted") && g.email.on === false && g.push.on === false && g.push.reason === "switched_off");
  await CONNECT.syncMarketingSubscribers(sdb(), { id: cu(1), name: "Person 1", email: "p1@example.test", phone: null });
  check("a synchronisation after recovery does not switch email back on", (await prefs(1)).email_updates === false);
  r = await put({ profile_id: prof.c1, channel: "email", enabled: false });
  check("the ledger catches up on the next decision: a withdrawal after recovery appends the missing revoke", (await events(1)).filter((e) => e.channel === "email" && e.action === "revoked").length === 1);
  r = await put({ profile_id: prof.c1, channel: "email", enabled: true });
  check("an explicit new grant after recovery is a new ledger row and switches email on again", r.body.item.email.on === true && (await events(1)).filter((e) => e.channel === "email").map((e) => e.action).join() === "granted,revoked,granted");
  r = await put({ profile_id: prof.c1, channel: "push", enabled: false });
  check("push: the next withdrawal after recovery appends the missing revoke, and the sender veto then covers it", (await events(1)).filter((e) => e.channel === "push").map((e) => e.action).join() === "granted,revoked" && (await CONS.withdrawnSubscribers(sdb(), prof.c1, [sid(1)], "push")).has(sid(1)));

  // a momentary failure: a withdrawal is tried twice, a grant is not
  const real = sdb();
  let fails = 1;
  const flaky = { from: (t) => real.from(t), rpc: (fn, args) => (fails-- > 0 ? Promise.resolve({ data: null, error: { message: "boom" } }) : real.rpc(fn, args)) };
  await person(2);
  await sub(2, { email: true, push: false });
  await H.db.exec(`update public.customer_connections set marketing_consent = true, marketing_consent_at = now() where customer_id = '${cu(2)}'`);
  const w = await CONS.withdrawConsent(flaky, { customerId: cu(2), profileId: prof.c1, channel: "email", source: "my_ringo" });
  check("a momentary failure of the writer does not lose a withdrawal: it is retried and recorded", w.ledgerRecorded === true && (await events(2)).some((e) => e.action === "revoked"));
  fails = 1;
  const gr = await CONS.grantConsent(flaky, { customer: { id: cu(2), name: "Person 2", email: "p2@example.test", phone: null, emailConfirmed: true }, profileId: prof.c1, channel: "push", source: "my_ringo" }, async () => {});
  check("...but a grant is never retried into existence: it fails closed", gr.ok === false && !(await events(2)).some((e) => e.channel === "push"));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("I. the announcement sender: ");
await fresh();
{
  const sent = { emails: [], pushes: [], customerPushes: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consent_send_stubs_"));
  const stub = (name, src) => { const f = path.join(dir, name + ".cjs"); fs.writeFileSync(f, src); return f; };
  const alias = {
    "@/lib/email/provider": stub("provider", "module.exports = { sendEmail: async (m) => { globalThis.__sent.emails.push(m.to); return { ok: true, providerMessageId: 'x' }; } };"),
    "@/lib/email/renderAnnouncementEmail": stub("render", "module.exports = { renderAnnouncementEmail: () => '<p>x</p>' };"),
    "@/lib/push/send": stub("pushsend", "module.exports = { sendPushToSubscriber: async (a, id) => { globalThis.__sent.pushes.push(id); return false; } };"),
    "@/lib/customer/inbox": stub("inbox", "module.exports = { notifyCustomer: async (id) => { globalThis.__sent.customerPushes.push(id); return true; } };"),
    "@/lib/deepLinks": stub("deeplinks", "module.exports = { itemPath: () => '/x' };"),
    "@/lib/linkUrl": stub("linkurl", "module.exports = { safeExternalUrl: (u) => u };"),
    "@": SRC,
  };
  globalThis.__sent = sent;
  const SEND = createRequire(import.meta.url)("jiti")(import.meta.url, { alias, interopDefault: true, cache: false })(path.join(SRC, "lib/community/send.ts"));

  // 1 legacy member (no ledger row), 2 withdrew in the ledger but stale switches are ON, 3 explicit grants, 4 a fan with no account
  for (const n of [1, 2, 3]) { await person(n, { consent: true }); await sub(n, { email: true, push: true }); }
  await rpc(2, "email", "revoked", "community_unsubscribe");
  await rpc(2, "push", "revoked", "community_unsubscribe");
  await H.db.exec(`update public.community_subscription_preferences set email_updates = true, push_updates = true where subscriber_id = '${sid(2)}'`); // a stale default switches them back on
  await rpc(3, "email", "granted");
  await rpc(3, "push", "granted");
  await H.db.exec(`insert into public.community_subscribers (id, profile_id, name, email) values ('${sid(4)}','${prof.c1}','Fan','p4@example.test')`);
  await H.db.exec(`insert into public.community_subscription_preferences (subscriber_id, email_updates, push_updates) values ('${sid(4)}', true, true)`);
  await H.db.exec(`insert into public.customer_connections (customer_id, profile_id, community_subscriber_id) select '${cu(1)}', '${prof.c2}', null where false`);

  const real = sdb();
  const rows = [1, 2, 3, 4].map((n) => ({ id: sid(n), email: `p${n}@example.test`, unsubscribe_token: "t" + n, community_subscription_preferences: { email_updates: true, push_updates: true } }));
  const chain = (data) => { const c = { select: () => c, eq: () => c, not: () => c, in: () => c, then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej), upsert: async () => ({ error: null }) }; return c; };
  const admin = { from: (t) => (t === "community_subscribers" ? chain(rows) : t === "community_delivery_logs" ? chain([]) : real.from(t)), rpc: (...a) => real.rpc(...a) };
  const announcement = { id: F.id("6", 1), audience: "all", channels: null, notification_category: "announcement", title: "Hello", message: "News", link_type: "none", link_ref_id: null, link_url: null, image_url: null };
  const profile = { id: prof.c1, username: "grace", name: "Grace", avatar_url: null, category: "church_ministries", about_location: null, about_email: null };
  const res = await SEND.sendAnnouncementToSubscribers(admin, announcement, profile);
  eq("email goes to the legacy member, the explicit grant and the fan - never to the withdrawn customer", sent.emails.sort(), ["p1@example.test", "p3@example.test", "p4@example.test"]);
  eq("push is attempted for the same three and never for the withdrawn customer", sent.pushes.sort(), [sid(1), sid(3), sid(4)].sort());
  eq("My Ringo devices are reached only for linked customers who did not withdraw", sent.customerPushes.sort(), [cu(1), cu(3)].sort());
  check("the recipient count reflects the veto", res.recipientCount === 3);
  // withdrawnSubscribers is conservative
  check("withdrawnSubscribers only ever names a customer whose LATEST decision is a withdrawal", (await CONS.withdrawnSubscribers(real, prof.c1, [sid(1), sid(2), sid(3), sid(4)], "email")).size === 1 && (await CONS.withdrawnSubscribers(real, prof.c1, [sid(2)], "email")).has(sid(2)));
  await rpc(2, "email", "granted");
  check("a later explicit grant lifts the veto", (await CONS.withdrawnSubscribers(real, prof.c1, [sid(2)], "email")).size === 0 && (await CONS.withdrawnSubscribers(real, prof.c1, [sid(2)], "push")).has(sid(2)));
  check("an unreadable ledger vetoes nothing (the live switches already hold the withdrawal)", (await CONS.withdrawnSubscribers({ from: () => { throw new Error("down"); } }, prof.c1, [sid(2)], "email")).size === 0);

  // every announcement sender goes through the one function, transactional notifications never touch consent
  const callers = ["src/app/api/community/announcements/[id]/send/route.ts", "src/app/api/community/notify/route.ts", "src/lib/ai/calendar/publish.ts"].map(read);
  check("the three announcement senders all call sendAnnouncementToSubscribers (the one place the veto lives)", callers.every((c) => /sendAnnouncementToSubscribers/.test(c)));
  const send = read("src/lib/community/send.ts");
  check("both the email and the push path are filtered by the veto", (send.match(/withdrawnSubscribers\(/g) || []).length === 2 && /emailWithdrawn\.has/.test(send) && /pushWithdrawn\.has/.test(send));
  const transactional = ["src/lib/customer/bookingPush.ts", "src/lib/customer/shopOrderPush.ts", "src/lib/loyalty/notify.ts", "src/lib/customer/inbox.ts", "src/lib/protection/disputeNotifications.ts", "src/lib/protection/fulfillmentNotifications.ts", "src/lib/protection/releaseNotifications.ts"];
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  check("transactional notifications (orders, bookings, tickets, loyalty, disputes) never read consent or Community switches", transactional.every((f) => !/lib\/customer\/consent|withdrawnSubscribers|community_subscription_preferences|marketing_consent|push_updates/.test(code(f))));
  check("the sender change only removes recipients (no new send, no new channel)", !/sendEmail\(|sendPushToSubscriber\(|notifyCustomer\(/.test(read("src/lib/customer/consent.ts")));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("J. the migration lifecycle: ");
await fresh();
{
  await person(1, { consent: true });
  await rpc(1, "email", "revoked", "my_ringo");
  check("append-only: update, delete AND truncate are refused even for the table owner", /append_only/.test(await owner("update public.customer_consent_events set action = 'granted'")) && /append_only/.test(await owner("delete from public.customer_consent_events")) && /append_only/.test(await owner("truncate public.customer_consent_events")) && (await events(1)).length === 1);
  check("the service role (and nobody else) can append directly, and cannot truncate", (await (async () => { await H.db.exec("set role service_role"); try { await H.db.exec(`insert into public.customer_consent_events (customer_id, profile_id, channel, action, source) values ('${cu(1)}','${prof.c1}','push','revoked','my_ringo')`); return null; } catch (e) { return String(e.message); } finally { await H.db.exec("reset role"); } })()) === null);
  eq("anon, authenticated and the service role cannot truncate or delete", [await owner("set role anon; truncate public.customer_consent_events"), 0].map((x) => (x === 0 ? 0 : /permission denied/.test(String(x)) ? 0 : x)), [0, 0]);
  await H.db.exec("reset role");
  check("re-running the migration is harmless and keeps every row", (await owner(LEDGER_MIG)) === null && (await events(1)).length === 2);

  // the verify script: every check says true
  const verify = read("supabase/support/2027-01-17_customer_consent_events.verify.sql");
  const out = await H.db.exec(verify);
  const flags = out.flatMap((r) => r.rows).filter((row) => "ok" in row);
  check("the verify script runs and every check is true", flags.length >= 6 && flags.every((row) => row.ok === true), JSON.stringify(flags));

  // rollback protection
  const rollback = read("supabase/support/2027-01-17_customer_consent_events.rollback.sql");
  const attempt = async (sql) => { const e = await owner(sql); if (e) await H.db.exec("rollback").catch(() => {}); return e; };
  const refused = await attempt(rollback);
  check("the rollback REFUSES to run while the ledger holds rows", /rollback refused: the ledger holds 2 row/.test(String(refused)) && !!(await q("select to_regclass('public.customer_consent_events') as t"))[0].t);
  const withFlag = rollback.replace(/\nbegin;\n/, "\nbegin;\nselect set_config('customer_consent_events.allow_data_loss', 'yes', true);\n");
  check("it proceeds only when the loss is confirmed explicitly, and then removes exactly the ledger and its three functions", (await attempt(withFlag)) === null && (await q("select to_regclass('public.customer_consent_events') as t"))[0].t === null && (await q("select count(*)::int as n from pg_proc where proname like 'customer_consent%'"))[0].n === 0 && (await conn(1)).marketing_consent !== undefined);
  check("the rollback is safe to run again", (await attempt(rollback)) === null);
  await restoreWriter();
  check("after a rollback the migration applies cleanly again and starts with an empty ledger", (await q("select count(*)::int as n from public.customer_consent_events"))[0].n === 0);

  // preconditions
  await fresh();
  await H.db.exec("drop table public.customer_consent_events cascade");
  await H.db.exec("create table public.customer_consent_events (id int)");
  check("it refuses to adopt a same-named table it does not manage", /not managed by this migration/.test(String(await attempt(LEDGER_MIG))));
  await H.db.exec("drop table public.customer_consent_events");
  await H.db.exec("alter table public.customer_connections drop column marketing_consent_at");
  check("it refuses when customer_connections lacks the consent columns", /missing columns/.test(String(await attempt(LEDGER_MIG))));
  await fresh();
  await H.db.exec("create function public.customer_consent_set(a int) returns int language sql as 'select 1'");
  await H.db.exec("drop table public.customer_consent_events cascade");
  check("it refuses when a same-named function it does not manage exists", /not managed by it/.test(String(await attempt(LEDGER_MIG))));
}

H.close && (await H.close());
process.exit(summary());
