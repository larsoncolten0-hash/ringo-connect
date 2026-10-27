// Churches & Ministries Phase 7: the Attendance screens, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for `churchAttendance`, and a sentence in BOTH languages for every server code the attendance routes can send;
//   * no hard-coded user-facing text, no browser storage, no markup injection, accessibility basics, the confirmation rules, in the screens' source;
//   * the real presentational detail screen rendered in every state, in both languages (names hidden, cancelled, view only, empty, with people, searching, a group, stale counts);
//   * the real workspace shell: each tab appears only for the people allowed to open it.
// The live data flows are exercised in a real browser during QA (they need a DOM); the data rules behind them are covered by ministryAttendance*.test.mjs.
//   Run:  node scripts/tests/ministryAttendanceUi.test.mjs
import fs from "fs";
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, React, overrideExport } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
// the portal-based dialog draws nothing in a static render: a probe shows exactly what the screen asks it to say
overrideExport("components/church/people/shared.tsx", "ConfirmDialog", (p) => React.createElement("div", { "data-confirm": "1" }, `[${p.title}|${p.body}|${p.confirmLabel}|${p.danger ? "danger" : "normal"}]`));

// ---------------------------------------------------------------- 1. dictionary parity and error coverage
{
  const out = walkDictionary(translations.en.churchAttendance, translations.fr.churchAttendance, "churchAttendance");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 6).map(([k]) => k);
  check("French is a translation, not a copy", same.length <= 2, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? [3, 1] : sampleArgs(key, a);
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  const e = translations.en.churchAttendance, f = translations.fr.churchAttendance;
  check("plurals", e.list.count(1) === "1 event" && e.list.count(2) === "2 events" && f.list.count(1) === "1 événement" && f.list.count(2) === "2 événements" && e.detail.people.heading(1) === "1 person present" && e.detail.people.heading(3) === "3 people present" && f.detail.people.heading(1) === "1 personne présente" && f.detail.people.heading(3) === "3 personnes présentes" && e.list.children(1) === "1 child" && f.list.children(2) === "2 enfants");
  // every code the attendance routes can send has its own sentence in both languages
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  const handlers = read("src/lib/church/attendance/handlers.ts"), errors = read("src/lib/church/errors.ts"), routeKit = read("src/lib/church/routeKit.ts");
  grab(handlers, /fail\(\d{3}, "([a-z_]+)"/g);
  grab(handlers, /code: "([a-z_]+)"/g);
  grab(routeKit, /error: "([a-z_]+)"/g);
  for (const m of errors.matchAll(/attendance_[a-z_]+: \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of errors.matchAll(/ministry_attendance[^\n]*code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const c of ["invalid_page", "unexpected_field", "invalid_body", "not_found", "forbidden", "stale", "invalid", "conflict", "in_use", "server_error", "event_has_attendance", "not_available"]) codes.add(c);
  const generic = (loc) => translations[loc].churchPeople.errors.generic;
  const missing = [...codes].filter((c) => ET.churchErrorText(translations.en, c) === generic("en") || ET.churchErrorText(translations.fr, c) === generic("fr"));
  // codes that deliberately fall back to the shared generic sentence (a conflict the person cannot act on) are not listed as missing
  const allowedGeneric = new Set(["invalid", "conflict", "in_use", "server_error", "not_available"]);
  const reallyMissing = missing.filter((c) => !allowedGeneric.has(c));
  check("every code the attendance routes can send has its own sentence in English AND French", reallyMissing.length === 0, reallyMissing.join(", "));
  check("no error sentence leaks internals", [...Object.values(e.errors), ...Object.values(f.errors)].every((s) => !/ministry_|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.attendance|42501|church_members/i.test(s)));
  check("the privacy line is stated on the list in both languages", /private/i.test(e.subtitle) && /privée/i.test(f.subtitle) && /public page/i.test(e.subtitle) && /page publique/i.test(f.subtitle));
}

// ---------------------------------------------------------------- 2. source rules
{
  const dir = path.join(SRC, "components/church/attendance");
  const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(dir, f));
  check("the screens exist", files.length === 2, files.map((f) => path.basename(f)).join(","));
  for (const f of files) {
    const problems = sourceProblems(f);
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, service client, untyped button or unnamed field`, problems.length === 0, problems.join(" || "));
    const src = noComments(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
    check(`${path.basename(f)}: no foundation (opt-in) design tokens on this existing screen family`, !/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b/.test(src));
  }
  const detail = noComments(read("src/components/church/attendance/AttendanceDetail.tsx"));
  check("removing a person and recording a whole group are each confirmed", (detail.match(/<ConfirmDialog/g) || []).length === 2);
  check("a child is never offered or sent: the search and the group both drop them, and the server refuses them anyway", (detail.match(/age_group !== "child"/g) || []).length === 2);
  check("exactly ONE counts save button, with the loaded updated_at for an existing count", (detail.match(/onClick=\{p\.onSaveCounts\}/g) || []).length === 1 && /body\.expected_updated_at = data\.counts\.updated_at/.test(detail));
  check("the screen never sends a church, an event status or a recorder", !/profile_id|profileId|recorded_by|status:/.test(detail.replace(/status: "active"/g, "")));
  check("controls are touch-sized and the icon-only remove button has an accessible name", /min-h-\[44px\]/.test(detail) && /min-w-\[44px\]/.test(detail) && /aria-label=\{c\.people\.remove\(name\)\}/.test(detail));
  check("long names wrap or truncate instead of overflowing on a phone", /truncate/.test(detail) && /\[overflow-wrap:anywhere\]/.test(detail));
  check("a stale count is explained and offers a reload", /role="alert"/.test(detail) && /c\.counts\.reload/.test(detail));
  check("search results are announced politely", /aria-live="polite"/.test(detail));
  const list = noComments(read("src/components/church/attendance/AttendanceList.tsx"));
  check("the list is server-paged and numbers only (no names)", /Pager/.test(list) && /page=\$\{page\}/.test(list) && !/full_name|member_id/.test(list));
}

// ---------------------------------------------------------------- 3. the real screens, in every state
{
  const View = component("components/church/attendance/AttendanceDetail.tsx", "AttendanceDetailView");
  const List = component("components/church/attendance/AttendanceList.tsx");
  const caps = (...p) => PERM.churchCapabilities(p);
  const base = (over = {}, capsList = ["church.attendance.manage", "church.members.view", "church.groups.view"]) => ({
    lang: "en", caps: caps(...capsList), notice: "", error: "", busy: false, text: "", onText() {}, q: "", searching: false, found: [], groups: [], groupId: "", onGroup() {}, presentIds: new Set(), canSearch: true, stale: false,
    visitors: "2", childrenCount: "1", onVisitors() {}, onChildren() {}, onReload() {}, onMarkOne() {}, removing: null, onAskRemove() {}, onRemove: async () => "", confirmGroup: false, onAskGroup() {}, onMarkGroup: async () => "", onSaveCounts() {},
    data: {
      event: { id: uid(1), event_date: "2026-10-18", start_time: "09:00", end_time: null, title_en: "Sunday service", title_fr: "Culte du dimanche", venue: "Main hall", is_cancelled: false },
      people: [{ member_id: uid(11), full_name: "Grace Admin", recorded_at: "2026-10-18T09:05:00Z" }, { member_id: uid(12), full_name: "Luc Leader", recorded_at: "2026-10-18T09:06:00Z" }],
      counts: { visitors: 2, children: 1, updated_at: "2026-10-18T10:00:00Z" },
      can: { record: true, remove: true, seeNames: true },
      open: true,
    },
    ...over,
  });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang], c = t.churchAttendance.detail;
    const h = html(View, base({ lang }), lang);
    check(`detail (${lang}): the title in ${lang}, the date and venue, the people with names, the count heading`, h.includes(lang === "en" ? "Sunday service" : "Culte du dimanche") && h.includes("Main hall") && h.includes("Grace Admin") && h.includes("Luc Leader") && h.includes(c.people.heading(2)), h.slice(0, 300));
    check(`detail (${lang}): labelled sections, real headings, a remove button per person with an accessible name`, /<section aria-labelledby="att-people-heading"/.test(h) && /<h3 id="att-people-heading"/.test(h) && h.includes(`aria-label="${c.people.remove("Grace Admin")}"`) && h.includes(`aria-label="${c.people.remove("Luc Leader")}"`));
    check(`detail (${lang}): the record panel with its search field, the counts with both fields and ONE save button`, h.includes(c.add.heading) && h.includes('id="att-search"') && h.includes(c.add.searchLabel) && h.includes('id="att-visitors"') && h.includes('id="att-children"') && (h.match(new RegExp(`>${c.counts.save}<`, "g")) || []).length === 1);
    check(`detail (${lang}): the save button is disabled until a count changes`, new RegExp(`<button[^>]*\\sdisabled=""[^>]*>(?:<[^>]*>)*${c.counts.save}`).test(h), "");
    const changed = html(View, base({ lang, visitors: "5" }), lang);
    check(`detail (${lang}): a changed count enables the save button`, !new RegExp(`<button[^>]*\\sdisabled=""[^>]*>(?:<[^>]*>)*${c.counts.save}`).test(changed) && changed.includes(`>${c.counts.save}<`));
    const hidden = html(View, base({ lang, canSearch: false, data: { ...base().data, can: { record: true, remove: true, seeNames: false }, people: [{ member_id: uid(11), full_name: null, recorded_at: "x" }] } }, ["church.attendance.manage"]), lang);
    check(`detail (${lang}): without People access the names are hidden, with a clear note, and nothing can be searched`, hidden.includes(c.namesHidden) && hidden.includes(c.needsPeople) && hidden.includes(c.people.unnamed) && !hidden.includes("Grace Admin") && !hidden.includes('id="att-search"'));
    const cancelled = html(View, base({ lang, canSearch: false, data: { ...base().data, event: { ...base().data.event, is_cancelled: true }, open: false, can: { record: false, remove: true, seeNames: true } } }), lang);
    check(`detail (${lang}): a cancelled event says so, offers no search and no counts save`, cancelled.includes(c.cancelledBanner) && !cancelled.includes('id="att-search"') && !cancelled.includes(`>${c.counts.save}<`));
    const viewOnly = html(View, base({ lang, canSearch: false, data: { ...base().data, can: { record: false, remove: false, seeNames: true } } }, ["church.attendance.view", "church.members.view"]), lang);
    check(`detail (${lang}): view only: the note, no remove buttons, no search, disabled count fields, no save`, viewOnly.includes(c.viewOnly) && !viewOnly.includes(c.people.remove("Grace Admin").slice(0, 6) + "x") && !/aria-label="[^"]*Grace Admin"/.test(viewOnly) && !viewOnly.includes('id="att-search"') && !viewOnly.includes(`>${c.counts.save}<`) && /id="att-visitors"[^>]*disabled/.test(viewOnly));
    const empty = html(View, base({ lang, data: { ...base().data, people: [], counts: null } }), lang);
    check(`detail (${lang}): the empty state`, empty.includes(c.people.empty) && empty.includes(c.people.heading(0)));
    const search = html(View, base({ lang, text: "gr", q: "gr", found: [{ id: uid(11), full_name: "Grace Admin", age_group: "adult" }, { id: uid(13), full_name: "Gabriel Guest", age_group: "adult" }], presentIds: new Set([uid(11)]) }), lang);
    check(`detail (${lang}): search results: one already recorded (badge), one to mark with an accessible button`, search.includes(c.add.here) && search.includes(`aria-label="${c.add.mark("Gabriel Guest")}"`) && !search.includes(`aria-label="${c.add.mark("Grace Admin")}"`));
    check(`detail (${lang}): searching and no-result states`, html(View, base({ lang, text: "zz", q: "zz", searching: true }), lang).includes(c.add.searching) && html(View, base({ lang, text: "zz", q: "zz", found: [] }), lang).includes(c.add.noResults));
    const grp = html(View, base({ lang, groups: [{ id: uid(21), name: "Choir", member_count: 3 }], groupId: uid(21) }), lang);
    check(`detail (${lang}): the group shortcut lists groups with their size and an enabled button`, grp.includes("Choir") && grp.includes(c.add.groupMembers(3)) && grp.includes(c.add.groupButton) && !new RegExp(`<button[^>]*\\sdisabled=""[^>]*>(?:<[^>]*>)*${c.add.groupButton}`).test(grp));
    const grpConfirm = html(View, base({ lang, groups: [{ id: uid(21), name: "Choir", member_count: 3 }], groupId: uid(21), confirmGroup: true }), lang);
    check(`detail (${lang}): the group confirmation names the group and says children are excluded`, grpConfirm.includes(`[${c.add.groupConfirmTitle("Choir")}|${c.add.groupConfirmBody}|${c.add.groupConfirm}|normal]`));
    const rm = html(View, base({ lang, removing: { member_id: uid(11), full_name: "Grace Admin", recorded_at: "x" } }), lang);
    check(`detail (${lang}): the remove confirmation names the person and is a danger action`, rm.includes(`[${c.people.removeTitle}|${c.people.removeBody("Grace Admin")}|${c.people.removeConfirm}|danger]`));
    const stale = html(View, base({ lang, stale: true }), lang);
    check(`detail (${lang}): a stale count shows the alert with a reload button`, /role="alert"/.test(stale) && stale.includes(c.counts.stale) && stale.includes(c.counts.reload));
    check(`detail (${lang}): an error line and a notice are shown`, html(View, base({ lang, error: "Boom sentence" }), lang).includes("Boom sentence") && html(View, base({ lang, notice: "Saved note" }), lang).includes("Saved note"));
    check(`detail (${lang}): markup in a name is escaped`, (() => { const x = html(View, base({ lang, data: { ...base().data, people: [{ member_id: uid(11), full_name: "<img src=x onerror=alert(1)>", recorded_at: "x" }] } }), lang); return !/<img src=x/.test(x) && x.includes("&lt;img"); })());
    const list = html(List, {}, lang);
    check(`list (${lang}): renders its first state without a browser`, typeof list === "string");
  }
}

// ---------------------------------------------------------------- 4. the workspace shell
{
  const Shell = component("components/church/people/ChurchShell.tsx");
  const NoAccess = component("components/church/people/ChurchShell.tsx", "NoAccess");
  const caps = (...p) => PERM.churchCapabilities(p);
  const tabs = (h) => [...h.matchAll(/<a href="(\/dashboard\/church\/[a-z-]+)"/g)].map((m) => m[1]);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const all = html(Shell, { caps: caps(...PERM.CHURCH_PERMISSIONS), isOwner: true, children: null }, lang);
    check(`shell (${lang}): the owner sees every tab, in order`, tabs(all).join() === "/dashboard/church/people,/dashboard/church/members,/dashboard/church/groups,/dashboard/church/leadership,/dashboard/church/content,/dashboard/church/events,/dashboard/church/announcements,/dashboard/church/group-pages,/dashboard/church/pastors,/dashboard/church/bible,/dashboard/church/attendance,/dashboard/church/music,/dashboard/church/reports,/dashboard/church/care,/dashboard/church/testimonies,/dashboard/church/counselling,/dashboard/church/giving,/dashboard/church/features,/dashboard/church/store", tabs(all).join());
    check(`shell (${lang}): the new tabs are labelled in ${lang}`, all.includes(t.churchWorkspace.tabs.events) && all.includes(t.churchWorkspace.tabs.announcements) && all.includes(t.churchWorkspace.tabs.bible) && all.includes(t.churchWorkspace.tabs.attendance) && all.includes(t.churchWorkspace.tabs.music) && all.includes(t.churchWorkspace.tabs.store));
    const staff = html(Shell, { caps: caps("church.attendance.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): staff holding only attendance.view see only that tab`, tabs(staff).join() === "/dashboard/church/attendance", tabs(staff).join());
    const ev = html(Shell, { caps: caps("church.events.manage"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): events permissions open Events and Announcements`, tabs(ev).join() === "/dashboard/church/events,/dashboard/church/announcements");
    const music = html(Shell, { caps: caps("church.music.manage"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): music.manage opens Music only; the Store tab never appears for staff`, tabs(music).join() === "/dashboard/church/music" && !tabs(staff).includes("/dashboard/church/store"));
    // The church redesign replaced the sideways-scrolling tab bar with a sidebar (wide screens) and an in-place grid (phones).
    check(`shell (${lang}): the section navigation never scrolls sideways`, !/overflow-x-auto/.test(all));
    for (const section of ["events", "bible", "attendance", "music", "store"]) {
      const na = html(NoAccess, { section }, lang);
      check(`no access (${lang}): ${section}`, na.includes(t.churchWorkspace.restricted[section]));
    }
    check(`no access (${lang}): the original sections still say what they said`, html(NoAccess, { section: "content" }, lang).includes(t.churchPeople.restricted.content) && html(NoAccess, { section: "people" }, lang).includes(t.churchPeople.restricted.people));
  }
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
