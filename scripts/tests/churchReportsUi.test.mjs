// Churches & Ministries Phase 10: the Reports screen, checked OFFLINE (no database, no network, no dev server).
//   * the real presentational report rendered with real data shapes in both languages (every section, empty, failed, truncated, markup in a title);
//   * the screen's source: no hard-coded text, no browser storage, no markup injection, accessible controls, no database client;
//   * the real workspace shell: the Reports tab appears only for people who hold church.reports.view.
//   Run:  node scripts/tests/churchReportsUi.test.mjs
import path from "path";
import { SRC, read, noComments, jiti, translations, sourceProblems, component, html, uid, walkDictionary } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const Sections = component("components/church/reports/ReportsView.tsx", "ReportSections");
const Shell = component("components/church/people/ChurchShell.tsx");
const D0 = "2026-10-24";

const model = (over = {}) => ({
  period: { from: "2026-09-25", to: D0, days: 30 },
  today: D0,
  unavailable: [],
  failed: [],
  sections: {
    people: { scope: "snapshot+range", byStatus: { pending: 1, active: 6, inactive: 2, removed: 0 }, activeByAgeGroup: { adult: 5, youth: 1 }, activeByLanguage: { en: 3, fr: 2, unknown: 1 }, addedInRange: 4 },
    groups: { scope: "snapshot", byKind: { department: 2, group: 3 }, openLeadershipAppointments: 4 },
    events: { scope: "range", published: 5, cancelled: 1, upcoming: 2, past: 3, announcementsPublishedInRange: 2 },
    attendance: { scope: "range", truncated: false, events: [
      { event_id: uid(1), event_date: "2026-10-18", title_en: "Sunday service", title_fr: "Culte du dimanche", is_cancelled: false, present: 40, visitors: 5, children: 12, total: 57, totalNoChildren: 45, recorded: true },
      { event_id: uid(2), event_date: "2026-10-11", title_en: "<img src=x onerror=alert(1)>", title_fr: null, is_cancelled: true, present: 0, visitors: 0, children: 0, total: 0, totalNoChildren: 0, recorded: false },
    ], totals: { eventsListed: 2, eventsWithAttendance: 1, present: 40, visitors: 5, children: 12, total: 57, averagePerRecordedEvent: 57, peak: 57, totalNoChildren: 45, averageNoChildren: 45, peakNoChildren: 45 } },
    bible: { scope: "snapshot", published: 1, drafts: 1, truncated: false, totalEnrolled: 9, programs: [{ program_id: uid(3), title_en: "Read the Psalms", title_fr: "Lire les Psaumes", sessions: 30, enrolled: 9 }] },
    content: { scope: "range", publishedInRange: 20, scheduledAhead: 2, drafts: 1 },
  },
  ...over,
});

