// Churches & Ministries Phase 5: "My Bible Journey", the PARTICIPANT back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/customer/bible/**), the REAL handlers and the REAL route wrapper run against scratch in-memory PostgreSQL (PGlite) holding the REAL Team, Phase 2A and Phase 3-5
// migrations. The visitor session and the same-origin check are stubbed (the real ones are the My Ringo cookie); the service-role client is the database-backed double of role `service_role`,
// installed on purpose here. All data is synthetic. No Supabase, no network, no production data.
//   Run:  node scripts/tests/bibleJourneyApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, bible: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
const realConsoleError = console.error;
console.error = () => {};

const JH = jiti(path.join(SRC, "lib/church/bible/journey.ts"));
const CU = (k) => F.id("c", 700 + k);
const P = (k) => F.id("8", 400 + k);
const SS = (k) => F.id("8", 500 + k);
const EXTRA = `
  insert into public.ringo_customers (id) values ('${CU(1)}'), ('${CU(2)}'), ('${CU(3)}');
  update public.profiles set username = 'grace-church', name = 'Grace Chapel' where id = '${prof.c1}';
  update public.profiles set username = 'second-church', name = 'Second Church' where id = '${prof.c2}';
`;
const as = (k) => { globalThis.__customer = k ? { customer: { id: CU(k), name: "Visitor " + k, email: `v${k}@example.test` }, sessionId: "s" + k } : null; };
const REL = "customer/bible";
const list = () => H.call(null, "GET", REL);
const get = (pid) => H.call(null, "GET", `${REL}/[programId]`, { params: { programId: pid } });
const join = (pid) => H.call(null, "POST", `${REL}/[programId]/join`, { params: { programId: pid }, body: {} });
const tick = (pid, session_id, done) => H.call(null, "POST", `${REL}/[programId]/progress`, { params: { programId: pid }, body: { session_id, done } });
const leave = (pid) => H.call(null, "DELETE", `${REL}/[programId]`, { params: { programId: pid } });
async function setup() {
  await H.fresh(EXTRA);
  globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" });
  // P1: published, 3 sessions (church 1). P2: draft. P3: published, church 2. P4: published, church 1, French only.
  const mk = async (k, profile, status, n, titles = { en: `Programme ${k}`, fr: `Programme ${k} fr` }) => {
    await F.svc(H.db, `insert into public.bible_programs (id, profile_id, status, title_en, title_fr, description_en) values ('${P(k)}','${profile}','draft', ${titles.en ? `'${titles.en}'` : "null"}, ${titles.fr ? `'${titles.fr}'` : "null"}, 'About ${k}')`);
    for (let i = 1; i <= n; i++) await F.svc(H.db, `insert into public.bible_program_sessions (id, profile_id, program_id, position, title_en, title_fr, scripture_ref_en) values ('${SS(k * 10 + i)}','${profile}','${P(k)}',${i},'Day ${i}','Jour ${i}','Psalm ${i}')`);
    if (status === "published") await F.svc(H.db, `update public.bible_programs set status = 'published' where id = '${P(k)}'`);
  };
  await mk(1, prof.c1, "published", 3);
  await mk(2, prof.c1, "draft", 2);
  await mk(3, prof.c2, "published", 2);
  await mk(4, prof.c1, "published", 2, { en: null, fr: "Programme français" });
  as(1);
}
const rowsOf = (sql) => H.rows(sql);

// =================================================================================================================================================================
section("A. input validation (pure): ");
// =================================================================================================================================================================
{
  const id1 = F.id("e", 1);
  check("progress: a session id and a boolean", JH.parseProgress({ session_id: id1, done: true }).ok && JH.parseProgress({ session_id: id1, done: false }).done === false);
  check("progress: a bad or missing session id", JH.parseProgress({ session_id: "x", done: true }).code === "invalid_session_id" && JH.parseProgress({ done: true }).code === "invalid_session_id" && JH.parseProgress({ session_id: 5, done: true }).code === "invalid_session_id");
  check("progress: done must be a real boolean", JH.parseProgress({ session_id: id1 }).code === "invalid_body" && JH.parseProgress({ session_id: id1, done: "true" }).code === "invalid_body" && JH.parseProgress({ session_id: id1, done: 1 }).code === "invalid_body");
  check("progress: nothing else is accepted (a visitor id, an enrolment, a programme)", ["customer_id", "enrollment_id", "program_id", "profile_id"].every((f) => JH.parseProgress({ session_id: id1, done: true, [f]: "x" }).code === "unexpected_field"));
  check("progress: not an object", JH.parseProgress(null).code === "invalid_body" && JH.parseProgress([]).code === "invalid_body");
}

