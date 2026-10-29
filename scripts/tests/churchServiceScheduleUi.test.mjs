// Churches & Ministries Recurring Weekly Services: the dashboard screen, the public card and the page wiring, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for `churchSchedule`, a sentence in BOTH languages for every code the schedule routes can send;
//   * no hard-coded user-facing text, no browser storage, accessibility basics, in the new screens' source;
//   * the real presentational screen rendered in each state in both languages (loading, error, empty, list, read-only, form, remove dialog);
//   * the real public card rendered for the server (a plain weekly timetable, no dates that could disagree with the browser) and its countdown wording;
//   * additive wiring only: the church page, the public loader and the events dashboard gain the feature, nothing else changes, and it stays exclusive to the church category.
//   Run:  node scripts/tests/churchServiceScheduleUi.test.mjs
import fs from "fs";
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sourceProblems, component, html, React, overrideExport, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

overrideExport("components/church/people/shared.tsx", "ConfirmDialog", (p) => React.createElement("div", { "data-confirm": "1" }, `[${p.title}|${p.body}|${p.confirmLabel}|${p.danger ? "danger" : "normal"}]`));
const H = jiti(path.join(SRC, "lib/church/schedule/handlers.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const EN = translations.en.churchSchedule, FR = translations.fr.churchSchedule;

// ---------------------------------------------------------------- 1. dictionaries
{
  const out = walkDictionary(translations.en.churchSchedule, translations.fr.churchSchedule, "churchSchedule");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([k, a, b]) => a === b && a.length > 6).map(([k]) => k);
  check("French is a translation, not a copy", same.length <= 1, same.join(", "));
  check("seven weekday names, Sunday first (the numbering of the data), in both languages", EN.weekdays.length === 7 && FR.weekdays.length === 7 && EN.weekdays[0] === "Sunday" && FR.weekdays[0] === "Dimanche" && EN.weekdays[6] === "Saturday" && FR.weekdays[6] === "Samedi");
  check("plurals", EN.list.count(1) === "1 service" && EN.list.count(3) === "3 services" && FR.list.count(1) === "1 culte" && FR.list.count(3) === "3 cultes");
  check("the countdown sentences wrap a ready-made duration", EN.public.startsIn("2 h 5 min") === "Starts in 2 h 5 min" && FR.public.startsIn("2 h 5 min") === "Commence dans 2 h 5 min" && EN.public.endsIn("10 min") === "Ends in 10 min" && FR.public.endsIn("10 min") === "Se termine dans 10 min");
  check("status words are distinct and written out (never colour alone)", new Set([EN.public.live, EN.public.upcoming, EN.public.ended]).size === 3 && new Set([FR.public.live, FR.public.upcoming, FR.public.ended]).size === 3);
  for (const [key, a, b] of out.fns) {
    const args = key.includes("count") || key.includes("limitReached") ? [3] : key.includes("itemAria") ? ["Sunday", "Upcoming", "Today"] : key.includes("range") ? ["09:00", "12:00"] : key.includes("timezoneLabel") ? ["Africa/Douala"] : ["Sunday worship"];
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  // every code the routes can send has a sentence in BOTH languages (the schedule screen's own, or a shared one)
  const codes = new Set();
  const handlers = read("src/lib/church/schedule/handlers.ts"), errors = read("src/lib/church/errors.ts");
  for (const m of handlers.matchAll(/fail\(\d{3}, "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of handlers.matchAll(/code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of errors.matchAll(/schedule_[a-z_]+: \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of errors.matchAll(/church_service_schedule[^\n]*code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const c of ["unexpected_field", "invalid_body", "not_found", "forbidden", "stale", "empty_update", "invalid", "conflict", "server_error", "not_available", "invalid_text"]) codes.add(c);
  const lookup = (loc, code) => (translations[loc].churchSchedule.errors[code]) ?? ET.churchErrorText(translations[loc], code);
  const generic = (loc) => translations[loc].churchPeople.errors.generic;
  const allowedGeneric = new Set(["invalid", "conflict", "server_error", "not_available", "empty_update", "invalid_body", "invalid_text"]);
  const missing = [...codes].filter((c) => !allowedGeneric.has(c) && (lookup("en", c) === generic("en") || lookup("fr", c) === generic("fr")));
  check("every code the schedule routes can send has its own sentence in English and French", missing.length === 0, missing.join(", "));
  check("the schedule's sentences do not change what the events screens say (no shared-code shadowing)", ET.churchErrorText(translations.en, "invalid_time_range") === translations.en.churchEvents.errors.invalid_time_range && ET.churchErrorText(translations.en, "needs_title") === (translations.en.churchEvents.errors.needs_title ?? translations.en.churchPeople.errors.needs_title ?? ET.churchErrorText(translations.en, "needs_title")));
}

// ---------------------------------------------------------------- 2. source rules
{
  for (const f of ["components/church/schedule/ServiceSchedule.tsx", "components/church/site/ChurchServicesCard.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, storage, raw HTML, direct database use, typeless buttons or unnamed fields`, problems.length === 0, problems.join(" || "));
  }
  const dash = noComments(read("src/components/church/schedule/ServiceSchedule.tsx"));
  check("the dashboard talks only to /api/church/services", /\/api\/church\/services/.test(dash) && !/\/api\/(?!church\/services)/.test(dash));
  check("every change names the version it is based on", /expected_updated_at/.test(dash));
  check("the form validates end after start before sending, but the server still decides", /form\.start_time < form\.end_time/.test(dash));
  check("the timezone is a suggestion from the device, never hardcoded to one city as the only choice", /resolvedOptions\(\)\.timeZone/.test(dash));
  const card = noComments(read("src/components/church/site/ChurchServicesCard.tsx"));
  check("the public card computes everything from the schedule rules (no fetch, no storage)", /currentOccurrences/.test(card) && !/fetch\(/.test(card));
  check("the countdown refreshes quietly (an interval, cleaned up) and is not a live region", /setInterval/.test(card) && /clearInterval/.test(card) && !/aria-live/.test(card));
  check("the card has a labelled heading", /aria-labelledby/.test(card));
}

// ---------------------------------------------------------------- 3. the dashboard screen in every state, both languages
{
  const View = component("components/church/schedule/ServiceSchedule.tsx", "ServiceScheduleView");
  const noop = () => {};
  const base = { data: null, loading: false, loadError: "", notice: "", rowError: "", form: null, saving: false, formError: "", removing: null, onRetry: noop, onAdd: noop, onEdit: noop, onForm: noop, onCancelForm: noop, onSubmit: noop, onToggle: noop, onAskRemove: noop, onRemove: async () => "" };
  const row = (o = {}) => ({ id: "00000000-0000-4000-8000-000000000001", title_en: "Sunday worship", title_fr: "Culte du dimanche", description_en: null, description_fr: null, location: "Main hall", weekday: 0, start_time: "09:00", end_time: "12:00", timezone: "Africa/Douala", is_enabled: true, updated_at: "2026-01-01T00:00:00Z", ...o });
  const list = (items, can = true) => ({ items, limit: 30, can_edit: can });
  const form = { id: null, title_en: "", title_fr: "", description_en: "", description_fr: "", location: "", weekday: 0, start_time: "09:00", end_time: "12:00", timezone: "Africa/Douala", is_enabled: true };
  for (const lang of ["en", "fr"]) {
    const T = translations[lang].churchSchedule;
    const at = (label, props, test) => { const out = html(View, { ...base, ...props }, lang); check(`${lang}: ${label}`, test(out), out.slice(0, 300)); return out; };
    at("loading shows a skeleton and the explanation", { loading: true }, (o) => o.includes(T.title) && o.includes(T.subtitle) && o.includes(T.timezoneNote));
    at("a load error offers a retry and a sentence", { loadError: "Boom" }, (o) => o.includes(T.list.loadError) && o.includes(translations[lang].churchPeople.common.retry));
    at("empty: title, body and an Add button", { data: list([]) }, (o) => o.includes(T.list.emptyTitle) && o.includes(T.list.emptyBody) && o.includes(T.list.add));
    at("a service shows its name in the language, day, times, timezone and place", { data: list([row()]) }, (o) => o.includes(lang === "fr" ? "Culte du dimanche" : "Sunday worship") && o.includes(T.weekdays[0]) && o.includes("09:00 - 12:00") && o.includes("Africa/Douala") && o.includes("Main hall"));
    at("a switched-off service is labelled", { data: list([row({ is_enabled: false })]) }, (o) => o.includes(T.list.offBadge) && o.includes(T.actions.switchOn(lang === "fr" ? "Culte du dimanche" : "Sunday worship")));
    at("a service named in one language only falls back to it", { data: list([row({ title_en: null, title_fr: "Culte seul" })]) }, (o) => o.includes("Culte seul"));
    at("read-only people see the list but no Add, edit, switch or remove", { data: list([row()], false) }, (o) => o.includes(T.list.readOnly) && !o.includes(T.list.add) && !o.includes(T.actions.edit("Sunday worship")) && !o.includes(T.actions.remove("Culte du dimanche")));
    at("editors see Add, edit, switch off and remove, each with a named accessible label", { data: list([row()]) }, (o) => o.includes(T.list.add) && o.includes(`aria-label="${T.actions.edit(lang === "fr" ? "Culte du dimanche" : "Sunday worship")}"`) && o.includes(`aria-label="${T.actions.remove(lang === "fr" ? "Culte du dimanche" : "Sunday worship")}"`));
    at("the limit message and a disabled Add", { data: { items: Array.from({ length: 30 }, (_, i) => row({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` })), limit: 30, can_edit: true } }, (o) => o.includes(T.list.limitReached(30)) && /disabled/.test(o));
    at("the form: both names, weekday, times, timezone, descriptions, place, switch and buttons", { data: list([]), form }, (o) => [T.form.addTitle, T.form.titleEn, T.form.titleFr, T.form.weekday, T.form.start, T.form.end, T.form.timezone, T.form.descriptionEn, T.form.descriptionFr, T.form.location, T.form.enabled, T.form.cancel, T.form.save].every((s) => o.includes(s)));
    at("the weekday list starts on Monday and ends on Sunday", { data: list([]), form }, (o) => o.indexOf(`>${T.weekdays[1]}<`) < o.indexOf(`>${T.weekdays[0]}<`) && o.indexOf(`>${T.weekdays[0]}<`) > o.indexOf(`>${T.weekdays[6]}<`));
    at("save is disabled until there is a name and a valid time range", { data: list([]), form }, (o) => /<button[^>]*type="submit"[^>]*disabled/.test(o) || /disabled=""[^>]*type="submit"/.test(o));
    at("a form error is shown", { data: list([]), form, formError: T.errors.invalid_timezone }, (o) => o.includes(T.errors.invalid_timezone));
    at("editing says so", { data: list([row()]), form: { ...form, id: row().id, title_en: "Sunday worship" } }, (o) => o.includes(T.form.editTitle));
    at("the remove dialog explains that records are kept", { data: list([row()]), removing: row() }, (o) => o.includes(T.actions.removeTitle) && o.includes(T.actions.removeConfirm) && o.includes("danger"));
    at("a notice is announced", { data: list([]), notice: T.notices.added }, (o) => o.includes(T.notices.added));
  }
}

// ---------------------------------------------------------------- 4. the public card, rendered for the server
{
  const Card = component("components/church/site/ChurchServicesCard.tsx");
  const countdownText = component("components/church/site/ChurchServicesCard.tsx", "countdownText");
  const svc = (o = {}) => ({ id: "00000000-0000-4000-8000-000000000001", weekday: 0, start_time: "09:00", end_time: "12:00", timezone: "Africa/Douala", is_enabled: true, title_en: "Sunday worship", title_fr: "Culte du dimanche", description_en: null, description_fr: null, location: null, ...o });
  const props = (lang, services) => ({ t: translations[lang], locale: lang, services, ...cardTheme, surface: "#fff" });
  for (const lang of ["en", "fr"]) {
    const T = translations[lang].churchSchedule;
    const out = html(Card, props(lang, [svc({ id: "00000000-0000-4000-8000-000000000002", weekday: 2, start_time: "17:30", end_time: "21:00", title_en: "Tuesday prayer", title_fr: "Prière du mardi" }), svc()]), lang);
    check(`${lang}: the server render is the plain weekly timetable (Monday first, Sunday last), no dates or countdowns`, out.includes(T.public.title) && out.indexOf(T.weekdays[2]) < out.indexOf(T.weekdays[0]) && out.includes("17:30 - 21:00") && out.includes("09:00 - 12:00") && !out.includes(T.public.live) && !out.includes(T.public.upcoming), out.slice(0, 400));
    check(`${lang}: names come out in the visitor's language`, out.includes(lang === "fr" ? "Prière du mardi" : "Tuesday prayer") && out.includes(lang === "fr" ? "Culte du dimanche" : "Sunday worship"));
    check(`${lang}: a labelled section with a heading`, /<section[^>]*aria-labelledby="church-services-heading"/.test(out) && /<h2 id="church-services-heading"/.test(out));
    check(`${lang}: with no services nothing is drawn`, html(Card, props(lang, []), lang) === "");
  }
  check("a service named in one language shows that name to a visitor of the other", html(Card, props("en", [svc({ title_en: null })]), "en").includes("Culte du dimanche"));
  const c = translations.en.churchSchedule.public, f = translations.fr.churchSchedule.public;
  check("countdown wording: days+hours, hours+minutes, minutes", countdownText(((2 * 24 + 3) * 60 + 10) * 60000, c) === "2 d 3 h" && countdownText((3 * 60 + 10) * 60000, c) === "3 h 10 min" && countdownText(12 * 60000, c) === "12 min" && countdownText(((2 * 24 + 3) * 60 + 10) * 60000, f) === "2 j 3 h");
}

// ---------------------------------------------------------------- 5. additive wiring, exclusive to churches
{
  const site = noComments(read("src/components/church/site/ChurchSiteView.tsx"));
  check("the church site shows the card from the loaded extras, only when there are services", /\(churchPublic\.services \?\? \[\]\)\.length > 0/.test(site) && /<ChurchServicesCard /.test(site));
  const view = noComments(read("src/components/ProfileView.tsx"));
  check("only the church template renders it (ProfileView is unchanged and other categories never import it)", !/ChurchServicesCard|church_service_schedule/.test(view));
  const loader = noComments(read("src/lib/church/public/index.ts"));
  check("the public loader adds the services and stays fail-safe", /loadPublicServices\(supabase, profileId\)/.test(loader) && /catch \{\s*return EMPTY_CHURCH_PUBLIC/.test(loader));
  const pagesrc = noComments(read("src/app/[username]/page.tsx"));
  check("the public page still loads church extras only for the church category", /profileHasCategory\(profile, "church_ministries"\) \? loadChurchPublic/.test(pagesrc));
  const events = noComments(read("src/app/dashboard/church/events/page.tsx"));
  check("the events dashboard page gets the schedule above the events and keeps its permission gate", /<ServiceSchedule \/>[\s\S]*<EventsList caps=\{caps\} \/>/.test(events) && /!caps\.viewEvents\) return <NoAccess/.test(events));
  const modules = read("src/lib/church/modules.ts");
  check("no new workspace section or permission was invented (events permissions are reused)", !/services/i.test(modules) && !/church\.services/.test(read("src/lib/church/permissions.ts")));
  for (const f of ["src/app/api/church/services/route.ts", "src/app/api/church/services/[id]/route.ts"]) check(`${f} goes through the shared church route kit`, /churchRoute\(/.test(read(f)) && /force-dynamic/.test(read(f)));
  check("the schedule handlers never use a service-role client", !/createAdminClient|service_role/.test(noComments(read("src/lib/church/schedule/handlers.ts"))));
  check("the permission to write is events.publish, reading events.view (matches the database policies)", /caps\.viewEvents/.test(H ? read("src/lib/church/schedule/handlers.ts") : "") && /caps\.publishEvents/.test(read("src/lib/church/schedule/handlers.ts")));
  check("the migration is proposed only: it is not referenced by any runtime code path that applies SQL", !fs.readdirSync(path.join(SRC, "..", "scripts")).some((n) => /apply|migrate/i.test(n)));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
