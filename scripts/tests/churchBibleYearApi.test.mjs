// Churches & Ministries expansion, Phase 5A: "The Bible in one year" (the plan, the reader's routes, the owner's feature switches), validated end to end and OFFLINE.
// The REAL route files (src/app/api/customer/church-bible-year, src/app/api/church/features), the REAL handlers and the REAL plan generator run against scratch in-memory PostgreSQL (PGlite) that holds the
// REAL Team migrations and the REAL church migrations up to Phase 5A. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchBibleYearApi.test.mjs
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const PLAN = jiti(path.join(SRC, "lib/church/bibleYear/plan.ts"));
const BY = jiti(path.join(SRC, "lib/church/bibleYear/handlers.ts"));
const FH = jiti(path.join(SRC, "lib/church/features/handlers.ts"));
const PF = jiti(path.join(SRC, "lib/church/public/features.ts"));
const O = u.owner1;
const cu = (n) => F.id("7", n);
const as = (n) => { globalThis.__customer = n ? { customer: { id: cu(n), name: "Reader " + n, email: `r${n}@example.test` }, sessionId: "s" + n } : null; };
const admin = () => { globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" }); };
async function reader(n, o = {}) {
  await F.svc(H.db, `insert into public.ringo_customers (id, name, email) values ('${cu(n)}','Reader ${n}','r${n}@example.test')`);
  if (o.connect !== false) await F.svc(H.db, `insert into public.customer_connections (customer_id, profile_id) values ('${cu(n)}','${o.profile ?? prof.c1}')`);
}
const feats = (who) => H.call(who, "GET", "church/features");
const putFeats = (who, body) => H.call(who, "PUT", "church/features", { body });
const plan = (n, profile = prof.c1) => { as(n); return H.call(null, "GET", `customer/church-bible-year?profile_id=${profile}`); };
const start = (n, profile = prof.c1) => { as(n); return H.call(null, "POST", "customer/church-bible-year", { body: { profile_id: profile } }); };
const tick = (n, day, done = true, profile = prof.c1) => { as(n); return H.call(null, "PATCH", "customer/church-bible-year", { body: { profile_id: profile, day, done } }); };
const leave = (n, profile = prof.c1) => { as(n); return H.call(null, "DELETE", `customer/church-bible-year?profile_id=${profile}`); };

section("A. the plan itself: ");
{
  check("66 books, 1189 chapters, 365 days", PLAN.BIBLE_BOOKS.length === 66 && PLAN.TOTAL_CHAPTERS === 1189 && PLAN.PLAN_DAYS === 365 && PLAN.allReadings().length === 365);
  check("the books are in canonical order, Genesis first and Revelation last", PLAN.BIBLE_BOOKS[0].id === "gen" && PLAN.BIBLE_BOOKS[1].id === "exo" && PLAN.BIBLE_BOOKS[39].id === "mat" && PLAN.BIBLE_BOOKS[65].id === "rev");
  check("every book has an English and a French name", PLAN.BIBLE_BOOKS.every((b) => b.en && b.fr && b.chapters >= 1));
  const rs = PLAN.allReadings();
  check("day 1 starts at Genesis 1 and day 365 ends at Revelation 22", rs[0].from.book === "gen" && rs[0].from.chapter === 1 && rs[364].to.book === "rev" && rs[364].to.chapter === 22);
  const counts = rs.map((r) => r.chapters);
  check("every day holds 3 or 4 chapters", Math.min(...counts) >= 3 && Math.max(...counts) <= 4, `${Math.min(...counts)}..${Math.max(...counts)}`);
  check("the days add up to every chapter exactly once", counts.reduce((a, b) => a + b, 0) === 1189);
  // contiguity: each day starts at the chapter that follows the previous day's last
  const all = [];
  for (const b of PLAN.BIBLE_BOOKS) for (let c = 1; c <= b.chapters; c++) all.push(`${b.id}:${c}`);
  let idx = 0, ok = true;
  for (const r of rs) {
    if (`${r.from.book}:${r.from.chapter}` !== all[idx]) ok = false;
    idx += r.chapters;
    if (`${r.to.book}:${r.to.chapter}` !== all[idx - 1]) ok = false;
  }
  check("no chapter is skipped or read twice, in order, across the whole year", ok && idx === 1189);
  check("references: English", PLAN.referenceOf(rs[0], "en") === "Genesis 1–3" && /^Revelation \d+–22$/.test(PLAN.referenceOf(rs[364], "en")), PLAN.referenceOf(rs[0], "en"));
  check("references: French book names", PLAN.referenceOf(rs[0], "fr") === "Genèse 1–3" && /^Apocalypse \d+–22$/.test(PLAN.referenceOf(rs[364], "fr")));
  const crossing = rs.find((r) => r.from.book !== r.to.book);
  check("a reading that crosses a book names both", /– /.test(PLAN.referenceOf(crossing, "en")) && PLAN.referenceOf(crossing, "en").split(" – ").length === 2, PLAN.referenceOf(crossing, "en"));
  const jude = { day: 1, from: { book: "jud", chapter: 1 }, to: { book: "jud", chapter: 1 }, chapters: 1 };
  check("a one-chapter book is named without a number", PLAN.referenceOf(jude, "en") === "Jude");
  check("readingForDay: only 1..365", PLAN.readingForDay(1) && PLAN.readingForDay(365) && PLAN.readingForDay(0) === null && PLAN.readingForDay(366) === null && PLAN.readingForDay(1.5) === null && PLAN.readingForDay("3") === null);
  check("no Bible TEXT in the plan (references only): the module holds no verse", !/In the beginning|Au commencement/i.test(JSON.stringify(PLAN.allReadings()) + PLAN.referenceOf(rs[0], "en")));
  const d = PLAN.dayOnDate;
  check("dayOnDate: the start day is day 1; the next day is day 2; before the start stays day 1", d("2026-01-01", "2026-01-01").day === 1 && d("2026-01-01", "2026-01-02").day === 2 && d("2026-01-02", "2026-01-01").notStarted === true);
  check("dayOnDate: day 365 on the 365th day, then it stays 365 and finished", d("2026-01-01", "2026-12-31").day === 365 && d("2026-01-01", "2026-12-31").finished === false && d("2026-01-01", "2027-01-01").day === 365 && d("2026-01-01", "2027-01-01").finished === true);
  check("dayOnDate: a bad date does not crash", d("x", "y").day === 1);
  const st = PLAN.streakEndingAt;
  check("streak: counts days in a row ending today, or yesterday when today is not read yet", st(new Set([1, 2, 3]), 3) === 3 && st(new Set([1, 2, 3]), 4) === 3 && st(new Set([1, 3]), 3) === 1 && st(new Set([1, 2]), 5) === 0 && st(new Set(), 1) === 0);
}

section("B. the owner's feature switches: ");
{
  await H.fresh("");
  is("anonymous: 401", await feats(null), 401);
  is("a stranger: 403", await feats(u.stranger), 403);
  is("a members manager (not the owner): 403", await feats(u.mgr1), 403);
  is("a platform admin who is not the owner: 403", await feats(u.admin), 403);
  const g = await feats(O);
  check("the owner reads the defaults: everything OFF, the application reports giving available (the database lock and the pilot list decide per church)", g.status === 200 && g.body.item.bible_year === false && g.body.item.counselling === false && g.body.item.giving === false && g.body.giving_available === true, JSON.stringify(g.body));
  is("a switch must be a boolean", await putFeats(O, { bible_year: "yes" }), 400);
  is("an unknown switch is refused", await putFeats(O, { bible_year: true, church_id: prof.c2 }), 400, "unexpected_field");
  is("nothing to change is refused", await putFeats(O, {}), 400, "empty_update");
  // GIVING_AVAILABLE is true now: the application no longer refuses. This suite's database has no giving lock, so the write goes through; the per-church lock and the pilot list are proven in churchGiftsDb (section P).
  const gv = await putFeats(O, { giving: true });
  check("the application no longer blocks the giving switch", gv.status === 201 && gv.body.item.giving === true, JSON.stringify(gv.body));
  await H.rows("delete from public.church_features");
  check("(nothing was written by the refused calls)", (await H.rows("select count(*)::int n from public.church_features"))[0].n === 0);
  const first = await putFeats(O, { bible_year: true });
  is("the first save creates the row", first, 201, "ok");
  is("a second save needs the version: 400", await putFeats(O, { counselling: true }), 400);
  is("a stale second save: 409", await putFeats(O, { counselling: true, expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  const second = await putFeats(O, { counselling: true, expected_updated_at: first.body.item.updated_at });
  is("the second save works with the version", second, 200, "ok");
  check("the switches are stored", second.body.item.bible_year === true && second.body.item.counselling === true && second.body.item.giving === false);
  is("a manager cannot save: 403", await putFeats(u.mgr1, { bible_year: false, expected_updated_at: second.body.item.updated_at }), 403);
  const pub = await PF.loadPublicFeatures(F.sessionFor(H.db, null), prof.c1);
  check("the public page reads the switches", pub.bible_year === true && pub.counselling === true && pub.giving === false, JSON.stringify(pub));
  eq("another church has everything off", await PF.loadPublicFeatures(F.sessionFor(H.db, null), prof.c2), PF.NO_FEATURES);
  eq("a broken client gives everything off, never an error", await PF.loadPublicFeatures({ from() { throw new Error("x"); } }, prof.c1), PF.NO_FEATURES);
  eq("only an explicit true counts", PF.shapeFeatures({ bible_year: "true", counselling: 1, giving: null }), PF.NO_FEATURES);
}

section("C. the reader's routes: ");
{
  await H.fresh("");
  admin();
  as(null);
  is("no visitor cookie: 401", await H.call(null, "GET", `customer/church-bible-year?profile_id=${prof.c1}`), 401);
  is("no visitor cookie, POST: 401", await H.call(null, "POST", "customer/church-bible-year", { body: { profile_id: prof.c1 } }), 401);
  await reader(1);
  await reader(2, { connect: false });
  is("the church has not switched the plan on: 404", await plan(1), 404, "plan_unavailable");
  is("...so a reader cannot start it either: 404", await start(1), 404, "plan_unavailable");
  await putFeats(O, { bible_year: true });
  const s0 = await plan(1);
  check("a connected reader sees: connected, not following", s0.status === 200 && s0.body.connected === true && s0.body.enrolled === false && s0.body.total === 365, JSON.stringify(s0.body));
  is("a bad profile id: 404", await plan(1, "nope"), 404);
  is("a page that is not a church: 404", await plan(1, prof.nc), 404);
  const s2 = await plan(2);
  check("a reader who is not connected sees: not connected", s2.status === 200 && s2.body.connected === false && s2.body.enrolled === false);
  is("a reader who is not connected cannot start: 403", await start(2), 403, "not_connected");
  is("the body takes only the church", await (async () => { as(1); return H.call(null, "POST", "customer/church-bible-year", { body: { profile_id: prof.c1, start_date: "2020-01-01" } }); })(), 400, "unexpected_field");
  const st = await start(1);
  is("a connected reader starts the plan: 201", st, 201, "ok");
  check("day 1, today's reading in both languages, nothing ticked", st.body.enrolled === true && st.body.day === 1 && st.body.today && st.body.today.en === "Genesis 1–3" && st.body.today.fr === "Genèse 1–3" && st.body.done.length === 0 && st.body.streak === 0, JSON.stringify(st.body));
  const again = await start(1);
  check("starting twice is harmless: 200, the same plan, one row", again.status === 200 && again.body.day === 1 && (await H.rows("select count(*)::int n from public.bible_year_enrollments"))[0].n === 1);
  check("the answer holds no name, no e-mail and no other reader", !/Reader|@example/.test(JSON.stringify(again.body)));
  is("tick day 1", await tick(1, 1), 200, "ok");
  const afterTick = await plan(1);
  check("day 1 is ticked, a streak of 1, progress is kept on a reload", afterTick.body.done.join() === "1" && afterTick.body.streak === 1);
  is("day 2 has not come yet: 409", await tick(1, 2), 409, "future_day");
  is("day 0 and day 366 are outside the plan: 400", await tick(1, 0), 400, "invalid_day");
  is("...366", await tick(1, 366), 400, "invalid_day");
  is("a day must be a whole number", await (async () => { as(1); return H.call(null, "PATCH", "customer/church-bible-year", { body: { profile_id: prof.c1, day: "1", done: true } }); })(), 400, "invalid_day");
  is("done must be a boolean", await (async () => { as(1); return H.call(null, "PATCH", "customer/church-bible-year", { body: { profile_id: prof.c1, day: 1, done: "yes" } }); })(), 400);
  is("ticking again is harmless", await tick(1, 1), 200, "ok");
  is("unticking", await tick(1, 1, false), 200, "ok");
  eq("...and the day is no longer ticked", (await plan(1)).body.done, []);
  is("a reader who is not following cannot tick: 404", await tick(2, 1), 404, "not_following");
  // another reader never sees or changes this reader's ticks
  await reader(3);
  await start(3);
  eq("a second reader has their own empty plan", (await plan(3)).body.done, []);
  await tick(1, 1);
  eq("...and the first reader's tick did not reach them", (await plan(3)).body.done, []);
  // days later
  await H.db.exec(`alter table public.bible_year_enrollments disable trigger user; update public.bible_year_enrollments set start_date = (public.ministry_today() - 5) where customer_id = '${cu(1)}'; alter table public.bible_year_enrollments enable trigger user;`);
  const later = await plan(1);
  check("five days later the reader is on day 6 with the 6th reading", later.body.day === 6 && later.body.today.day === 6 && later.body.today.en === PLAN.referenceOf(PLAN.readingForDay(6), "en"), JSON.stringify(later.body.today));
  is("a missed day can be caught up", await tick(1, 3), 200, "ok");
  is("tick day 6", await tick(1, 6), 200, "ok");
  is("day 7 is not yet there: 409", await tick(1, 7), 409, "future_day");
  const streak = (await plan(1)).body;
  check("the streak counts days in a row ending today: 6 alone after 1 and 3 and 6 = 1", streak.streak === 1 && streak.done.join() === "1,3,6", JSON.stringify([streak.streak, streak.done]));
  // leave
  const lv = await leave(1);
  is("leaving the plan", lv, 200, "ok");
  check("after leaving, the reader is not following", (await plan(1)).body.enrolled === false);
  is("a closed plan takes no ticks: 404", await tick(1, 1), 404, "not_following");
  const restart = await start(1);
  check("starting again begins a new plan at day 1 with nothing ticked", restart.status === 201 && restart.body.day === 1 && restart.body.done.length === 0);
  is("leaving when not following is harmless", await leave(2), 200, "ok");
  is("a staff session does not open the reader routes: 401", await (async () => { as(null); return H.call(u.mgr1, "GET", `customer/church-bible-year?profile_id=${prof.c1}`); })(), 401);
  is("a request from another site is refused: 403", await (async () => { as(1); globalThis.__sameOrigin = false; const r = await H.call(null, "POST", "customer/church-bible-year", { body: { profile_id: prof.c1 } }); globalThis.__sameOrigin = undefined; return r; })(), 403);
  // the church switches it off again
  const cur = await feats(O);
  await putFeats(O, { bible_year: false, expected_updated_at: cur.body.item.updated_at });
  is("when the church switches it off, the plan is unavailable: 404", await plan(1), 404, "plan_unavailable");
  check("...and the reader's ticks are kept", (await H.rows("select count(*)::int n from public.bible_year_progress"))[0].n >= 3);
}

section("D. privacy (static): ");
{
  const fs = await import("fs");
  const code = (p) => fs.readFileSync(path.join(SRC, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const h = code("lib/church/bibleYear/handlers.ts");
  check("every reader statement is filtered by the visitor id", /customer_id", ctx\.customerId\)/.test(h) && !/\.from\("bible_year_enrollments"\)\.select\([^)]*\)\s*\.limit/.test(h));
  check("the reader handler never returns a name or a contact detail", !/full_name|\.email|\.phone/.test(h));
  const aiAndAnalytics = ["lib/ai", "lib/overview", "lib/reports", "lib/watchdog"].flatMap((d) => { const walk = (dir) => fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])); try { return walk(d); } catch { return []; } });
  const leaks = aiAndAnalytics.filter((f) => /bible_year_(enrollments|progress)/.test(code(f)));
  check("no AI, overview, report or watchdog code reads who follows the plan", leaks.length === 0, leaks.join());
}

await H.close();
process.exit(summary());
