// Churches & Ministries expansion, Phase 5B: notifications from a church, validated end to end and OFFLINE.
// The REAL route files (src/app/api/customer/church-push, src/app/api/cron/church-push), the REAL job (discover + dispatch), the REAL message builder and the REAL database functions run against scratch
// in-memory PostgreSQL (PGlite). The sender is a recording double: no push service, no network. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchPushApi.test.mjs
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, membership: true, bibleYear: true, push: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const TOP = jiti(path.join(SRC, "lib/church/push/topics.ts"));
const RUN = jiti(path.join(SRC, "lib/church/push/run.ts"));
const PLAN = jiti(path.join(SRC, "lib/church/bibleYear/plan.ts"));
const O = u.owner1;
const cu = (n) => F.id("7", n);
const as = (n) => { globalThis.__customer = n ? { customer: { id: cu(n), name: "Person " + n, email: `p${n}@example.test` }, sessionId: "s" + n } : null; };
const admin = () => { globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" }); };
const db = () => F.sessionFor(H.db, null, { role: "service_role" });
async function person(n, o = {}) {
  await F.svc(H.db, `insert into public.ringo_customers (id, name, email, preferred_language) values ('${cu(n)}','Person ${n}','p${n}@example.test','${o.lang ?? "en"}')`);
  if (o.connect !== false) await F.svc(H.db, `insert into public.customer_connections (customer_id, profile_id) values ('${cu(n)}','${o.profile ?? prof.c1}')`);
  if (o.topics) await F.svc(H.db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${cu(n)}','${o.profile ?? prof.c1}', ${F.q("{" + o.topics.join(",") + "}")})`);
}
const getPrefs = (n, profile = prof.c1) => { as(n); return H.call(null, "GET", `customer/church-push?profile_id=${profile}`); };
const putPrefs = (n, body) => { as(n); return H.call(null, "PUT", "customer/church-push", { body }); };
const delPrefs = (n, profile = prof.c1) => { as(n); return H.call(null, "DELETE", `customer/church-push?profile_id=${profile}`); };
const day = (d = 0) => new Date(Date.now() + 3600_000 + d * 86400_000).toISOString().slice(0, 10);

section("A. what a message is made of (pure): ");
{
  check("eight topics and eight kinds, each kind maps to one topic", TOP.PUSH_TOPICS.length === 8 && TOP.PUSH_KINDS.length === 8 && TOP.PUSH_KINDS.every((k) => TOP.PUSH_TOPICS.includes(TOP.TOPIC_OF_KIND[k])));
  check("isPushTopic / isPushKind accept only known words", TOP.isPushTopic("events") && !TOP.isPushTopic("sports") && !TOP.isPushTopic(null) && TOP.isPushKind("product") && !TOP.isPushKind("store"));
  check("the daily cap is 5", TOP.DAILY_CAP === 5);
  const dl = TOP.deepLink;
  check("deep links: every kind opens its own page under the church", dl("grace", "announcement") === "/grace/church/announcements" && dl("grace", "event") === "/grace/church/events" && dl("grace", "testimony") === "/grace/church/testimonies" && dl("grace", "care") === "/grace/church/care" && dl("grace", "bible_day") === "/grace/church/bible-year" && dl("grace", "daily_word") === "/grace#church-word");
  check("deep links: a group notice opens that group's page, a product opens its page", dl("grace", "group_announcement", { groupKind: "youths" }) === "/grace/church/groups/youths" && dl("grace", "group_announcement") === "/grace/church/groups" && dl("grace", "product", { productId: "p1" }) === "/grace/item/p1" && dl("grace", "product") === "/grace/shop");
  check("a username is encoded in a link", dl("a b/c", "event") === "/a%20b%2Fc/church/events");
  const safe = TOP.safeDeepLink;
  check("safeDeepLink: only a path under the church's own address", safe("/grace/church/events", "grace") === "/grace/church/events" && safe("/grace", "grace") === "/grace" && safe("/grace#church-word", "grace") === "/grace#church-word");
  check("safeDeepLink: refuses another church, an outside link, a protocol-relative link, spaces, a backslash, a long path", [safe("/other/church/events", "grace"), safe("https://evil.example.com", "grace"), safe("//evil.example.com/grace", "grace"), safe("/grace/a b", "grace"), safe("/grace\\x", "grace"), safe("/grace/" + "x".repeat(400), "grace"), safe(null, "grace"), safe("/graceful", "grace")].every((x) => x === null));
  const pl = TOP.buildPayload({ title_en: "  Sunday   service ", title_fr: "", path: "/grace/church/events", group_id: "gid" });
  check("buildPayload keeps a clean title, drops an empty one, keeps the group", pl.title_en === "Sunday service" && !("title_fr" in pl) && pl.path === "/grace/church/events" && pl.group_id === "gid");
  check("buildPayload cuts a very long title", TOP.buildPayload({ title_en: "x".repeat(500), path: "/g" }).title_en.length === 140);
  const church = { name: "Grace Church", username: "grace" };
  const msg = (kind, o = {}) => TOP.buildMessage({ kind, lang: "en", church, payload: { title_en: "Youth night", title_fr: "Soirée jeunes", path: TOP.deepLink("grace", kind) }, ...o });
  eq("an announcement: the church is the title, the public title in the body", [msg("announcement").title, msg("announcement").body, msg("announcement").url], ["Grace Church", "New announcement: Youth night", "/grace/church/announcements"]);
  eq("...in French", TOP.buildMessage({ kind: "announcement", lang: "fr", church, payload: { title_en: "Youth night", title_fr: "Soirée jeunes", path: "/grace/church/announcements" } }).body, "Nouvelle annonce : Soirée jeunes");
  eq("a missing French title falls back to the English one", TOP.buildMessage({ kind: "event", lang: "fr", church, payload: { title_en: "Youth night", path: "/grace/church/events" } }).body, "Nouvel événement : Youth night");
  eq("no title at all gives a plain sentence", TOP.buildMessage({ kind: "event", lang: "en", church, payload: { path: "/grace/church/events" } }).body, "A new event was added.");
  eq("a testimony notice NEVER carries words, whatever the payload holds", msg("testimony").body, "A new testimony was shared.");
  check("a message holds the church name, a sentence and a link: no phone, e-mail or roster word", ["announcement", "group_announcement", "event", "testimony", "daily_word", "care", "product"].every((k) => { const m = msg(k); return !/@|\+237|member|membre/i.test(`${m.title} ${m.body}`); }));
  eq("a body is at most 180 characters", msg("announcement", { payload: { title_en: "x".repeat(140), path: "/grace/church/announcements" } }).body.length <= 180, true);
  eq("a link outside the church makes the message null (not sent)", TOP.buildMessage({ kind: "event", lang: "en", church, payload: { path: "https://evil.example.com" } }), null);
  const start = day(-9);
  eq("the daily Bible reading is the reader's own day (the 10th)", TOP.buildMessage({ kind: "bible_day", lang: "en", church, payload: { path: "/grace/church/bible-year" }, start, today: day() }).body, `Day 10: ${PLAN.referenceOf(PLAN.readingForDay(10), "en")}`);
  eq("...in French", TOP.buildMessage({ kind: "bible_day", lang: "fr", church, payload: { path: "/grace/church/bible-year" }, start, today: day() }).body, `Jour 10 : ${PLAN.referenceOf(PLAN.readingForDay(10), "fr")}`);
  eq("a reader's start date is needed", TOP.buildMessage({ kind: "bible_day", lang: "en", church, payload: { path: "/grace/church/bible-year" } }), null);
  eq("a reader who finished the plan gets the plain sentence", TOP.buildMessage({ kind: "bible_day", lang: "en", church, payload: { path: "/grace/church/bible-year" }, start: day(-400), today: day() }).body, "Your Bible reading for today is ready.");
}

section("B. the visitor's choices: ");
{
  await H.fresh("");
  admin();
  as(null);
  is("no visitor cookie: 401", await H.call(null, "GET", `customer/church-push?profile_id=${prof.c1}`), 401);
  is("no visitor cookie, PUT: 401", await H.call(null, "PUT", "customer/church-push", { body: { profile_id: prof.c1, topics: [] } }), 401);
  await person(1);
  await person(2, { connect: false });
  const g0 = await getPrefs(1);
  check("a connected visitor sees: connected, nothing chosen, the topics on offer (not the Bible reading), no device", g0.status === 200 && g0.body.connected === true && g0.body.topics.length === 0 && g0.body.available.length === 7 && !g0.body.available.includes("bible_day") && g0.body.devices === 0, JSON.stringify(g0.body));
  is("a bad profile id: 404", await getPrefs(1, "nope"), 404);
  is("a page that is not a church: 404", await getPrefs(1, prof.nc), 404, "church_unavailable");
  const g2 = await getPrefs(2);
  check("a visitor who is not connected sees: not connected", g2.status === 200 && g2.body.connected === false);
  is("a visitor who is not connected cannot choose: 403", await putPrefs(2, { profile_id: prof.c1, topics: ["events"] }), 403, "church_push_not_connected");
  is("only known topics: 400", await putPrefs(1, { profile_id: prof.c1, topics: ["events", "sports"] }), 400, "invalid_topics");
  is("topics must be a list: 400", await putPrefs(1, { profile_id: prof.c1, topics: "events" }), 400, "invalid_topics");
  is("the Bible reading is not on offer until the church switches the plan on: 400", await putPrefs(1, { profile_id: prof.c1, topics: ["bible_day"] }), 400, "invalid_topics");
  is("the visitor id cannot be sent: 400", await putPrefs(1, { profile_id: prof.c1, topics: [], customer_id: cu(2) }), 400, "unexpected_field");
  const ok = await putPrefs(1, { profile_id: prof.c1, topics: ["events", "announcements", "events"] });
  is("a choice is saved", ok, 200, "ok");
  eq("...without duplicates", ok.body.topics, ["events", "announcements"]);
  eq("...and read back (sorted by the database)", (await getPrefs(1)).body.topics.slice().sort(), ["announcements", "events"]);
  is("a second choice replaces the first", await putPrefs(1, { profile_id: prof.c1, topics: ["care"] }), 200, "ok");
  eq("...", (await getPrefs(1)).body.topics, ["care"]);
  await H.call(O, "PUT", "church/features", { body: { bible_year: true } });
  const withBible = await getPrefs(1);
  check("once the church offers the plan, the Bible reading is on offer", withBible.body.available.includes("bible_day") && withBible.body.available.length === 8);
  is("...and can be chosen", await putPrefs(1, { profile_id: prof.c1, topics: ["bible_day", "care"] }), 200, "ok");
  await F.svc(H.db, `insert into public.customer_push_subscriptions (customer_id, endpoint, p256dh, auth) values ('${cu(1)}','https://push.example.test/1','k','a')`);
  eq("the number of registered devices is shown", (await getPrefs(1)).body.devices, 1);
  is("an empty list turns everything off", await putPrefs(1, { profile_id: prof.c1, topics: [] }), 200, "ok");
  eq("...and the row is gone", (await H.rows("select count(*)::int n from public.church_push_prefs"))[0].n, 0);
  await putPrefs(1, { profile_id: prof.c1, topics: ["events"] });
  is("DELETE turns everything off", await delPrefs(1), 200, "ok");
  eq("...", (await getPrefs(1)).body.topics, []);
  is("a staff session does not open the visitor route: 401", await (async () => { as(null); return H.call(u.mgr1, "GET", `customer/church-push?profile_id=${prof.c1}`); })(), 401);
  is("a request from another site is refused: 403", await (async () => { as(1); globalThis.__sameOrigin = false; const r = await H.call(null, "PUT", "customer/church-push", { body: { profile_id: prof.c1, topics: [] } }); globalThis.__sameOrigin = undefined; return r; })(), 403);
  check("the answers hold no name, no e-mail and no other visitor", !/Person|@example/.test(JSON.stringify(await getPrefs(1))));
}

section("C. finding what is new: ");
{
  await H.fresh("");
  await H.db.exec("create table if not exists public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, name text, created_at timestamptz not null default now())");
  await H.db.exec("grant all on public.products to service_role");
  await F.svc(H.db, `update public.profiles set username = 'grace' where id = '${prof.c1}'; update public.profiles set username = 'second' where id = '${prof.c2}'; update public.profiles set username = 'bizz' where id = '${prof.nc}'`);
  const S = (sql) => F.svc(H.db, sql);
  // content of the first church: published, draft, expired, group-only, cancelled, past
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 1)}','${prof.c1}','published','Welcome','Body'), ('${F.id("2", 2)}','${prof.c1}','draft','Hidden','Body')`);
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en, expires_on) values ('${F.id("2", 3)}','${prof.c1}','published','Old','Body','${day(-3)}')`);
  await S(`insert into public.church_public_groups (id, profile_id, kind, is_published) values ('${F.id("8", 1)}','${prof.c1}','youths',true)`);
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en, public_group_id) values ('${F.id("2", 4)}','${prof.c1}','published','Youth night','Body','${F.id("8", 1)}')`);
  await S(`insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${F.id("1", 1)}','${prof.c1}','published','${day(5)}','Harvest'), ('${F.id("1", 2)}','${prof.c1}','draft','${day(5)}','Draft event'), ('${F.id("1", 3)}','${prof.c1}','published','${day(-2)}','Past event')`);
  await S(`insert into public.ministry_events (id, profile_id, status, event_date, title_en, is_cancelled) values ('${F.id("1", 4)}','${prof.c1}','published','${day(6)}','Cancelled one', true)`);
  await S(`insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, body, lang, publish_consent) values ('${F.id("4", 1)}','${prof.c1}','${F.id("5", 1)}','Marie Ngono','237670000111','God healed me from a long illness and I am well.','en', true)`);
  await S(`update public.ministry_testimonies set review_status = 'approved' where id = '${F.id("4", 1)}'`);
  await S(`update public.ministry_testimonies set publication_status = 'published' where id = '${F.id("4", 1)}'`);
  await S(`insert into public.daily_words (id, profile_id, publish_on, status, title_en, body_en) values ('${F.id("6", 1)}','${prof.c1}','${day()}','published','Grace','Body'), ('${F.id("6", 2)}','${prof.c1}','${day(1)}','published','Tomorrow','Body')`);
  await S(`insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${F.id("3", 1)}','${prof.c1}','Hospital bill','A family needs help.')`);
  await S(`insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${F.id("3", 1)}','granted','beneficiary','written')`);
  await S(`update public.ministry_care_cases set status = 'published' where id = '${F.id("3", 1)}'`);
  await S(`insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${F.id("3", 2)}','${prof.c1}','Private need','Not shared.')`);
  await S(`insert into public.products (id, profile_id, name) values ('${F.id("5", 11)}','${prof.c1}','Hymn book'), ('${F.id("5", 12)}','${prof.c1}','  ')`);
  await S(`insert into public.church_features (profile_id, bible_year) values ('${prof.c1}', true)`);
  // another church (c2: category 'other' with the church flag in categories) and a non-church profile must be handled too
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 9)}','${prof.c2}','published','Second church','Body')`);
  await S(`update public.profiles set is_demo = true where id = '${prof.c3}'`);
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 10)}','${prof.c3}','published','Demo church','Body')`);
  const r1 = await RUN.discover(db());
  check("it found one of each: announcement, group notice, event, testimony, Daily Word, care need, product, Bible reading (+ the second church's announcement)", r1.errors === 0 && r1.queued.announcement === 2 && r1.queued.group_announcement === 1 && r1.queued.event === 1 && r1.queued.testimony === 1 && r1.queued.daily_word === 1 && r1.queued.care === 1 && r1.queued.product === 1 && r1.queued.bible_day === 1, JSON.stringify(r1));
  const queue = await H.rows("select kind, ref, profile_id, run_at, payload from public.church_push_outbox order by kind, ref");
  check("a draft, an expired notice, a past or cancelled event, tomorrow's word, a private care case, an unnamed product were NOT queued", !queue.some((q) => [F.id("2", 2), F.id("2", 3), F.id("1", 2), F.id("1", 3), F.id("1", 4), F.id("6", 2), F.id("3", 2), F.id("5", 12)].includes(q.ref)));
  check("a demo church queued nothing", !queue.some((q) => q.profile_id === prof.c3));
  const word = queue.find((q) => q.kind === "daily_word");
  check("the Daily Word waits for 07:00 in Cameroon (06:00 UTC)", new Date(word.run_at).toISOString() === `${day()}T06:00:00.000Z`, new Date(word.run_at).toISOString());
  const testimony = queue.find((q) => q.kind === "testimony");
  check("a testimony is queued WITHOUT any of its words, name or phone", JSON.stringify(testimony.payload) === JSON.stringify({ path: "/grace/church/testimonies" }) && !/Marie|healed|237/.test(JSON.stringify(testimony)), JSON.stringify(testimony.payload));
  const grp = queue.find((q) => q.kind === "group_announcement");
  check("a group notice goes to its group page and names the group", grp.payload.path === "/grace/church/groups/youths" && grp.payload.group_id === F.id("8", 1), JSON.stringify(grp.payload));
  const bible = queue.find((q) => q.kind === "bible_day");
  check("the Bible reading is queued once per church per day", bible.ref === day() && bible.payload.path === "/grace/church/bible-year");
  const r2 = await RUN.discover(db());
  check("running it again queues nothing new", Object.values(r2.queued).reduce((a, b) => a + b, 0) === 0 && (await H.rows("select count(*)::int n from public.church_push_outbox"))[0].n === queue.length, JSON.stringify(r2));
  const early = await RUN.discover(db(), Date.now() - 72 * 3600_000);
  check("an item older than 48 hours is never queued late (look-back window)", Object.values(early.queued).reduce((a, b) => a + b, 0) <= 3, JSON.stringify(early.queued));
  const broken = await RUN.discover({ from() { throw new Error("x"); }, rpc: async () => ({ data: null, error: { code: "x" } }) });
  check("a broken database makes the job report an error, never throw", broken.errors >= 1);
}

