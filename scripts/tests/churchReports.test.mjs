// Churches & Ministries Phase 10: Reports, validated end to end and OFFLINE.
// The REAL route file (src/app/api/church/reports), the REAL handlers, aggregate builders, CSV writer and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL Phase 3-8 migrations. All data is synthetic. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchReports.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, shift, doualaToday, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true });
const { F, jiti } = H;
const { u, prof, m } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const P = jiti(path.join(SRC, "lib/church/reports/period.ts"));
const CSV = jiti(path.join(SRC, "lib/church/reports/csv.ts"));
const RH = jiti(path.join(SRC, "lib/church/reports/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const TR = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;

const D0 = doualaToday();
const U2 = (n) => F.id("c", 110 + n);
const ru = { all: U2(1), only: U2(2), evOnly: U2(3), attOnly: U2(4), noReports: U2(5) };
const R2 = (n) => F.id("b", 110 + n);
const rr = { all: R2(1), only: R2(2), evOnly: R2(3), attOnly: R2(4), noReports: R2(5) };
const E = (k) => F.id("8", 500 + k);
const PROG = F.id("7", 500);
const CU = (k) => F.id("4", 500 + k);
const ALL_PERMS = "church.reports.view,church.members.view,church.groups.view,church.leadership.view,church.events.view,church.attendance.view,church.bible.view,church.content.view";
const EXTRA = `
  insert into public.users (id, role, plan_id) values ${Object.values(ru).map((x) => `('${x}','user','${F.plan.free}')`).join(", ")};
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${rr.all}','${prof.c1}','rall','All-report viewer','{${ALL_PERMS}}'),
    ('${rr.only}','${prof.c1}','ronly','Reports door only','{church.reports.view}'),
    ('${rr.evOnly}','${prof.c1}','rev','Reports + events','{church.reports.view,church.events.view}'),
    ('${rr.attOnly}','${prof.c1}','ratt','Attendance but no reports permission','{church.attendance.view,church.members.view,church.events.view}'),
    ('${rr.noReports}','${prof.c1}','rno','Everything except reports','{church.members.view,church.groups.view,church.events.view,church.attendance.view,church.bible.view,church.content.view}');
  insert into public.organization_members (profile_id, user_id, role_id) values
    ('${prof.c1}','${ru.all}','${rr.all}'), ('${prof.c1}','${ru.only}','${rr.only}'), ('${prof.c1}','${ru.evOnly}','${rr.evOnly}'), ('${prof.c1}','${ru.attOnly}','${rr.attOnly}'), ('${prof.c1}','${ru.noReports}','${rr.noReports}');
  insert into public.ministry_events (id, profile_id, status, event_date, title_en, title_fr, is_cancelled) values
    ('${E(1)}','${prof.c1}','published', public.ministry_today(), 'Sunday service', 'Culte du dimanche', false),
    ('${E(2)}','${prof.c1}','published', public.ministry_today() - 7, 'Midweek prayer', null, false),
    ('${E(3)}','${prof.c1}','published', public.ministry_today() + 3, 'Future conference', null, false),
    ('${E(4)}','${prof.c1}','draft', public.ministry_today() - 1, 'Draft event', null, false),
    ('${E(5)}','${prof.c1}','published', public.ministry_today() - 1, '=HYPERLINK("http://evil")', null, true),
    ('${E(6)}','${prof.c2}','published', public.ministry_today(), 'Other church service', null, false);
  insert into public.ministry_attendance (profile_id, event_id, member_id) values
    ('${prof.c1}','${E(1)}','${m.admin}'), ('${prof.c1}','${E(1)}','${m.other}'), ('${prof.c1}','${E(2)}','${m.admin}');
  insert into public.ministry_attendance_counts (event_id, profile_id, visitors, children) values ('${E(1)}','${prof.c1}', 3, 4);
  insert into public.ministry_announcements (profile_id, status, title_en, body_en) values ('${prof.c1}','published','Notice','Body'), ('${prof.c1}','draft','Draft notice','Body');
  insert into public.daily_words (profile_id, publish_on, status, title_en, body_en) values
    ('${prof.c1}', public.ministry_today(), 'published', 'Word today', 'Body'),
    ('${prof.c1}', public.ministry_today() + 2, 'published', 'Word later', 'Body'),
    ('${prof.c1}', public.ministry_today() + 5, 'draft', 'Word draft', 'Body');
  insert into public.bible_programs (id, profile_id, status, title_en) values ('${PROG}','${prof.c1}','draft','Read the Psalms');
  insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${PROG}',1,'Day 1'), ('${prof.c1}','${PROG}',2,'Day 2');
  update public.bible_programs set status = 'published' where id = '${PROG}';
  insert into public.bible_programs (profile_id, status, title_en) values ('${prof.c1}','draft','A draft programme');
  insert into public.ringo_customers (id) values ('${CU(1)}'), ('${CU(2)}'), ('${CU(3)}');
  insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${prof.c1}','${PROG}','${CU(1)}'), ('${prof.c1}','${PROG}','${CU(2)}'), ('${prof.c1}','${PROG}','${CU(3)}');
`;
const O = u.owner1;
const rep = (who, qs = "") => H.call(who, "GET", `church/reports${qs ? "?" + qs : ""}`);
const R = (res) => res.body?.report;

section("A. the date range (pure): ");
{
  const today = "2026-10-24";
  const d = P.parseReportPeriod(null, null, today);
  check("default: the last 30 days, today included", d.ok && d.value.to === today && d.value.from === "2026-09-25" && d.value.days === 30, JSON.stringify(d));
  const one = P.parseReportPeriod("2026-10-24", "2026-10-24", today);
  check("one day is one day", one.ok && one.value.days === 1);
  check("a Douala day starts at 23:00 UTC the day before", one.value.fromUtc === "2026-10-23T23:00:00.000Z" && one.value.toUtcExclusive === "2026-10-24T23:00:00.000Z", JSON.stringify(one.value));
  check("not a real day is refused (30 February, 13th month, words, empty)", ["2026-02-30", "2026-13-01", "yesterday", "", "2026-1-1", "20261024"].every((v) => P.parseReportPeriod(v, "2026-10-24", today).code === "invalid_report_date"));
  check("a leap day is accepted", P.parseReportPeriod("2028-02-29", "2028-03-01", "2028-03-01").ok && P.parseReportPeriod("2027-02-29", "2027-03-01", "2027-03-01").code === "invalid_report_date");
  check("end before start is refused", P.parseReportPeriod("2026-10-24", "2026-10-23", today).code === "invalid_range");
  check("366 days is the longest; 367 is refused", P.parseReportPeriod("2025-10-24", "2026-10-24", today).ok === true && P.parseReportPeriod("2025-10-23", "2026-10-24", today).code === "range_too_long");
  check("before 2020 is refused", P.parseReportPeriod("2019-12-31", "2020-01-02", today).code === "invalid_report_date");
  check("an end more than a year ahead is refused; up to a year ahead is fine", P.parseReportPeriod("2026-10-24", "2027-10-26", today).code === "invalid_report_date" && P.parseReportPeriod("2026-10-24", "2027-10-24", today).ok);
  check("addDays crosses month and year", P.addDays("2026-12-31", 1) === "2027-01-01" && P.addDays("2026-03-01", -1) === "2026-02-28");
}

section("B. the CSV writer (pure): ");
{
  check("a formula-looking cell is made inert", ["=1+1", "+1", "-1+2", "@SUM(A1)", "\tcmd"].every((v) => CSV.csvCell(v).startsWith("'") || CSV.csvCell(v).startsWith("\"'")));
  check("a real number is left alone, even a negative one", CSV.csvCell(5) === "5" && CSV.csvCell(-2) === "-2" && CSV.csvCell(0) === "0");
  check("commas, quotes and line breaks are quoted", CSV.csvCell('a,b') === '"a,b"' && CSV.csvCell('say "hi"') === '"say ""hi"""' && CSV.csvCell("a\nb") === '"a\nb"');
  check("null and undefined are empty", CSV.csvCell(null) === "" && CSV.csvCell(undefined) === "");
  check("the language list is exactly en and fr", JSON.stringify(CSV.REPORT_LANGS) === '["en","fr"]');
}

section("C. permissions: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await rep(null), 401);
  is("a stranger: 403", await rep(u.stranger), 403);
  is("a team member WITHOUT church.reports.view is refused even holding every data permission", await rep(ru.noReports), 403, "forbidden");
  is("...attendance viewers too", await rep(ru.attOnly), 403, "forbidden");
  const owner = await rep(O);
  is("the church owner: 200", owner, 200, "ok");
  const only = await rep(ru.only);
  is("reports.view alone opens the door", only, 200, "ok");
  eq("...but no section is built (no data permission)", [Object.keys(R(only).sections), R(only).unavailable.length], [[], 6]);
  const ev = await rep(ru.evOnly);
  eq("reports.view + events.view builds ONLY the events section", Object.keys(R(ev).sections), ["events"]);
  eq("...and lists the others as unavailable", R(ev).unavailable.sort(), ["attendance", "bible", "content", "groups", "people"]);
  const all = await rep(ru.all);
  eq("with every data permission all six sections are built", Object.keys(R(all).sections).sort(), ["attendance", "bible", "content", "events", "groups", "people"]);
  is("a platform admin who is not the owner: 403", await H.call(u.admin, "GET", "church/reports"), 403);
  is("another church's owner sees their own church (200)", await rep(u.owner2), 200, "ok");
  check("a group leader (not staff) is refused", (await rep(u.leader1)).status === 403);
  check("the capability comes from church.reports.view only", PERM.churchCapabilities(["church.reports.view"]).viewReports === true && PERM.churchCapabilities(ALL_PERMS.split(",").filter((p) => p !== "church.reports.view")).viewReports === false);
  check("the string is registered and SENSITIVE (owner-only to grant)", PERM.CHURCH_PERMISSIONS.includes("church.reports.view") && PERM.isSensitiveChurchPermissionName("church.reports.view"));
  check("the owner holds it implicitly", PERM.churchCapabilities([...PERM.CHURCH_PERMISSIONS]).viewReports === true);
}

section("D. the figures: ");
{
  await H.fresh(EXTRA);
  const res = await rep(O);
  const r = R(res);
  const S = r.sections;
  eq("people by status (children are never counted)", S.people.byStatus, { pending: 1, active: 6, inactive: 0, removed: 0 });
  eq("active adults and young people", S.people.activeByAgeGroup, { adult: 5, youth: 1 });
  eq("language split with 'not set' for the rest", S.people.activeByLanguage, { en: 0, fr: 0, unknown: 6 });
  eq("people added in the default range", S.people.addedInRange, 7);
  eq("groups by kind", S.groups.byKind, { department: 2, group: 2 });
  eq("only the current leadership appointment counts", S.groups.openLeadershipAppointments, 1);
  eq("events: published / cancelled / upcoming / past in the default range", [S.events.published, S.events.cancelled, S.events.upcoming, S.events.past], [3, 1, 1, 2]);
  eq("announcements published in range (a draft is not counted)", S.events.announcementsPublishedInRange, 1);
  eq("attendance: events listed are published, started, newest first", S.attendance.events.map((x) => x.event_id), [E(1), E(5), E(2)]);
  eq("attendance: Sunday = 2 present + 3 visitors + 4 children", S.attendance.events[0], { event_id: E(1), event_date: D0, title_en: "Sunday service", title_fr: "Culte du dimanche", is_cancelled: false, present: 2, visitors: 3, children: 4, total: 9, totalNoChildren: 5, recorded: true });
  eq("attendance: a cancelled event with nothing recorded says so", [S.attendance.events[1].recorded, S.attendance.events[1].total, S.attendance.events[1].is_cancelled], [false, 0, true]);
  eq("attendance totals", S.attendance.totals, { eventsListed: 3, eventsWithAttendance: 2, present: 3, visitors: 3, children: 4, total: 10, averagePerRecordedEvent: 5, peak: 9, totalNoChildren: 6, averageNoChildren: 3, peakNoChildren: 5 });
  eq("bible: counts and the follower NUMBER (no person)", [S.bible.published, S.bible.drafts, S.bible.programs.length, S.bible.programs[0].enrolled, S.bible.programs[0].sessions, S.bible.totalEnrolled], [1, 1, 1, 3, 2, 3]);
  eq("daily word: published in range (not later ones), scheduled ahead, drafts", [S.content.publishedInRange, S.content.scheduledAhead, S.content.drafts], [1, 1, 1]);
  const o2 = R(await rep(u.owner2));
  eq("church 2 sees only church 2's numbers", [o2.sections.people.byStatus.active, o2.sections.events.published, o2.sections.attendance.events.length], [1, 1, 1]);
}

section("E. date filters (Douala days): ");
{
  await H.fresh(EXTRA);
  const past = R(await rep(O, `from=${shift(D0, -100)}&to=${shift(D0, -60)}`)).sections;
  eq("a range with nothing in it gives zeros, not errors", [past.people.addedInRange, past.events.published, past.attendance.events.length, past.content.publishedInRange], [0, 0, 0, 0]);
  eq("the roster totals are 'as of today' whatever the range", past.people.byStatus.active, 6);
  const wide = R(await rep(O, `from=${shift(D0, -10)}&to=${shift(D0, 5)}`)).sections;
  eq("a range reaching ahead includes the future event as 'still to come'", [wide.events.published, wide.events.upcoming], [4, 2]);
  eq("...but attendance is never listed for an event that has not started", wide.attendance.events.length, 3);
  eq("...and a word dated after today is not 'published in range'", wide.content.publishedInRange, 1);
  // instants: a person added one second before Douala midnight is the day before; at midnight, the new day
  const midnight = `${D0}T00:00:00+01:00`;
  await F.svc(H.db, `update public.church_members set created_at = '${midnight}'::timestamptz - interval '1 second' where id = '${m.admin}'; update public.church_members set created_at = '${midnight}'::timestamptz where id = '${m.other}'; update public.church_members set created_at = now() - interval '200 days' where id not in ('${m.admin}','${m.other}')`);
  const onlyToday = R(await rep(O, `from=${D0}&to=${D0}`)).sections.people.addedInRange;
  eq("a person added at Douala midnight counts for the new day; one second earlier does not", onlyToday, 1);
  const yesterday = R(await rep(O, `from=${shift(D0, -1)}&to=${shift(D0, -1)}`)).sections.people.addedInRange;
  eq("...it belongs to the day before", yesterday, 1);
}

section("F. input is validated: ");
{
  await H.fresh(EXTRA);
  is("an unknown parameter is refused, not ignored", await rep(O, "profile_id=" + prof.c2), 400, "unexpected_field");
  is("a repeated parameter is refused", await rep(O, "from=2026-01-01&from=2026-01-02"), 400, "unexpected_field");
  is("a bad date", await rep(O, "from=nope"), 400, "invalid_report_date");
  is("end before start", await rep(O, `from=${D0}&to=${shift(D0, -1)}`), 400, "invalid_range");
  is("a range over 366 days", await rep(O, `from=${shift(D0, -400)}&to=${D0}`), 400, "range_too_long");
  is("an unknown section", await rep(O, "section=care"), 400, "invalid_section");
  is("csv without a section", await rep(O, "format=csv"), 400, "invalid_section");
  is("an unknown format", await rep(O, "format=pdf&section=people"), 400, "invalid_format");
  is("an unknown language", await rep(O, "format=csv&section=people&lang=de"), 400, "invalid_lang");
  is("a section outside the person's access", await rep(ru.evOnly, "section=attendance"), 403, "section_unavailable");
  is("...even as csv", await rep(ru.evOnly, "section=attendance&format=csv"), 403, "section_unavailable");
  is("a POST is not a route", await (async () => { try { return await H.call(O, "POST", "church/reports", { body: {} }); } catch { return { status: 405, body: null }; } })(), 405);
}

section("G. CSV download: ");
{
  await H.fresh(EXTRA);
  globalThis.__churchSession = F.sessionFor(H.db, O);
  const mod = jiti(path.join(SRC, "app/api/church/reports/route.ts"));
  const res = await mod.GET(new Request(`http://test.local/api/church/reports?section=attendance&format=csv&lang=en&from=${shift(D0, -10)}&to=${D0}`));
  const text = await res.text();
  eq("status and type", [res.status, res.headers.get("content-type")], [200, "text/csv; charset=utf-8"]);
  check("it downloads as an attachment with a safe name, never cached", /^attachment; filename="church-report-attendance-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/.test(res.headers.get("content-disposition") || "") && res.headers.get("cache-control") === "no-store" && res.headers.get("x-content-type-options") === "nosniff");
  const bytes = new Uint8Array(await (await mod.GET(new Request("http://test.local/api/church/reports?section=attendance&format=csv"))).arrayBuffer());
  check("it starts with a byte-order mark and uses CRLF", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && text.includes("\r\n"));
  check("English headers", text.includes("Measure,Value") && text.includes("Date,Event,Present,Visitors,Total (children not included)") && !/children,|,Children/i.test(text.replace("Total (children not included)", "").replace(/children not included/gi, "")));
  check("the figures and the events are there", text.includes("Sunday service,2,3,5") && text.includes("Midweek prayer,1,0,1") && !text.includes(",4,"));
  check("a title that is a spreadsheet formula is neutralised", text.includes(`"'=HYPERLINK(""http://evil"")`) || text.includes("'=HYPERLINK"), text);
  check("no line starts with a formula character", text.split("\r\n").filter(Boolean).every((l) => !/^[=+\-@]/.test(l.replace("﻿", ""))));
  const fr = await (await mod.GET(new Request(`http://test.local/api/church/reports?section=attendance&format=csv&lang=fr&from=${shift(D0, -10)}&to=${D0}`))).text();
  check("French headers and French titles", fr.includes("Mesure,Valeur") && fr.includes("Date,Événement,Présents,Visiteurs,Total (enfants non inclus)") && !/Enfants,/.test(fr) && fr.includes("Culte du dimanche"), fr);
  const bible = await (await mod.GET(new Request("http://test.local/api/church/reports?section=bible&format=csv"))).text();
  check("the Bible csv carries the number of followers only", bible.includes("Read the Psalms,2,3") && !bible.includes(CU(1)));
  globalThis.__churchSession = F.sessionFor(H.db, null);
  const anon = await mod.GET(new Request("http://test.local/api/church/reports?section=people&format=csv"));
  eq("anonymous gets 401 JSON, not a file", [anon.status, (anon.headers.get("content-type") || "").includes("json")], [401, true]);
  globalThis.__churchSession = F.sessionFor(H.db, ru.evOnly);
  const lim = await mod.GET(new Request("http://test.local/api/church/reports?section=people&format=csv"));
  eq("a section outside the access is 403, not a file", lim.status, 403);
}

section("H. PRIVACY: counts only, no person, no child, no care, no money: ");
{
  await H.fresh(EXTRA);
  // the strings that identify people in the fixtures
  const SECRETS = ["Grace Admin", "Luc Leader", "Vera Volunteer", "Olivier Other", "Gaby Guardian", "Paul Pending", "Yann Youth", "Kiki Child", "Koko Child", "grace@example.test", "+237670000001", "+237670000002", "+237670000003", "Second Church Adult", m.admin, m.other, m.kid1, m.kid2, m.guardian, CU(1), CU(2), CU(3)];
  const json = JSON.stringify((await rep(O)).body);
  check("the JSON report holds no name, phone, e-mail, roster id, child id or customer id", SECRETS.every((s) => !json.includes(s)), SECRETS.filter((s) => json.includes(s)).join());
  let allCsv = "";
  globalThis.__churchSession = F.sessionFor(H.db, O);
  const mod = jiti(path.join(SRC, "app/api/church/reports/route.ts"));
  for (const s of ["people", "groups", "events", "attendance", "bible", "content"]) for (const lang of ["en", "fr"]) allCsv += await (await mod.GET(new Request(`http://test.local/api/church/reports?section=${s}&format=csv&lang=${lang}`))).text();
  check("no CSV holds any of them either", SECRETS.every((s) => !allCsv.includes(s)), SECRETS.filter((s) => allCsv.includes(s)).join());
  const keys = new Set();
  const walk = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
  walk((await rep(O)).body);
  const banned = ["full_name", "name", "phone", "email", "member_id", "members", "guardian", "guardian_member_id", "customer_id", "user_id", "beneficiary", "contribution", "amount"];
  check("no field of the report is named like personal data, care or money", banned.every((k) => !keys.has(k)), banned.filter((k) => keys.has(k)).join());
  eq("the children figure is the plain recorded number, not a roster count", R(await rep(O)).sections.attendance.totals.children, 4);
  check("the people section has no 'child' figure at all", !JSON.stringify(R(await rep(O)).sections.people).toLowerCase().includes("child"));
  // reading is read-only and goes only through the person's own session
  globalThis.__churchSession = F.sessionFor(H.db, O);
  await rep(O);
  const writes = (globalThis.__churchSession.log || []).filter((l) => l.mode !== "select");
  eq("a report performs no write", writes.length, 0);
  eq("the service-role client is never used", globalThis.__adminClientCalls, 0);
  // the source files never touch care, beneficiaries or money
  const src = ["period", "build", "csv", "handlers"].map((f) => fs.readFileSync(path.join(REPO, `src/lib/church/reports/${f}.ts`), "utf8")).join("\n").replace(/\/\/[^\n]*/g, "");
  check("the report code reads no care, beneficiary, contribution, payment or finance table", !/care_|beneficiar|contribution|ledger|fapshi|payment|refund|payout|createAdminClient/i.test(src), (src.match(/care_|beneficiar|contribution|ledger|fapshi|payment|refund|payout|createAdminClient/i) || [""])[0]);
}

section("I. a section that cannot be read is 'failed', never zero: ");
{
  await H.fresh(EXTRA);
  await H.db.exec("alter table public.ministry_attendance_counts rename to x_counts_gone");
  const r = R(await rep(O));
  eq("attendance is reported as failed", [r.failed, r.sections.attendance], [["attendance"], undefined]);
  eq("the other sections still arrive", Object.keys(r.sections).sort(), ["bible", "content", "events", "groups", "people"]);
  const csv = await rep(O, "section=attendance&format=csv");
  is("its CSV is an error, not an empty file", csv, 502, "report_failed");
}

section("J. text: ");
{
  const en = TR.en.churchReports, fr = TR.fr.churchReports;
  const shape = (a, b, p = "") => { const out = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = a[k], y = b[k], here = `${p}.${k}`; if (typeof x !== typeof y) out.push(here); else if (x && typeof x === "object") out.push(...shape(x, y, here)); else if (typeof x === "function" && x.length !== y.length) out.push(here + "()"); else if (typeof x === "string" && (!x.trim() || !y.trim())) out.push(here + " empty"); } return out; };
  eq("English and French have exactly the same keys, types and arity", shape(en, fr), []);
  check("the workspace tab and the 'no access' sentence exist in both languages", TR.en.churchWorkspace.tabs.reports && TR.fr.churchWorkspace.tabs.reports && TR.en.churchWorkspace.restricted.reports && TR.fr.churchWorkspace.restricted.reports);
  const codes = new Set(["unexpected_field", "invalid_report_date", "invalid_range", "range_too_long", "invalid_section", "invalid_format", "invalid_lang", "section_unavailable", "report_failed", "forbidden"]);
  const src = fs.readFileSync(path.join(REPO, "src/lib/church/reports/handlers.ts"), "utf8");
  for (const mm of src.matchAll(/(?:fail\(\d{3}, |code: )"([a-z_]+)"/g)) codes.add(mm[1]);
  for (const c of codes) {
    check(`code ${c} has a sentence in both languages`, !!(en.errors[c] ?? TR.en.churchPeople.errors[c]) && !!(fr.errors[c] ?? TR.fr.churchPeople.errors[c]), c);
    check(`code ${c} is not the generic sentence (EN)`, ET.churchErrorText(TR.en, c) !== TR.en.churchPeople.errors.generic, c);
    check(`code ${c} is not the generic sentence (FR)`, ET.churchErrorText(TR.fr, c) !== TR.fr.churchPeople.errors.generic, c);
  }
  const fig = (id, lang) => Object.keys(TR[lang].churchReports.figures[id]);
  const keysFor = (id, model) => CSV.sectionFigures(id, model).map(([k]) => k);
  // every figure the code produces has a label in both languages
  const sample = { period: { from: D0, to: D0, days: 1 }, today: D0, unavailable: [], failed: [], sections: { people: { byStatus: { pending: 0, active: 0, inactive: 0, removed: 0 }, activeByAgeGroup: { adult: 0, youth: 0 }, activeByLanguage: { en: 0, fr: 0, unknown: 0 }, addedInRange: 0 }, groups: { byKind: { department: 0, group: 0 }, openLeadershipAppointments: 0 }, events: { published: 0, cancelled: 0, upcoming: 0, past: 0, announcementsPublishedInRange: 0 }, attendance: { events: [], truncated: false, totals: { eventsListed: 0, eventsWithAttendance: 0, present: 0, visitors: 0, children: 0, total: 0, averagePerRecordedEvent: 0, peak: 0, totalNoChildren: 0, averageNoChildren: 0, peakNoChildren: 0 } }, bible: { published: 0, drafts: 0, programs: [], truncated: false, totalEnrolled: 0 }, content: { publishedInRange: 0, scheduledAhead: 0, drafts: 0 } } };
  for (const id of ["people", "groups", "events", "attendance", "bible", "content"]) for (const lang of ["en", "fr"]) {
    const missing = keysFor(id, sample).filter((k) => !fig(id, lang).includes(k));
    check(`every ${id} figure has a ${lang} label`, missing.length === 0, missing.join());
  }
  check("French is a translation, not a copy", ["subtitle", "privacy"].every((k) => en[k] !== fr[k]));
}

H.close();
process.exit(summary());
