// Churches & Ministries Phase 4: the Events and Announcements screens and the PUBLIC cards, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for `churchEvents` and `churchWorkspace`, and a sentence in BOTH languages for every server code the routes can send;
//   * no hard-coded user-facing text, no browser storage, no markup injection, accessibility basics, the confirmation and one-save-button rules, in the screens' source;
//   * the public helpers (language fallback, cleaning, the fail-safe loaders) and the real cards rendered in both languages;
//   * the real screens rendered in both languages, and the real ProfileView: the cards appear only on a church page that has published content, and nowhere else.
// The dialogs and live data flows are exercised in a real browser during QA (they need a DOM); the data rules behind them are covered by ministryEvents*.test.mjs.
//   Run:  node scripts/tests/ministryEventsUi.test.mjs
import fs from "fs";
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PE = jiti(path.join(SRC, "lib/church/public/events.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));

// ---------------------------------------------------------------- 1. dictionary parity and error coverage
{
  for (const ns of ["churchEvents", "churchWorkspace"]) {
    const out = walkDictionary(translations.en[ns], translations.fr[ns], ns);
    check(`${ns}: EN and FR have exactly the same keys, types and function arity`, out.shape.length === 0, out.shape.join("; "));
    check(`${ns}: no empty text in either language`, out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
    const same = out.strings.filter(([, a, b]) => a === b && a.length > 6).map(([k]) => k);
    check(`${ns}: French is a translation, not a copy`, same.length <= 4, same.join(", "));
    for (const [key, a, b] of out.fns) {
      const args = sampleArgs(key, a);
      check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
    }
  }
  const e = translations.en.churchEvents, f = translations.fr.churchEvents;
  check("plurals", e.events.list.count(1) === "1 event" && e.events.list.count(2) === "2 events" && f.events.list.count(1) === "1 événement" && f.events.list.count(2) === "2 événements" && e.announcements.list.count(1) === "1 announcement" && f.announcements.list.count(1) === "1 annonce" && f.announcements.list.count(3) === "3 annonces");
  check("French uses the right agreement for each entity (masculine event, feminine announcement)", /cet événement/.test(f.events.editor.publishTitle) && /cette annonce/.test(f.announcements.editor.publishTitle) && /Dépublier cet événement/.test(f.events.editor.unpublishTitle) && /Dépublier cette annonce/.test(f.announcements.editor.unpublishTitle));
  // the entity text blocks have the same shape as the shared contract
  const LT = ["subtitle", "list", "editor", "fields"];
  check("each entity block carries exactly what the shared screens need", ["events", "announcements"].every((k) => LT.every((x) => x in e[k])));
  // every code the routes can send has a sentence in both languages
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  const engine = read("src/lib/church/lifecycle/engine.ts"), validation = read("src/lib/church/lifecycle/validation.ts"), events = read("src/lib/church/lifecycle/events.ts"), contentValidation = read("src/lib/church/content/validation.ts"), routeKit = read("src/lib/church/routeKit.ts");
  grab(engine, /fail\(\d{3}, "([a-z_]+)"/g);
  grab(engine, /code: "([a-z_]+)"/g);
  grab(validation, /code: "([a-z_]+)"/g);
  grab(events, /code: "([a-z_]+)"/g);
  grab(events, /publishBlockedCode: "([a-z_]+)"/g);
  grab(contentValidation, /(?:code: |bad\()"([a-z_]+)"/g);
  grab(routeKit, /error: "([a-z_]+)"/g);
  for (const field of ["event_date", "expires_on"]) codes.add("invalid_" + field);
  for (const m of read("src/lib/church/errors.ts").matchAll(/ministry_[a-z_]+\/, \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of read("src/lib/church/errors.ts").matchAll(/ministry_[a-z_]+: \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  codes.add("invalid_page"); codes.add("invalid_view"); codes.add("event_has_attendance");
  for (const c of [...codes]) if (c.endsWith("_")) codes.delete(c); // "invalid_" + field is expanded above
  const missing = [...codes].filter((c) => ET.churchErrorText(translations.en, c) === translations.en.churchPeople.errors.generic && c !== "generic" || ET.churchErrorText(translations.fr, c) === translations.fr.churchPeople.errors.generic && c !== "generic");
  check("every code the Phase 4 routes can send has its own sentence in English AND French", missing.length === 0, missing.join(", "));
  check("no error sentence leaks internals", [...Object.values(e.errors), ...Object.values(f.errors)].every((s) => !/ministry_|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.events|42501/i.test(s)));
  check("churchErrorText: own code, then shared code, then generic; never a raw code", ET.churchErrorText(translations.fr, "invalid_online_url") === f.errors.invalid_online_url && ET.churchErrorText(translations.en, "forbidden") === translations.en.churchPeople.errors.forbidden && ET.churchErrorText(translations.en, "some_new_code") === translations.en.churchPeople.errors.generic);
  check("restricted-section sentences exist for every new section in both languages", ["events", "bible", "attendance", "music", "store"].every((k) => translations.en.churchWorkspace.restricted[k].length > 10 && translations.fr.churchWorkspace.restricted[k].length > 10));
}

// ---------------------------------------------------------------- 2. source rules for the screens and the cards
{
  const files = [
    ...fs.readdirSync(path.join(SRC, "components/church/lifecycle")).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(SRC, "components/church/lifecycle", f)),
    ...fs.readdirSync(path.join(SRC, "components/church/events")).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(SRC, "components/church/events", f)),
    path.join(SRC, "components/church/ChurchEventsCards.tsx"),
  ];
  check("the screens exist", files.length >= 8, files.map((f) => path.basename(f)).join(","));
  for (const f of files) {
    const name = path.basename(f);
    const problems = sourceProblems(f);
    check(`${name}: no hard-coded text, storage, markup injection, service client, untyped button or unnamed field`, problems.length === 0, problems.join(" || "));
    const src = noComments(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
    check(`${name}: no foundation (opt-in) design tokens on this existing screen family`, !/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b/.test(src));
  }
  const editor = noComments(read("src/components/church/lifecycle/LifecycleEditor.tsx"));
  check("exactly ONE save button, bound to the single save() (no hidden autosave, no second Save)", (editor.match(/onClick=\{save\}/g) || []).length === 1 && !/setInterval|setTimeout\([^)]*save/.test(editor));
  check("publish, unpublish and delete are each confirmed, and nothing publishes without a ConfirmDialog", (editor.match(/<ConfirmDialog/g) || []).length === 3 && /act\("publish"\)/.test(editor) && /act\("unpublish"\)/.test(editor));
  check("publish and unpublish are disabled while there are unsaved changes (what was reviewed is what goes live)", /disabled=\{busy \|\| dirty \|\| !anyReady\}/.test(editor) && /disabled=\{busy \|\| dirty\}/.test(editor));
  check("delete sends the loaded updated_at and reports a stale one", /method: "DELETE"/.test(editor) && /\?expected_updated_at=\$\{encodeURIComponent\(meta\.updated_at\)\}/.test(editor) && /remove = async[\s\S]*?code === "stale"/.test(editor));
  check("edit sends only what changed plus the loaded updated_at; publish and unpublish send the confirmation and the loaded updated_at", /expected_updated_at: meta\.updated_at/.test(editor) && /confirm: true, expected_updated_at: meta\.updated_at/.test(editor) && /filter\(\(\[k, v\]\) => v !== saved\[k\]\)/.test(editor));
  check("unsaved changes are protected (beforeunload and a leave prompt)", /beforeunload/.test(editor) && /window\.confirm\(c\.leaveWarning\)/.test(editor));
  check("a stale save is explained and offers a reload, not a silent overwrite", /setStale\(true\)/.test(editor) && /c\.reload/.test(editor));
  check("language tabs are a real tablist with selected state and panel", /role="tablist"/.test(editor) && /role="tab"/.test(editor) && /aria-selected/.test(editor) && /role="tabpanel"/.test(editor));
  check("the editor never sends the status or a church id", !/status:|profile_id|profileId/.test(editor.replace(/status: "draft" \| "published"/g, "").replace(/status: item\.status/g, "")));
  const list = noComments(read("src/components/church/lifecycle/LifecycleList.tsx"));
  check("the list is server-paged and filtered by view", /Pager/.test(list) && /view=\$\{view\}&page=\$\{page\}/.test(list));
  check("controls are touch-sized (44px) on the list rows and the editor", /min-h-\[72px\]/.test(list) && /min-h-\[44px\]/.test(editor));
  const cards = noComments(read("src/components/church/ChurchEventsCards.tsx"));
  check("the public cards render text as text (whitespace-pre-line), never as markup", /whitespace-pre-line/.test(cards) && !/dangerouslySetInnerHTML/.test(cards));
  check("the public cards have labelled sections, real headings and real <time> elements", (cards.match(/aria-labelledby/g) || []).length >= 1 && /<H id=\{headingId\}/.test(cards) && /headingLevel \?\? "h2"/.test(cards) && /<h3 /.test(cards) && /<time\b/.test(cards));
  check("long text wraps instead of overflowing on a phone", /\[overflow-wrap:anywhere\]/.test(cards));
  check("the one outbound link opens safely (noopener noreferrer) and only for a live, https event", /target="_blank"/.test(cards) && /rel="noopener noreferrer"/.test(cards) && /e\.online_url && !e\.is_cancelled/.test(cards));
  const shell = noComments(read("src/components/church/people/ChurchShell.tsx"));
  // The church redesign replaced the sideways-scrolling tab bar: every section is reachable without a horizontal scroll (a sidebar on a wide screen, an in-place grid on a phone).
  check("the section navigation never scrolls sideways and each entry is touch-sized", !/overflow-x-auto/.test(shell) && /min-h-\[44px\]/.test(shell));
  // the sections and who may open each one now live in ONE list, src/lib/church/modules.ts (the shell, the home grid and the index all read it)
  const mods = noComments(read("src/lib/church/modules.ts"));
  check("the new tabs appear only for people allowed to open them", /key: "events"[^}]*c\.viewEvents/.test(mods) && /key: "bible"[^}]*c\.viewBible/.test(mods) && /key: "attendance"[^}]*c\.viewAttendance/.test(mods) && /key: "music"[^}]*c\.manageMusic/.test(mods) && /key: "store"[^}]*isOwner/.test(mods) && /accessibleChurchModules/.test(shell));
}

// ---------------------------------------------------------------- 3. the public helpers
{
  const row = (n, on, o = {}) => ({ id: uid(n), event_date: on, status: "published", title_en: `T${n}`, ...o });
  check("events: soonest first, today included, no past, no draft, no untitled, no malformed row", PE.shapePublicEvents([row(1, "2026-10-25"), row(2, "2026-10-22"), row(3, "2026-10-21"), row(4, "2026-10-23", { status: "draft" }), row(5, "2026-10-24", { title_en: null }), row(6, "bad"), { id: "x", event_date: "2026-10-24", title_en: "T" }, null, "junk", row(7, "2026-10-26", { title_en: null, title_fr: "Culte" })], "2026-10-22").map((e) => e.id).join() === [2, 1, 7].map(uid).join());
  check("events: an unsafe link is dropped, the event stays", (() => { const r = PE.shapePublicEvents([row(1, "2026-10-25", { online_url: "javascript:alert(1)" }), row(2, "2026-10-25", { online_url: "http://x.org/live" }), row(3, "2026-10-25", { online_url: "https://x.org/live" })], "2026-10-22"); return r.length === 3 && r[0].online_url === null && r[1].online_url === null && r[2].online_url === "https://x.org/live"; })());
  check("events: times are cleaned to HH:MM", PE.shapePublicEvents([row(1, "2026-10-25", { start_time: "09:30:00", end_time: "nonsense" })], "2026-10-22")[0].start_time === "09:30" && PE.shapePublicEvents([row(1, "2026-10-25", { end_time: "nonsense" })], "2026-10-22")[0].end_time === null);
  check("events: text is capped and at most eight are returned", PE.shapePublicEvents([row(1, "2026-10-25", { title_en: "x".repeat(500) })], "2026-10-22")[0].title_en.length === 120 && PE.shapePublicEvents(Array.from({ length: 12 }, (_, i) => row(i + 1, `2026-11-${String(i + 1).padStart(2, "0")}`)), "2026-10-22").length === 8);
  check("events: no audit column can survive", !JSON.stringify(PE.shapePublicEvents([{ ...row(1, "2026-10-25"), created_by: "u", updated_by: "u", published_by: "u", profile_id: "p" }], "2026-10-22")).match(/created_by|updated_by|published_by|profile_id/));
  check("events: nothing from a non-array", PE.shapePublicEvents(null).length === 0 && PE.shapePublicEvents({}).length === 0);
  const ann = (n, o = {}) => ({ id: uid(n), status: "published", title_en: `A${n}`, body_en: `B${n}`, expires_on: null, ...o });
  check("announcements: kept in arrival order, expired dropped, today's last day kept, drafts and incomplete dropped", PE.shapePublicAnnouncements([ann(1), ann(2, { expires_on: "2026-10-22" }), ann(3, { expires_on: "2026-10-21" }), ann(4, { status: "draft" }), ann(5, { body_en: null }), ann(6, { expires_on: "garbage" }), ann(7, { title_en: null, body_en: null, title_fr: "Avis", body_fr: "Corps" })], "2026-10-22").map((a) => a.id).join() === [1, 2, 7].map(uid).join());
  check("announcements: at most five", PE.shapePublicAnnouncements(Array.from({ length: 9 }, (_, i) => ann(i + 1)), "2026-10-22").length === 5);
  check("language: own when readable, else the other flagged, else nothing", (() => { const e = PE.shapePublicEvents([row(1, "2026-10-25")], "2026-10-22")[0]; return PE.resolveLanguage((l) => PE.isEventReadable(e, l), "en").fallback === false && PE.resolveLanguage((l) => PE.isEventReadable(e, l), "fr").lang === "en" && PE.resolveLanguage((l) => PE.isEventReadable(e, l), "fr").fallback === true && PE.resolveLanguage(() => false, "en") === null; })());
  const calls = [];
  const client = (result) => ({ from(t) { calls.push(["from", t]); const q = { select(c) { calls.push(["select", c]); return q; }, eq(c, v) { calls.push(["eq", c, v]); return q; }, gte(c, v) { calls.push(["gte", c, v]); return q; }, is(c, v) { calls.push(["is", c, v]); return q; }, or(s) { calls.push(["or", s]); return q; }, order(c, o) { calls.push(["order", c, o]); return q; }, limit(n) { calls.push(["limit", n]); return q; }, then(res, rej) { return Promise.resolve().then(result).then(res, rej); } }; return q; } });
  const ok = await PE.loadPublicEvents(client(() => ({ data: [row(1, "2026-10-25")], error: null })), uid(99), Date.parse("2026-10-22T10:00:00Z"));
  check("event loader: returns the shaped events", ok.length === 1 && ok[0].title_en === "T1");
  check("event loader: asks only for this church's published events from today on, soonest first, limited", calls.some((c) => c[0] === "from" && c[1] === "ministry_events") && calls.some((c) => c[0] === "eq" && c[1] === "profile_id" && c[2] === uid(99)) && calls.some((c) => c[0] === "eq" && c[1] === "status" && c[2] === "published") && calls.some((c) => c[0] === "gte" && c[1] === "event_date" && c[2] === "2026-10-22") && calls.some((c) => c[0] === "limit" && c[1] === 8));
  check("event loader: selects only the public columns", !/created_by|updated_by|published_by|\*/.test(calls.find((c) => c[0] === "select")[1]));
  calls.length = 0;
  await PE.loadPublicAnnouncements(client(() => ({ data: [], error: null })), uid(99), Date.parse("2026-10-22T10:00:00Z"));
  check("announcement loader: only church-wide notices (a notice for one group is left out)", calls.some((c) => c[0] === "is" && c[1] === "public_group_id" && c[2] === null));
  check("announcement loader: published, not past its last day, newest first, limited, public columns only", calls.some((c) => c[0] === "from" && c[1] === "ministry_announcements") && calls.some((c) => c[0] === "or" && /expires_on\.gte\.2026-10-22/.test(c[1])) && calls.some((c) => c[0] === "order" && c[1] === "published_at" && c[2].ascending === false) && !/created_by|updated_by|published_by|\*/.test(calls.find((c) => c[0] === "select")[1]));
  for (const loader of [PE.loadPublicEvents, PE.loadPublicAnnouncements]) {
    check(`${loader.name}: FAIL-SAFE on a database error, on a missing table and on a thrown error`, (await loader(client(() => ({ data: null, error: { code: "42P01", message: "relation does not exist" } })), uid(99))).length === 0 && (await loader(client(() => { throw new Error("boom"); }), uid(99))).length === 0 && (await loader({ from() { throw new Error("boom"); } }, uid(99))).length === 0);
  }
  const all = await jiti(path.join(SRC, "lib/church/public/index.ts")).loadChurchPublic({ from() { throw new Error("down"); } }, uid(99));
  check("the aggregate loader never throws: an empty page when the database is down", all.events.length === 0 && all.announcements.length === 0);
}

// ---------------------------------------------------------------- 4. the real cards and screens, then the real ProfileView
{
  const Events = component("components/church/ChurchEventsCards.tsx", "ChurchEventsCard");
  const Ann = component("components/church/ChurchEventsCards.tsx", "ChurchAnnouncementsCard");
  const ev = (n, o = {}) => ({ id: uid(n), event_date: "2026-10-25", start_time: "09:00", end_time: "11:30", title_en: "Sunday service", title_fr: "Culte du dimanche", description_en: "All welcome.\n\nBring a friend.", description_fr: "Tous sont les bienvenus.", venue: "Main hall", address: "Bonanjo, Douala", online_url: "https://live.example.org/watch", is_cancelled: false, ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const c = t.churchEvents.public;
    const h = html(Events, { t, locale: lang, events: [ev(1)], ...cardTheme }, lang);
    check(`events card (${lang}): heading, title, time range, venue and address, description, in ${lang}`, h.includes(c.eventsHeading) && h.includes(lang === "en" ? "Sunday service" : "Culte du dimanche") && h.includes(c.range("09:00", "11:30")) && h.includes("Main hall · Bonanjo, Douala") && h.includes(lang === "en" ? "All welcome." : "Tous sont les bienvenus."), h.slice(0, 400));
    check(`events card (${lang}): the date is written in ${lang}`, lang === "en" ? /Sunday,? 25 October 2026/.test(h) : /dimanche 25 octobre 2026/.test(h), h.match(/<time[^>]*>[^<]*/)?.[0]);
    check(`events card (${lang}): a labelled section, a real h2 and h3, a <time> element, the online link opens safely`, /<section aria-labelledby="church-events-heading"/.test(h) && /<h2 id="church-events-heading"/.test(h) && /<h3 /.test(h) && /<time dateTime="2026-10-25"|<time datetime="2026-10-25"/.test(h) && /<a href="https:\/\/live\.example\.org\/watch" target="_blank" rel="noopener noreferrer"/.test(h) && h.includes(c.online));
    check(`events card (${lang}): no text of the other language, no fallback note`, !h.includes(lang === "en" ? "Culte du dimanche" : "Sunday service") && !h.includes(c.shownIn(c.languageName.en)) && !h.includes(c.shownIn(c.languageName.fr)));
    const cancelled = html(Events, { t, locale: lang, events: [ev(2, { is_cancelled: true })], ...cardTheme }, lang);
    check(`events card (${lang}): a cancelled event says so and offers no online link`, cancelled.includes(c.cancelled) && !cancelled.includes("live.example.org"));
    const a = html(Ann, { t, locale: lang, announcements: [{ id: uid(5), title_en: "Youth retreat", title_fr: "Retraite des jeunes", body_en: "Register by Friday.", body_fr: "Inscrivez-vous avant vendredi.", expires_on: "2026-10-30" }], ...cardTheme }, lang);
    check(`announcements card (${lang}): heading, title, message, last day, in ${lang}`, a.includes(c.announcementsHeading) && a.includes(lang === "en" ? "Youth retreat" : "Retraite des jeunes") && a.includes(lang === "en" ? "Register by Friday." : "Inscrivez-vous avant vendredi.") && a.includes(lang === "en" ? "30 October 2026" : "30 octobre 2026"));
  }
  const fr = html(Events, { t: translations.fr, locale: "fr", events: [ev(3, { title_fr: null, description_fr: null, title_en: "Only English" })], ...cardTheme }, "fr");
  check("fallback (fr visitor, English-only event): the English text is shown with a clear note in French", fr.includes("Only English") && fr.includes(translations.fr.churchEvents.public.shownIn("anglais")));
  const en = html(Ann, { t: translations.en, locale: "en", announcements: [{ id: uid(6), title_en: null, title_fr: "Avis", body_en: null, body_fr: "Corps", expires_on: null }], ...cardTheme }, "en");
  check("fallback (en visitor, French-only announcement): the French text with a note in English", en.includes("Avis") && en.includes(translations.en.churchEvents.public.shownIn("French")));
  check("nothing readable renders nothing at all", html(Events, { t: translations.en, locale: "en", events: [], ...cardTheme }, "en") === "" && html(Events, { t: translations.en, locale: "en", events: [ev(4, { title_en: null, title_fr: null })], ...cardTheme }, "en") === "" && html(Ann, { t: translations.en, locale: "en", announcements: [{ id: uid(7), title_en: "Title only", title_fr: null, body_en: null, body_fr: null, expires_on: null }], ...cardTheme }, "en") === "");
  const evil = html(Events, { t: translations.en, locale: "en", events: [ev(5, { title_en: "<img src=x onerror=alert(1)>", description_en: "<script>alert(1)</script>", venue: "<b>bold</b>" })], ...cardTheme }, "en");
  check("markup typed into any field is escaped, never injected", !/<img src=x|<script>alert|<b>bold/.test(evil) && evil.includes("&lt;"));

  // the real screens render in both languages (first state: the form, or the loading skeleton)
  const S = (name) => component("components/church/events/EventsScreens.tsx", name);
  const caps = jiti(path.join(SRC, "lib/church/permissions.ts")).churchCapabilities(["church.events.publish"]);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const form = html(S("EventEditor"), { caps }, lang);
    check(`event editor (${lang}): the new-event form with its labels, tabs and both buttons`, form.includes(t.churchEvents.events.editor.newTitle) && form.includes(t.churchEvents.events.fields.event_date.label) && form.includes(t.churchEvents.events.fields.title.label) && form.includes(t.churchEvents.events.editor.saveDraft) && form.includes(t.churchEvents.events.editor.preview) && /role="tablist"/.test(form) && /type="date"/.test(form) && /type="time"/.test(form) && /type="url"/.test(form) && /type="checkbox"/.test(form), form.slice(0, 300));
    check(`event editor (${lang}): no publish or delete button before anything is saved`, !form.includes(`>${t.churchEvents.events.editor.delete}<`) && !form.includes(`>${t.churchEvents.events.editor.unpublish}<`));
    const aform = html(S("AnnouncementEditor"), { caps }, lang);
    check(`announcement editor (${lang}): the new-announcement form`, aform.includes(t.churchEvents.announcements.editor.newTitle) && aform.includes(t.churchEvents.announcements.fields.body.label) && aform.includes(t.churchEvents.announcements.fields.expires_on.label) && !/type="time"/.test(aform));
    const list = html(S("EventsList"), { caps }, lang);
    check(`events list (${lang}): the intro, the view filter and the add button`, list.includes(t.churchEvents.events.subtitle) && list.includes(t.churchEvents.events.list.views.upcoming) && list.includes(t.churchEvents.events.list.add));
    const noWrite = html(S("EventsList"), { caps: jiti(path.join(SRC, "lib/church/permissions.ts")).churchCapabilities(["church.events.view"]) }, lang);
    check(`events list (${lang}): a view-only person gets no add button`, !noWrite.includes(t.churchEvents.events.list.add));
  }

  // the real ProfileView
  let PV = null, loadErr = "";
  try { PV = component("components/ProfileView.tsx"); } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 500));
  if (PV) {
    const opts = (category, lang, extra = {}) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false, ...extra });
    const annRow = { id: uid(20), title_en: "Youth retreat", title_fr: "Retraite des jeunes", body_en: "Register by Friday.", body_fr: "Inscrivez-vous avant vendredi.", expires_on: null };
    const extras = { events: [ev(30)], announcements: [annRow], programs: [], music: [] };
    const page = (category, lang, churchPublic) => html(PV, { profile: buildPreviewProfile(opts(category, lang)), pageViewEventId: "preview", preview: false, churchPublic }, lang);
    const ch = page("church_ministries", "en", extras);
    check("church page with published content: both cards appear, after 'Visit us'", ch.includes("church-events-heading") && ch.includes("church-announcements-heading") && ch.indexOf("church-visit-heading") > -1 && ch.indexOf("church-visit-heading") < ch.indexOf("church-announcements-heading") && ch.indexOf("church-announcements-heading") < ch.indexOf("church-events-heading"));
    const chFr = page("church_ministries", "fr", extras);
    check("church page (fr): the French cards", chFr.includes("Événements à venir") && chFr.includes("Culte du dimanche") && chFr.includes("Retraite des jeunes"));
    check("church page with nothing published (default prop, or empty lists): no card, no empty heading, as before", !page("church_ministries", "en", undefined).includes("church-events-heading") && !page("church_ministries", "en", { events: [], announcements: [], programs: [], music: [] }).includes("church-announcements-heading"));
    const leaks = [];
    for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-events-heading|church-announcements-heading/.test(page(c, lang, extras))) leaks.push(`${c}/${lang}`);
    check("no other category's page shows the cards even if rows were passed (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    const preview = html(PV, { profile: buildPreviewProfile(opts("church_ministries", "en")), pageViewEventId: "preview", preview: true }, "en");
    check("the editor's live preview (nothing passed) shows no cards", !preview.includes("church-events-heading") && !preview.includes("church-announcements-heading"));
  }
  const pageSrc = read("src/app/[username]/page.tsx");
  check("the public route loads the church modules only for a church profile, in the existing parallel stage, and fails safe", /profileHasCategory\(profile, "church_ministries"\) \? loadChurchPublic\(supabase, profile\.id\) : Promise\.resolve\(EMPTY_CHURCH_PUBLIC\)/.test(pageSrc) && /churchPublic=\{churchPublic\}/.test(pageSrc));
  check("the existing profile query is unchanged (no ministry_* embed)", /`\*, social_links\(\*\), links\(\*\), products\(\*\), profile_phone_numbers\(\*\), tracks\(\*\), events\(\*, event_ticket_types\(\*\)\), menu_items\(\*\), music_releases\(\*\), booking_services\(\*\)`/.test(pageSrc) && !/ministry_/.test(pageSrc));
  const view = read("src/components/ProfileView.tsx");
  const site = read("src/components/church/site/ChurchSiteView.tsx");
  check("ProfileView: the cards are gated on the church flag (the church template) and on having content", /isChurch \? \(\s*<ChurchSiteView/.test(view) && /\{churchPublic\.announcements\.length > 0 && <ChurchAnnouncementsCard/.test(site) && /\{churchPublic\.events\.length > 0 && <ChurchEventsCard/.test(site) && /churchPublic = EMPTY_CHURCH_PUBLIC,/.test(view));
  check("the section order of every category is unchanged (the cards are drawn beside 'Visit us', not as a section)", /church_ministries: \["events", "catalog", "links", "about"\],/.test(read("src/lib/sectionOrder.ts")));
  check("the ticketing events section stays hidden on a church page (hasTicketing is music-only)", /Church pages have no ticketing yet/.test(view));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