section("D. sending: ");
{
  await H.fresh("");
  await F.svc(H.db, `update public.profiles set username = 'grace', name = 'Grace Church' where id = '${prof.c1}'`);
  const S = (sql) => F.svc(H.db, sql);
  await person(1, { topics: ["announcements", "events", "testimonies", "daily_word", "care"], lang: "fr" });
  await person(2, { topics: ["announcements"], lang: "en" });
  await person(3, { topics: ["events"] });
  await person(4, { connect: true });
  await person(5, { topics: ["announcements"], lang: "en" });
  await F.svc(H.db, `update public.customer_connections set status = 'disconnected' where customer_id = '${cu(5)}'`);
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, title_fr, body_en) values ('${F.id("2", 1)}','${prof.c1}','published','Welcome home','Bienvenue à la maison','Body')`);
  await S(`insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${F.id("1", 1)}','${prof.c1}','published','${day(5)}','Harvest')`);
  await S(`insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, body, lang, publish_consent) values ('${F.id("4", 1)}','${prof.c1}','${F.id("5", 1)}','Marie Ngono','237670000111','Healed from a long illness.','en', true)`);
  await S(`update public.ministry_testimonies set review_status = 'approved' where id = '${F.id("4", 1)}'`);
  await S(`update public.ministry_testimonies set publication_status = 'published' where id = '${F.id("4", 1)}'`);
  await RUN.discover(db());
  const sent = [];
  const send = async (customerId, p) => { sent.push({ customerId, ...p }); return true; };
  const d1 = await RUN.dispatch(db(), send);
  const to = (cid) => sent.filter((s) => s.customerId === cid);
  eq("the opted-in people received the right items", [to(cu(1)).length, to(cu(2)).length, to(cu(3)).length, to(cu(4)).length, to(cu(5)).length], [3, 1, 1, 0, 0]);
  check("person 1 (French) got the announcement, the event and the testimony in French", to(cu(1)).some((m) => m.body === "Nouvelle annonce : Bienvenue à la maison") && to(cu(1)).some((m) => m.body === "Nouvel événement : Harvest") && to(cu(1)).some((m) => m.body === "Un nouveau témoignage a été partagé."), JSON.stringify(to(cu(1)).map((m) => m.body)));
  check("person 2 (English) got the announcement in English", to(cu(2))[0].body === "New announcement: Welcome home" && to(cu(2))[0].title === "Grace Church");
  check("person 3 only got the event", to(cu(3)).length === 1 && /Harvest/.test(to(cu(3))[0].body));
  check("nobody who did not opt in to the topic, or who disconnected, got anything", to(cu(4)).length === 0 && to(cu(5)).length === 0);
  check("every message is a church message with a link under the church's address", sent.every((m) => m.category === "church" && /^\/grace(\/|#|$)/.test(m.url)));
  check("no message holds a name, a phone number or the testimony's words", !sent.some((m) => /Marie|Ngono|237670|Healed|illness|@example/.test(`${m.title} ${m.body}`)));
  check("the counts add up: 3 notifications claimed, 5 sent", d1.claimed === 3 && d1.sent === 5 && d1.failed === 0 && d1.skipped === 0, JSON.stringify(d1));
  check("the delivery notes exist (one per person and notification)", (await H.rows("select count(*)::int n from public.church_push_deliveries where delivered"))[0].n === 5);
  check("every notification is closed as sent", (await H.rows("select count(*)::int n from public.church_push_outbox where status = 'sent'"))[0].n === 3);
  const before = sent.length;
  await RUN.discover(db());
  const d2 = await RUN.dispatch(db(), send);
  check("a second run sends NOTHING again", d2.claimed === 0 && sent.length === before, JSON.stringify(d2));
  // two runs at once never notify twice
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 2)}','${prof.c1}','published','Second notice','Body')`);
  await RUN.discover(db());
  const mark = sent.length;
  await Promise.all([RUN.dispatch(db(), send), RUN.dispatch(db(), send)]);
  eq("two runs at the same time notify each person once", sent.slice(mark).filter((m) => /Second notice/.test(m.body)).length, 2);
  // an item withdrawn before it is sent is skipped
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 3)}','${prof.c1}','published','Withdrawn soon','Body')`);
  await RUN.discover(db());
  await S(`update public.ministry_announcements set status = 'draft' where id = '${F.id("2", 3)}'`);
  const mark2 = sent.length;
  const d3 = await RUN.dispatch(db(), send);
  check("an announcement unpublished before sending is skipped, nobody is told", d3.skipped === 1 && sent.length === mark2, JSON.stringify(d3));
  // a failing sender
  await S(`insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${F.id("2", 4)}','${prof.c1}','published','Flaky','Body')`);
  await RUN.discover(db());
  const d4 = await RUN.dispatch(db(), async () => { throw new Error("push service down"); });
  check("a sender that throws is counted as failed, the run still completes", d4.failed === 2 && d4.claimed === 1, JSON.stringify(d4));
  check("a message that could not go out is noted as not delivered (so it does not count toward the cap)", (await H.rows(`select count(*)::int n from public.church_push_deliveries d join public.church_push_outbox o on o.id = d.outbox_id where o.ref = '${F.id("2", 4)}' and not d.delivered`))[0].n === 2);
  // the cap
  const cap = await H.rows("select count(*)::int n from public.church_push_deliveries where customer_id = '" + cu(2) + "' and delivered");
  check("a person never gets more than 5 church messages in a day", cap[0].n <= 5);
}