for (const lang of ["en", "fr"]) {
  const t = translations[lang];
  const c = t.churchReports;
  const h = html(Sections, { report: model(), lang }, lang);
  check(`report (${lang}): every section has a heading in ${lang}`, ["people", "groups", "events", "attendance", "bible", "content"].every((id) => h.includes(`>${c.sections[id]}<`)), h.slice(0, 200));
  check(`report (${lang}): figures are labelled and shown`, h.includes(c.figures.people.active) && h.includes(c.figures.attendance.visitors) && h.includes(">57<") && h.includes(c.figures.bible.followers));
  check(`report (${lang}): the scope line says which numbers are as of today`, h.includes(c.scope.mixed) && h.includes(c.scope.snapshot) && h.includes(c.scope.range));
  check(`report (${lang}): one CSV download per section, named for it, pointing at the report API with the right range and language`, (h.match(/href="\/api\/church\/reports\?from=2026-09-25&to=2026-10-24&section=[a-z]+&format=csv&lang=/g) || []).length === 6 && h.includes(`&lang=${lang}`) && h.includes(`aria-label="${c.csv.downloadLabel(c.sections.attendance)}"`));
  check(`report (${lang}): the attendance table has a caption and column headers`, h.includes(c.attendance.tableLabel) && h.includes(`>${c.attendance.visitors}<`) && h.includes("<th scope=\"col\""));
  check(`report (${lang}): a cancelled event says so; an event with nothing recorded says so`, h.includes(`(${c.attendance.cancelled})`) && h.includes(c.attendance.notRecorded));
  check(`report (${lang}): the French/English title follows the language`, lang === "fr" ? h.includes("Culte du dimanche") : h.includes("Sunday service"));
  check(`report (${lang}): the Bible table shows a follower number and the privacy line, never a person`, h.includes("Read the Psalms") === (lang === "en") || h.includes("Lire les Psaumes") === (lang === "fr") ? h.includes(c.bible.privacyNote) : false);
  check(`report (${lang}): markup in an event title is escaped`, !/<img src=x/.test(h) && h.includes("&lt;img") || !h.includes("<img"));
  check(`report (${lang}): the CSV note says totals only`, h.includes(c.csv.note));
  const failed = html(Sections, { report: model({ sections: { events: model().sections.events }, failed: ["attendance"] }), lang }, lang);
  check(`report (${lang}): a section that could not load says so and offers no download`, failed.includes(c.state.failed) && (failed.match(/format=csv/g) || []).length === 1);
  const none = html(Sections, { report: model({ sections: {}, unavailable: ["people", "groups", "events", "attendance", "bible", "content"] }), lang }, lang);
  check(`report (${lang}): with no section the screen explains it`, none.includes(c.state.noSections));
  const trunc = html(Sections, { report: model({ sections: { attendance: { ...model().sections.attendance, truncated: true } } }), lang }, lang);
  check(`report (${lang}): a truncated attendance table says how many are shown`, trunc.includes(c.attendance.truncated(2)));
  const emptyAtt = html(Sections, { report: model({ sections: { attendance: { ...model().sections.attendance, events: [], totals: { ...model().sections.attendance.totals, eventsListed: 0 } } } }), lang }, lang);
  check(`report (${lang}): no events in the range says so`, emptyAtt.includes(c.attendance.none));
  check(`report (${lang}): the report holds no person's name or contact`, !/Grace|Olivier|@example|\+237/.test(h));
}

// ---------------------------------------------------------------- the screen's source
{
  const file = path.join(SRC, "components/church/reports/ReportsView.tsx");
  const problems = sourceProblems(file);
  check("the screen: no hard-coded text, no storage, no raw HTML, typed buttons, labelled fields, no database client", problems.length === 0, problems.join(" ; "));
  const src = noComments(read("src/components/church/reports/ReportsView.tsx"));
  check("the screen only calls /api/church/reports", /\/api\/church\/reports/.test(src) && !/\/api\/(?!church\/reports)/.test(src.replace(/\/api\/church\/reports/g, "")));
  check("the date inputs are labelled and bounded", /type="date"/.test(src) && /min="2020-01-01"/.test(src));
  const page = noComments(read("src/app/dashboard/church/reports/page.tsx"));
  check("the page resolves the actor on the server and shows NoAccess without the capability", /resolveChurchActor/.test(page) && /caps\.viewReports/.test(page) && /NoAccess section="reports"/.test(page) && /kind === "leader"/.test(page));
}

// ---------------------------------------------------------------- dictionary parity
{
  const out = walkDictionary(translations.en.churchReports, translations.fr.churchReports, "churchReports");
  check("EN and FR have exactly the same keys, types and arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 8 && a.includes(" ")).map(([k]) => k);
  check("French is a translation, not a copy", same.length === 0, same.join(", "));
  const e = translations.en.churchReports, f = translations.fr.churchReports;
  check("plurals", e.range.shown(1) === "1 day" && e.range.shown(30) === "30 days" && f.range.shown(1) === "1 jour" && f.range.shown(30) === "30 jours");
  const c = translations.en.churchCare, fc = translations.fr.churchCare;
  const out2 = walkDictionary(c, fc, "churchCare");
  check("churchCare: EN and FR have the same keys and no empty text", out2.shape.length === 0 && out2.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""), out2.shape.join("; "));
}

// ---------------------------------------------------------------- the workspace shell
{
  const caps = (...p) => PERM.churchCapabilities(p);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const withReports = html(Shell, { caps: caps("church.reports.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): a person with church.reports.view sees the Reports tab labelled in ${lang}`, withReports.includes('href="/dashboard/church/reports"') && withReports.includes(t.churchWorkspace.tabs.reports));
    const without = html(Shell, { caps: caps("church.attendance.view", "church.events.view", "church.members.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): holding every data permission but not reports.view shows NO Reports tab`, !without.includes('href="/dashboard/church/reports"'));
    const owner = html(Shell, { caps: caps(...PERM.CHURCH_PERMISSIONS), isOwner: true, children: null }, lang);
    check(`shell (${lang}): the owner sees Reports before Store`, owner.indexOf("/dashboard/church/reports") > 0 && owner.indexOf("/dashboard/church/store") > owner.indexOf("/dashboard/church/reports"));
    const careOnly = html(Shell, { caps: caps("church.care.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): a care permission opens the Care tab and never the Reports tab`, careOnly.includes('href="/dashboard/church/care"') && !careOnly.includes('href="/dashboard/church/reports"'));
  }
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