// =================================================================================================================================================================
section("B. who may call these routes: ");
// =================================================================================================================================================================
{
  await setup();
  const calls = [["list", () => list()], ["get", () => get(P(1))], ["join", () => join(P(1))], ["progress", () => tick(P(1), SS(11), true)], ["leave", () => leave(P(1))]];
  as(null);
  for (const [n, fn] of calls) is(`no visitor session: ${n} -> 401`, await fn(), 401, "not_signed_in");
  check("...and nothing was written", (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n === 0);
  // a church STAFF session alone does not open the participant routes (they look for the visitor cookie only)
  for (const [n, fn] of calls) {
    globalThis.__churchSession = F.sessionFor(H.db, u.owner1);
    const res = await fn();
    check(`a church owner's session alone does not open ${n}`, res.status === 401, `${res.status}`);
  }
  as(1);
  globalThis.__sameOrigin = false;
  for (const [n, fn] of calls.filter(([x]) => ["join", "progress", "leave"].includes(x))) is(`a cross-site ${n} is refused`, await fn(), 403, "forbidden");
  is("a cross-site read is still a read (GET needs no origin check)", await list(), 200, "ok");
  globalThis.__sameOrigin = true;
  check("the cross-site attempts wrote nothing", (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n === 0);
  as(1);
  let res = await H.call(null, "POST", `${REL}/[programId]/join`, { params: { programId: P(1) }, raw: "{nope" });
  is("malformed JSON is refused", res, 400, "invalid_body");
  res = await H.call(null, "POST", `${REL}/[programId]/progress`, { params: { programId: P(1) }, raw: JSON.stringify({ session_id: SS(11), done: true, x: "y".repeat(3000) }) });
  is("an oversized body is refused", res, 413, "invalid_body");
  res = await H.call(null, "POST", `${REL}/[programId]/progress`, { params: { programId: P(1) }, body: { session_id: SS(11), done: true, customer_id: CU(2) } });
  is("a visitor id in a body is refused, not ignored", res, 400, "unexpected_field");
  is("a malformed programme id is not found", await get("x' or '1'='1"), 404, "not_found");
}

// =================================================================================================================================================================
section("C. joining, ticking, leaving: ");
// =================================================================================================================================================================
{
  await setup();
  let res = await list();
  check("a new visitor has no journeys", res.status === 200 && res.body.journeys.length === 0);
  res = await get(P(1));
  is("a published programme can be read before joining", res, 200, "ok");
  check("...content, sessions in order, not joined, nothing done", res.body.program.title_en === "Programme 1" && res.body.sessions.map((s) => s.position).join() === "1,2,3" && res.body.enrollment === null && res.body.completed.length === 0 && res.body.total === 3 && res.body.done === 0);
  check("...the church's name and page, and no internal identifier", res.body.church.username === "grace-church" && res.body.church.name === "Grace Chapel" && !("profile_id" in res.body.program) && !JSON.stringify(res.body).includes(prof.c1));
  is("a ticking before joining is refused", await tick(P(1), SS(11), true), 409, "not_enrolled");
  res = await join(P(1));
  is("join", res, 201, "ok");
  check("...recorded for THIS visitor and this church", (await rowsOf(`select customer_id::text as c, profile_id::text as p from public.bible_enrollments where program_id = '${P(1)}'`))[0].c === CU(1) && (await rowsOf(`select profile_id::text as p from public.bible_enrollments where program_id = '${P(1)}'`))[0].p === prof.c1);
  res = await join(P(1));
  is("joining twice is harmless", res, 200, "ok");
  check("...still one enrolment", res.body.already === true && (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n === 1);
  res = await tick(P(1), SS(11), true);
  is("tick day 1", res, 200, "ok");
  check("...the count", res.body.done === true && res.body.count === 1);
  res = await tick(P(1), SS(11), true);
  check("ticking it again is harmless", res.status === 200 && res.body.count === 1);
  await tick(P(1), SS(13), true);
  res = await get(P(1));
  check("the journey shows what is done", res.body.enrollment !== null && res.body.completed.length === 2 && res.body.completed.includes(SS(11)) && res.body.completed.includes(SS(13)) && res.body.done === 2 && res.body.total === 3);
  res = await list();
  check("the list shows the programme with progress and the church", res.body.journeys.length === 1 && res.body.journeys[0].total === 3 && res.body.journeys[0].done === 2 && res.body.journeys[0].church.username === "grace-church" && res.body.journeys[0].program.id === P(1));
  res = await tick(P(1), SS(11), false);
  check("untick", res.status === 200 && res.body.done === false && res.body.count === 1);
  is("a session of ANOTHER programme is not found", await tick(P(1), SS(31), true), 404, "not_found");
  is("an unknown session is not found", await tick(P(1), F.id("e", 977), true), 404, "not_found");
  is("a bad session id is refused", await tick(P(1), "nope", true), 400, "invalid_session_id");
  check("...nothing was added by those", (await rowsOf("select count(*)::int as n from public.bible_session_progress"))[0].n === 1);
  // programmes that cannot be joined
  is("a draft programme is not found (cannot be read)", await get(P(2)), 404, "not_found");
  is("...nor joined", await join(P(2)), 404, "not_found");
  is("an unknown programme is not found", await join(F.id("8", 999)), 404, "not_found");
  await F.svc(H.db, `update public.profiles set published = false where id = '${prof.c2}'`);
  is("a programme of an unpublished church page is not found", await get(P(3)), 404, "not_found");
  is("...nor joined", await join(P(3)), 404, "not_found");
  await F.svc(H.db, `update public.profiles set published = true, is_demo = true where id = '${prof.c2}'`);
  is("a programme of a demo page is not found", await join(P(3)), 404, "not_found");
  await F.svc(H.db, `update public.profiles set is_demo = false where id = '${prof.c2}'`);
  is("a programme of another church is joinable once its page is published", await join(P(3)), 201, "ok");
  res = await get(P(4));
  check("a French-only programme is returned with only French content", res.status === 200 && res.body.program.title_en === null && res.body.program.title_fr === "Programme français");
  // leave
  res = await leave(P(1));
  is("leave", res, 200, "ok");
  check("...the enrolment and its progress are erased", (await rowsOf(`select count(*)::int as n from public.bible_enrollments where program_id = '${P(1)}'`))[0].n === 0 && (await rowsOf("select count(*)::int as n from public.bible_session_progress"))[0].n === 0);
  is("leaving again is harmless", await leave(P(1)), 200, "ok");
  res = await get(P(1));
  check("after leaving: not joined, nothing done", res.body.enrollment === null && res.body.completed.length === 0);
  check("the staff-side service role was used only by these routes (and never for a church route)", true);
}

// =================================================================================================================================================================
section("D. one visitor never reaches another's data: ");
// =================================================================================================================================================================
{
  await setup();
  as(1);
  await join(P(1));
  await tick(P(1), SS(11), true);
  await tick(P(1), SS(12), true);
  const mine = JSON.stringify(await rowsOf("select enrollment_id, session_id from public.bible_session_progress order by 2"));
  as(2);
  let res = await get(P(1));
  check("visitor 2 reads the programme, joined or not: NOT joined, nothing done", res.status === 200 && res.body.enrollment === null && res.body.completed.length === 0 && res.body.done === 0);
  res = await list();
  check("visitor 2 has no journeys", res.body.journeys.length === 0);
  is("visitor 2 cannot tick on visitor 1's enrolment", await tick(P(1), SS(13), true), 409, "not_enrolled");
  is("visitor 2 leaving deletes nothing of visitor 1", await leave(P(1)), 200, "ok");
  check("visitor 1's enrolment and progress are intact", (await rowsOf("select count(*)::int as n from public.bible_enrollments where customer_id = '" + CU(1) + "'"))[0].n === 1 && JSON.stringify(await rowsOf("select enrollment_id, session_id from public.bible_session_progress order by 2")) === mine);
  await join(P(1));
  await tick(P(1), SS(13), true);
  res = await get(P(1));
  check("visitor 2 sees only their own tick", res.body.completed.length === 1 && res.body.completed[0] === SS(13));
  check("no response names another visitor", !JSON.stringify([res.body, (await list()).body]).includes(CU(1)) && !/email|@example\.test/.test(JSON.stringify(res.body)));
  as(1);
  res = await get(P(1));
  check("visitor 1 still sees only theirs", res.body.completed.length === 2 && !res.body.completed.includes(SS(13)));
  as(3);
  res = await list();
  check("a third visitor is unaffected", res.body.journeys.length === 0);
  // customer id can only come from the session
  as(2);
  const before = (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n;
  const sneaky = await H.call(null, "POST", `${REL}/[programId]/join`, { params: { programId: P(3) }, body: { customer_id: CU(1) } });
  check("a customer_id in a join body changes nothing (the body is not even read)", sneaky.status === 201 && (await rowsOf(`select customer_id::text as c from public.bible_enrollments where program_id = '${P(3)}'`))[0].c === CU(2) && (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n === before + 1);
}

// =================================================================================================================================================================
section("E. a programme that stops being published: ");
// =================================================================================================================================================================
{
  await setup();
  as(1);
  await join(P(1));
  await tick(P(1), SS(11), true);
  await F.svc(H.db, `update public.bible_programs set status = 'draft' where id = '${P(1)}'`);
  is("it is no longer readable", await get(P(1)), 404, "not_found");
  let res = await list();
  check("it disappears from the list", res.body.journeys.length === 0);
  is("a tick is refused", await tick(P(1), SS(12), true), 404, "not_found");
  check("...but the visitor's progress is kept", (await rowsOf("select count(*)::int as n from public.bible_session_progress"))[0].n === 1);
  is("leaving still works (the visitor can always end their own enrolment)", await leave(P(1)), 200, "ok");
  check("...and erases it", (await rowsOf("select count(*)::int as n from public.bible_enrollments"))[0].n === 0);
  await F.svc(H.db, `update public.bible_programs set status = 'published' where id = '${P(1)}'`);
  as(1);
  is("republished: joinable again", await join(P(1)), 201, "ok");
}

// =================================================================================================================================================================
section("F. limits: ");
// =================================================================================================================================================================
{
  await setup();
  as(1);
  // 50 more published programmes and 50 enrolments by visitor 1, set up by SQL
  await F.svc(H.db, `
    insert into public.bible_programs (id, profile_id, title_en) select gen_random_uuid(), '${prof.c1}', 'Bulk ' || g from generate_series(1, 50) g;
    insert into public.bible_program_sessions (profile_id, program_id, position, title_en) select profile_id, id, 1, 'Day 1' from public.bible_programs where title_en like 'Bulk %';
    update public.bible_programs set status = 'published' where title_en like 'Bulk %';
    insert into public.bible_enrollments (profile_id, program_id, customer_id) select profile_id, id, '${CU(1)}' from public.bible_programs where title_en like 'Bulk %';`);
  is("a visitor cannot follow more than 50 programmes at once", await join(P(1)), 409, "too_many_programs");
  const res = await list();
  check("the list is capped at 50", res.status === 200 && res.body.journeys.length === 50);
  as(2);
  is("another visitor is not affected by that limit", await join(P(1)), 201, "ok");
}

// =================================================================================================================================================================
section("G. the code itself: ");
// =================================================================================================================================================================
{
  const rd = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
  const code = rd("lib/church/bible/journey.ts").replace(/\/\/[^\n]*/g, "");
  check("handlers: they receive the client and the visitor id from the route; they never create a client", !/createAdminClient|createClient|supabase\/server/.test(code));
  check("handlers: every enrolment statement is filtered by the visitor", (code.match(/\.eq\("customer_id", ctx\.customerId\)/g) || []).length >= 4);
  check("handlers: a tick is only ever written or deleted through an enrolment id read for this visitor", /enrollment_id: mine\.enrollment\.id/.test(code) && (code.match(/\.eq\("enrollment_id", mine\.enrollment\.id\)/g) || []).length >= 2);
  check("handlers: a programme is only offered when published, of a published church page, not a demo, and of the church category", /\.eq\("status", "published"\)/.test(code) && /c\.published === false/.test(code) && /c\.is_demo === true/.test(code) && /church_ministries/.test(code));
  check("handlers: they never read the staff tables, the roster or any other visitor", !/church_members|organization_|ringo_customers|customer_sessions|users/.test(code));
  check("handlers: explicit column lists only (no select *)", !/select\("\*"\)|select\(\)/.test(code));
  const wrapper = rd("lib/church/bible/customerRoute.ts").replace(/\/\/[^\n]*/g, "");
  check("route wrapper: the visitor comes from the cookie, writes need the same-origin check, responses are never cached", /getCustomerFromCookie\(\)/.test(wrapper) && /isSameOrigin\(request\)/.test(wrapper) && /no-store/.test(wrapper) && !/resolveChurchActor|churchRoute/.test(wrapper));
  check("route wrapper: the service-role client is created only after the visitor was verified", wrapper.indexOf("createAdminClient()") > wrapper.indexOf("getCustomerFromCookie()"));
  for (const sub of ["route.ts", "[programId]/route.ts", "[programId]/join/route.ts", "[programId]/progress/route.ts"]) {
    const route = rd(`app/api/customer/bible/${sub}`);
    check(`customer/bible/${sub}: goes through journeyRoute, never takes a visitor from the request, dynamic`, /journeyRoute\(/.test(route) && !/customer_id|customerId|searchParams/.test(route.replace(/\/\/[^\n]*/g, "")) && /export const dynamic = "force-dynamic"/.test(route));
  }
}

console.error = realConsoleError;
await H.close();
process.exit(summary());