section("E. the daily Bible reading: ");
{
  await H.fresh("");
  await F.svc(H.db, `update public.profiles set username = 'grace', name = 'Grace Church' where id = '${prof.c1}'`);
  await F.svc(H.db, `insert into public.church_features (profile_id, bible_year) values ('${prof.c1}', true)`);
  await person(1, { topics: ["bible_day"], lang: "fr" });
  await person(2, { topics: ["bible_day"], lang: "en" });
  await person(3, { topics: ["bible_day"] });
  await person(4, { topics: ["events"] });
  await F.svc(H.db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${cu(1)}','${prof.c1}'), ('${cu(2)}','${prof.c1}'), ('${cu(4)}','${prof.c1}')`);
  await H.db.exec(`alter table public.bible_year_enrollments disable trigger user; update public.bible_year_enrollments set start_date = public.ministry_today() - 9 where customer_id = '${cu(1)}'; update public.bible_year_enrollments set start_date = public.ministry_today() - 99 where customer_id = '${cu(2)}'; alter table public.bible_year_enrollments enable trigger user;`);
  const sent = [];
  await RUN.discover(db());
  // the reading is due at 07:00 Cameroon time: make it due now
  await H.db.exec("update public.church_push_outbox set run_at = now() - interval '1 minute'");
  await RUN.dispatch(db(), async (cid, p) => { sent.push({ cid, ...p }); return true; });
  const m1 = sent.find((s) => s.cid === cu(1)), m2 = sent.find((s) => s.cid === cu(2));
  eq("each reader gets their OWN day: the 10th for the first (in French)", m1 && m1.body, `Jour 10 : ${PLAN.referenceOf(PLAN.readingForDay(10), "fr")}`);
  eq("...the 100th for the second (in English)", m2 && m2.body, `Day 100: ${PLAN.referenceOf(PLAN.readingForDay(100), "en")}`);
  check("only readers who opted in to it were notified (not the non-reader, not the one who chose another topic)", sent.length === 2, JSON.stringify(sent.map((s) => s.cid)));
  check("the link opens the reader's plan", sent.every((s) => s.url === "/grace/church/bible-year"));
}

section("F. the cron route and privacy (static): ");
{
  const fs = await import("fs");
  const code = (p) => fs.readFileSync(path.join(SRC, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const route = code("app/api/cron/church-push/route.ts");
  check("the cron route demands the secret", /CRON_SECRET/.test(route) && /Bearer \$\{process\.env\.CRON_SECRET\}/.test(route) && /status: 401/.test(route));
  const ghosts = jiti(path.join(SRC, "app/api/cron/church-push/route.ts"));
  const noSecret = await ghosts.GET(new Request("http://t/api/cron/church-push"));
  check("without the secret: 401", noSecret.status === 401);
  process.env.CRON_SECRET = "s3cret";
  const wrong = await ghosts.GET(new Request("http://t/api/cron/church-push", { headers: { authorization: "Bearer nope" } }));
  check("with a wrong secret: 401", wrong.status === 401);
  const vercel = JSON.parse(fs.readFileSync(path.join(SRC, "..", "vercel.json"), "utf8"));
  check("the job is scheduled once a day at 06:00 UTC (07:00 in Cameroon) in vercel.json", vercel.crons.some((c) => c.path === "/api/cron/church-push" && c.schedule === "0 6 * * *"));
  // the Vercel Hobby plan refuses any cron that would run more than once a day: a fixed minute and a fixed hour, every other field "*"
  check("every cron in vercel.json runs at most once a day (Hobby plan)", vercel.crons.length > 0 && vercel.crons.every((c) => /^\d{1,2} \d{1,2} \* \* \*$/.test(c.schedule)), vercel.crons.map((c) => c.schedule).join(" | "));
  const run = code("lib/church/push/run.ts");
  check("the job writes only through the queue functions (no direct insert into a visitor table)", !/\.insert\(|\.update\(|\.delete\(/.test(run));
  const prefs = code("lib/church/push/prefs.ts");
  check("every preference statement is filtered by the visitor id", (prefs.match(/customer_id", ctx\.customerId\)/g) || []).length >= 4);
  const leaks = ["lib/ai", "lib/overview", "lib/reports", "lib/watchdog"].flatMap((d) => { const walk = (dir) => { try { return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])); } catch { return []; } }; return walk(d); }).filter((f) => /church_push_/.test(code(f)));
  check("no AI, overview, report or watchdog code reads the notification tables", leaks.length === 0, leaks.join());
}

await H.close();
process.exit(summary());
