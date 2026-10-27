// Churches & Ministries Phase 5: the Bible programme screens (church side), the PUBLIC card and "My Bible Journey" (visitor side), checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for `churchBible`, and a sentence in BOTH languages for every server code the church and visitor routes can send;
//   * no hard-coded user-facing text, no browser storage, no markup injection, accessibility basics, the confirmation rules, in the screens' source; the church screens call only /api/church/bible and the
//     visitor screens only /api/customer/bible;
//   * the public helpers (language fallback, cleaning, the fail-safe loaders) and the real components rendered in every state, in both languages;
//   * the real ProfileView: the programme card appears only on a church page with a published programme, and nowhere else.
// The live data flows and dialogs are exercised in a real browser during QA (they need a DOM); the data rules behind them are covered by bibleProgramsDb / bibleProgramsApi / bibleJourneyApi.
//   Run:  node scripts/tests/bibleUi.test.mjs
import fs from "fs";
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, cardTheme, React, overrideExport } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PB = jiti(path.join(SRC, "lib/church/public/bible.ts"));
const PJ = jiti(path.join(SRC, "lib/church/bible/publicJourney.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));
overrideExport("components/church/people/shared.tsx", "ConfirmDialog", (p) => React.createElement("div", { "data-confirm": "1" }, `[${p.title}|${p.body}|${p.confirmLabel}|${p.danger ? "danger" : "normal"}]`));

// ---------------------------------------------------------------- 1. dictionary parity and error coverage
{
  const out = walkDictionary(translations.en.churchBible, translations.fr.churchBible, "churchBible");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 6).map(([k]) => k);
  check("French is a translation, not a copy", same.length <= 3, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? [3, 10] : sampleArgs(key, a);
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  const e = translations.en.churchBible, f = translations.fr.churchBible;
  check("plurals", e.programs.list.count(1) === "1 programme" && e.programs.list.count(2) === "2 programmes" && f.programs.list.count(1) === "1 programme" && e.programs.list.sessions(1) === "1 day" && f.programs.list.sessions(2) === "2 jours" && e.stats.enrolled(0).includes("Nobody") && f.stats.enrolled(1).startsWith("1 personne ") && f.stats.enrolled(3) === "3 personnes suivent ce programme.");
  // the programme texts satisfy the shared contract of the lifecycle screens
  check("the programme block carries exactly what the shared screens need", ["subtitle", "list", "editor", "fields"].every((k) => k in e.programs) && ["title", "description"].every((k) => k in e.programs.fields));
  // every code the church routes AND the visitor routes can send has its own sentence in both languages
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  for (const file of ["src/lib/church/bible/handlers.ts", "src/lib/church/bible/journey.ts"]) {
    const text = read(file);
    grab(text, /fail\(\d{3}, "([a-z_]+)"/g);
    grab(text, /code: "([a-z_]+)"/g);
  }
  grab(read("src/lib/church/bible/customerRoute.ts"), /error: "([a-z_]+)"/g);
  grab(read("src/lib/church/routeKit.ts"), /error: "([a-z_]+)"/g);
  for (const m of read("src/lib/church/errors.ts").matchAll(/bible_[a-z_]+: \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of read("src/lib/church/errors.ts").matchAll(/bible_[a-z_]+[^\n]*code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const c of ["invalid_title", "invalid_description", "needs_title", "confirmation_required", "publish_required", "stale", "already_published", "not_published", "invalid_view", "invalid_page"]) codes.add(c);
  const generic = (loc) => translations[loc].churchPeople.errors.generic;
  const allowedGeneric = new Set(["invalid", "conflict", "in_use", "server_error", "not_available", "try_again", "forbidden", "not_found", "not_signed_in", "invalid_body", "unexpected_field", "empty_update", "invalid_date"]);
  const missing = [...codes].filter((c) => !allowedGeneric.has(c) && (ET.churchErrorText(translations.en, c) === generic("en") || ET.churchErrorText(translations.fr, c) === generic("fr")));
  check("every code the Bible routes can send has its own sentence in English AND French (or the shared one)", missing.length === 0, missing.join(", "));
  check("no error sentence leaks internals", [...Object.values(e.errors), ...Object.values(f.errors)].every((s) => !/bible_|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.bible|42501|customer|enrol/i.test(s)));
  check("the privacy promise is stated in both languages (public card, visitor page, staff counts)", /private/i.test(e.public.privacy) && /privée/i.test(f.public.privacy) && /private/i.test(e.journey.privacy) && /privée/i.test(f.journey.privacy) && /never see who/i.test(e.stats.privacy) && /jamais qui/i.test(f.stats.privacy));
  check("no scripture text is promised or supplied: the help says only the reference is typed", /Ringo does not supply Bible text/.test(e.sessions.help) && /ne fournit pas de texte biblique/.test(f.sessions.help));
}

// ---------------------------------------------------------------- 2. source rules
{
  const dirs = ["components/church/bible", "components/church/bible/journey"];
  const files = [...dirs.flatMap((d) => fs.readdirSync(path.join(SRC, d)).filter((x) => /\.tsx?$/.test(x)).map((x) => path.join(SRC, d, x))), path.join(SRC, "components/church/ChurchBibleCard.tsx")];
  check("the screens exist", files.length >= 7, files.map((x) => path.basename(x)).join(","));
  for (const f of files) {
    const name = path.basename(f);
    const problems = sourceProblems(f);
    check(`${name}: no hard-coded text, storage, markup injection, service client, untyped button or unnamed field`, problems.length === 0, problems.join(" || "));
    const src = noComments(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
    check(`${name}: no foundation (opt-in) design tokens on this existing screen family`, !/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b/.test(src));
  }
  const staff = ["bible/SessionsPanel.tsx", "bible/BibleScreens.tsx", "bible/configs.tsx"].map((f) => noComments(read(`src/components/church/${f}`))).join("\n");
  check("the church screens call only the church API and never the visitor API or the private tables", /\/api\/church\/bible/.test(staff) && !/\/api\/customer|bible_enrollments|bible_session_progress|ringo_customers/.test(staff));
  const visitor = ["journey/JourneyView.tsx", "journey/JourneyList.tsx"].map((f) => noComments(read(`src/components/church/bible/${f}`))).join("\n");
  check("the visitor screens call only the visitor API and never a church route", /\/api\/customer\/bible/.test(visitor) && !/\/api\/church/.test(visitor));
  const panel = noComments(read("src/components/church/bible/SessionsPanel.tsx"));
  check("deleting a day is confirmed and carries the loaded updated_at; editing a day carries it too; ONE save button in the dialog", /<ConfirmDialog/.test(panel) && /\?expected_updated_at=\$\{encodeURIComponent\(deleting\.updated_at\)\}/.test(panel) && /expected_updated_at: session\.updated_at/.test(panel) && (panel.match(/onClick=\{save\}/g) || []).length === 1);
  check("moving a day uses the one-statement move route", /sessions\/\$\{s\.id\}\/move/.test(panel) && /direction/.test(panel));
  check("the icon-only buttons have accessible names and are touch-sized", /aria-label=\{label\}/.test(panel) && /min-h-\[44px\] min-w-\[44px\]/.test(panel));
  const body = noComments(read("src/components/church/bible/journey/JourneyView.tsx"));
  check("leaving a programme is confirmed (it erases the visitor's progress)", /<ConfirmDialog/.test(body) && /method: "DELETE"/.test(body));
  check("a tick is an accessible checkbox with a name, touch-sized, and flips at once with a rollback on failure", /role="checkbox"/.test(body) && /aria-checked=\{done\}/.test(body) && /min-h-\[44px\] min-w-\[44px\]/.test(body) && /setData\(before\)/.test(body));
  check("the progress is exposed as a labelled progressbar", /role="progressbar"/.test(body) && /aria-valuenow=\{data\.done\}/.test(body) && /aria-labelledby="journey-progress-label"/.test(body));
  check("the visitor view sends only the session and the done flag (never a visitor or a programme owner)", /body: \{ session_id: s\.id, done \}/.test(body) && !/customer_id|profile_id/.test(body));
  const card = noComments(read("src/components/church/ChurchBibleCard.tsx"));
  check("the card renders text as text, has a labelled section, a real heading and touch-sized links", /whitespace-pre-line/.test(card) && !/dangerouslySetInnerHTML/.test(card) && /aria-labelledby=\{headingId\}/.test(card) && /<H id=\{headingId\}/.test(card) && /headingLevel = "h2"/.test(card) && /min-h-\[44px\]/.test(card) && /\[overflow-wrap:anywhere\]/.test(card));
  check("the card links only to the programme's own page", /href=\{`\/my-ringo\/journey\/\$\{p\.id\}`\}/.test(card) && (card.replace(/<SeeMore [^>]*\/>/g, "").match(/href=/g) || []).length === 1 && /<SeeMore t=\{t\} href=\{seeMoreHref\}/.test(card));
  // the pages
  const listPage = noComments(read("src/app/my-ringo/journey/page.tsx"));
  const programPage = noComments(read("src/app/my-ringo/journey/[programId]/page.tsx"));
  check("the visitor pages use the visitor session helper that does NOT redirect, and the anonymous client only for public content", /getCustomerSession\(\)/.test(listPage) && /getCustomerSession\(\)/.test(programPage) && /createClient\(\)/.test(programPage) && !/createAdminClient|requireCustomer/.test(listPage + programPage));
  check("the visitor pages sit OUTSIDE the My Ringo app shell (a signed-out visitor can read a programme)", fs.existsSync(path.join(SRC, "app/my-ringo/journey/page.tsx")) && !fs.existsSync(path.join(SRC, "app/my-ringo/(app)/journey")));
  for (const f of ["dashboard/church/bible/page.tsx", "dashboard/church/bible/new/page.tsx", "dashboard/church/bible/[id]/page.tsx"]) {
    const page = noComments(read(`src/app/${f}`));
    check(`${f}: resolves the church actor on the server and shows NoAccess without the permission`, /resolveChurchActor\(\)/.test(page) && /NoAccess section="bible"/.test(page) && /caps\.(viewBible|manageBible)/.test(page) && /force-dynamic/.test(page));
  }
}

// ---------------------------------------------------------------- 3. the public helpers
{
  const row = (n, o = {}) => ({ id: uid(n), status: "published", title_en: `P${n}`, description_en: `D${n}`, ...o });
  const counts = new Map([[uid(1), 3], [uid(2), 1], [uid(3), 0], [uid(4), 2], [uid(5), 4]]);
  const shaped = PB.shapePublicPrograms([row(1), row(2), row(3), row(4, { status: "draft" }), row(5, { title_en: null }), row(6), { id: "x", title_en: "T" }, null, "junk", row(7, { title_en: null, title_fr: "Programme" })], counts);
  check("shaping: published, with at least one day and a readable title; a draft, an empty programme, an untitled one and a malformed row are dropped", shaped.map((p) => p.id).join() === [1, 2].map(uid).join(), shaped.map((p) => p.id.slice(-2)).join());
  check("shaping: the day count and the text are carried and capped", shaped[0].session_count === 3 && PB.shapePublicPrograms([row(1, { title_en: "x".repeat(500) })], counts)[0].title_en.length === 120);
  check("shaping: a French-only programme is kept", PB.shapePublicPrograms([row(8, { title_en: null, title_fr: "Seulement" })], { [uid(8)]: 2 })[0].title_fr === "Seulement");
  check("shaping: at most six, nothing from a non-array, no audit column or participant data can survive", PB.shapePublicPrograms(Array.from({ length: 9 }, (_, i) => row(i + 10)), Object.fromEntries(Array.from({ length: 9 }, (_, i) => [uid(i + 10), 1]))).length === 6 && PB.shapePublicPrograms(null).length === 0 && !JSON.stringify(PB.shapePublicPrograms([{ ...row(1), created_by: "u", profile_id: "p", enrolled: 5 }], counts)).match(/created_by|profile_id|enrolled/));
  const calls = [];
  const client = (programs, sessions) => ({ from(t) { calls.push(["from", t]); const q = { select(c) { calls.push(["select", t, c]); return q; }, eq(c, v) { calls.push(["eq", t, c, v]); return q; }, in(c, v) { calls.push(["in", t, c]); return q; }, order(c) { return q; }, limit() { return q; }, maybeSingle() { return q; }, then(res, rej) { return Promise.resolve(t === "bible_programs" ? programs() : sessions()).then(res, rej); } }; return q; } });
  const ok = await PB.loadPublicPrograms(client(() => ({ data: [row(1)], error: null }), () => ({ data: [{ program_id: uid(1) }, { program_id: uid(1) }], error: null })), uid(99));
  check("loader: returns the shaped programmes with their day counts", ok.length === 1 && ok[0].session_count === 2);
  check("loader: asks only for this church's published programmes and selects only public columns, never an enrolment", calls.some((c) => c[0] === "eq" && c[2] === "profile_id" && c[3] === uid(99)) && calls.some((c) => c[0] === "eq" && c[2] === "status" && c[3] === "published") && !calls.some((c) => c[0] === "from" && /enrol|progress|customer/.test(c[1])) && calls.filter((c) => c[0] === "select").every((c) => !/created_by|updated_by|published_by|\*/.test(c[2])));
  check("loader: FAIL-SAFE on a database error, on a missing table and on a thrown error", (await PB.loadPublicPrograms(client(() => ({ data: null, error: { code: "42P01" } }), () => ({ data: [], error: null })), uid(99))).length === 0 && (await PB.loadPublicPrograms(client(() => ({ data: [row(1)], error: null }), () => ({ data: null, error: { code: "42P01" } })), uid(99))).length === 0 && (await PB.loadPublicPrograms({ from() { throw new Error("boom"); } }, uid(99))).length === 0);
  // the signed-out programme page
  const jrn = (program, church, sessions) => ({ from(t) { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; }, then(res, rej) { return Promise.resolve(t === "bible_programs" ? program() : t === "profiles" ? church() : sessions()).then(res, rej); } }; return q; } });
  const prog = { id: uid(1), profile_id: uid(50), status: "published", title_en: "Psalms", title_fr: null, description_en: "About", description_fr: null };
  const j = await PJ.loadPublicJourney(jrn(() => ({ data: prog, error: null }), () => ({ data: { username: "grace", name: "Grace", published: true }, error: null }), () => ({ data: [{ id: uid(11), position: 1, title_en: "Day 1" }], error: null })), uid(1));
  check("signed-out page data: the programme, the church name and page, the days; nothing private; no church id", !!j && j.program.title_en === "Psalms" && j.church.username === "grace" && j.sessions.length === 1 && j.enrollment === null && j.completed.length === 0 && j.total === 1 && j.done === 0 && !JSON.stringify(j).includes(uid(50)));
  check("signed-out page data: null for a bad id, an unpublished church page, a draft programme and any error", (await PJ.loadPublicJourney(jrn(() => ({ data: prog, error: null }), () => ({ data: { username: "g", name: "G", published: false }, error: null }), () => ({ data: [], error: null })), uid(1))) === null && (await PJ.loadPublicJourney(jrn(() => ({ data: { ...prog, status: "draft" }, error: null }), () => ({ data: { published: true }, error: null }), () => ({ data: [], error: null })), uid(1))) === null && (await PJ.loadPublicJourney(jrn(() => ({ data: null, error: null }), () => ({ data: null, error: null }), () => ({ data: [], error: null })), "not-a-uuid")) === null && (await PJ.loadPublicJourney({ from() { throw new Error("boom"); } }, uid(1))) === null);
}

// ---------------------------------------------------------------- 4. the real components, in every state
{
  const Card = component("components/church/ChurchBibleCard.tsx");
  const prog = (n, o = {}) => ({ id: uid(n), title_en: "Psalms in 30 days", title_fr: "Les Psaumes en 30 jours", description_en: "A month of Psalms.\n\nRead one a day.", description_fr: "Un mois de Psaumes.", session_count: 30, ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang], c = t.churchBible.public;
    const h = html(Card, { t, locale: lang, programs: [prog(1)], ...cardTheme }, lang);
    check(`card (${lang}): heading, title, day count, description, privacy line, all in ${lang}`, h.includes(c.heading) && h.includes(lang === "en" ? "Psalms in 30 days" : "Les Psaumes en 30 jours") && h.includes(c.sessions(30)) && h.includes(lang === "en" ? "A month of Psalms." : "Un mois de Psaumes.") && h.includes(c.privacy), h.slice(0, 300));
    check(`card (${lang}): a labelled section, a real h2 and h3, one link to the programme's own page`, /<section aria-labelledby="church-bible-heading"/.test(h) && /<h2 id="church-bible-heading"/.test(h) && /<h3 /.test(h) && h.includes(`<a href="/my-ringo/journey/${uid(1)}"`) && h.includes(c.start) && (h.match(/<a /g) || []).length === 1);
    check(`card (${lang}): no text of the other language, no fallback note`, !h.includes(lang === "en" ? "Les Psaumes" : "Psalms in 30") && !h.includes(c.shownIn(c.languageName.en)) && !h.includes(c.shownIn(c.languageName.fr)));
    const pv = html(Card, { t, locale: lang, programs: [prog(1, { session_count: 0 })], preview: true, ...cardTheme }, lang);
    check(`card (${lang}): the dashboard preview has no link and no day count`, !/<a /.test(pv) && pv.includes(c.start) && !pv.includes(`>${c.sessions(0)}<`));
  }
  const fr = html(Card, { t: translations.fr, locale: "fr", programs: [prog(2, { title_fr: null, description_fr: null, title_en: "Only English" })], ...cardTheme }, "fr");
  check("fallback (fr visitor, English-only programme): the English text with a clear note in French", fr.includes("Only English") && fr.includes(translations.fr.churchBible.public.shownIn("anglais")));
  check("nothing readable renders nothing at all", html(Card, { t: translations.en, locale: "en", programs: [], ...cardTheme }, "en") === "" && html(Card, { t: translations.en, locale: "en", programs: [prog(3, { title_en: null, title_fr: null })], ...cardTheme }, "en") === "");
  const evil = html(Card, { t: translations.en, locale: "en", programs: [prog(4, { title_en: "<img src=x onerror=alert(1)>", description_en: "<script>alert(1)</script>" })], ...cardTheme }, "en");
  check("markup typed into any field is escaped, never injected", !/<img src=x|<script>alert/.test(evil) && evil.includes("&lt;"));

  // the sessions screen (church side)
  const { SessionsView } = { SessionsView: component("components/church/bible/SessionsPanel.tsx", "SessionsView") };
  const caps = (...p) => PERM.churchCapabilities(p);
  const sess = (n, o = {}) => ({ id: uid(100 + n), position: n, title_en: `Day ${n}`, title_fr: `Jour ${n}`, scripture_ref_en: `Psalm ${n}`, scripture_ref_fr: `Psaume ${n}`, note_en: null, note_fr: null, updated_at: "2026-10-22T10:00:00Z", ...o });
  const base = (o = {}) => ({ lang: "en", data: { sessions: [sess(1), sess(2), sess(3)], stats: { enrolled: 0, detailed: false, sessions: [] }, maxSessions: 400 }, caps: caps("church.bible.manage"), live: false, mayEdit: true, busy: false, error: "", onAdd() {}, onMove() {}, onEdit() {}, onAskDelete() {}, ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang], c = t.churchBible.sessions;
    const h = html(SessionsView, base({ lang }), lang);
    check(`days (${lang}): the heading with the count, the help, each day with its position, title and reference in ${lang}`, h.includes(c.heading) && h.includes(c.count(3)) && h.includes(c.help) && h.includes(c.position(1)) && h.includes(lang === "en" ? "Day 2" : "Jour 2") && h.includes(lang === "en" ? "Psalm 3" : "Psaume 3"), h.slice(0, 300));
    check(`days (${lang}): every day has four named icon buttons (earlier, later, edit, delete); the first cannot go earlier and the last cannot go later; Add is offered`, h.includes(`aria-label="${c.moveUp("Day 1".replace("Day", lang === "en" ? "Day" : "Jour"))}"`) && h.includes(`aria-label="${c.edit(lang === "en" ? "Day 2" : "Jour 2")}"`) && h.includes(`aria-label="${c.delete(lang === "en" ? "Day 3" : "Jour 3")}"`) && h.includes(c.add) && new RegExp(`aria-label="${c.moveUp(lang === "en" ? "Day 1" : "Jour 1")}"[^>]*disabled=""|disabled=""[^>]*aria-label="${c.moveUp(lang === "en" ? "Day 1" : "Jour 1")}"`).test(h) && new RegExp(`aria-label="${c.moveDown(lang === "en" ? "Day 3" : "Jour 3")}"[^>]*disabled=""|disabled=""[^>]*aria-label="${c.moveDown(lang === "en" ? "Day 3" : "Jour 3")}"`).test(h));
    const empty = html(SessionsView, base({ lang, data: { sessions: [], stats: null, maxSessions: 400 } }), lang);
    check(`days (${lang}): the empty state`, empty.includes(c.empty) && empty.includes(c.add));
    const viewOnly = html(SessionsView, base({ lang, mayEdit: false, caps: caps("church.bible.view") }), lang);
    check(`days (${lang}): view only: the note, no Add, no icon buttons`, viewOnly.includes(c.viewOnly) && !viewOnly.includes(c.add) && !/aria-label="[^"]*(Day|Jour) 1"/.test(viewOnly));
    const liveManage = html(SessionsView, base({ lang, live: true, mayEdit: false, caps: caps("church.bible.manage") }), lang);
    check(`days (${lang}): a live programme without the publish permission explains why it cannot be changed`, liveManage.includes(c.liveNeedsPublish) && !liveManage.includes(c.add));
    const full = html(SessionsView, base({ lang, data: { sessions: Array.from({ length: 400 }, (_, i) => sess(i + 1)), stats: null, maxSessions: 400 } }), lang);
    check(`days (${lang}): at the 400-day limit Add disappears and the limit is stated`, full.includes(c.limit(400)) && !full.includes(`>${c.add}<`));
    const few = html(SessionsView, base({ lang, data: { sessions: [sess(1)], stats: { enrolled: 2, detailed: false, sessions: [{ id: uid(101), position: 1, completed: null }] } } }), lang);
    check(`days (${lang}): with 2 participants only the number is shown, the privacy line and the small-cohort note, no per-day figure`, few.includes(t.churchBible.stats.enrolled(2)) && few.includes(t.churchBible.stats.privacy) && few.includes(t.churchBible.stats.small) && !few.includes(t.churchBible.stats.finished(1, 2)));
    const many = html(SessionsView, base({ lang, data: { sessions: [sess(1), sess(2)], stats: { enrolled: 5, detailed: true, sessions: [{ id: uid(101), position: 1, completed: 4 }, { id: uid(102), position: 2, completed: 1 }] } } }), lang);
    check(`days (${lang}): with 5 participants each day shows how many finished it, and the small-cohort note is gone`, many.includes(t.churchBible.stats.finished(4, 5)) && many.includes(t.churchBible.stats.finished(1, 5)) && !many.includes(t.churchBible.stats.small));
    check(`days (${lang}): nothing names a participant`, !/customer|@|email/i.test(many));
    check(`days (${lang}): an error line is shown`, html(SessionsView, base({ lang, error: "Boom sentence" }), lang).includes("Boom sentence"));
  }

  // the visitor's screens
  const { JourneyBody } = { JourneyBody: component("components/church/bible/journey/JourneyView.tsx", "JourneyBody") };
  const jsess = (n) => ({ id: uid(200 + n), position: n, title_en: `Day ${n}`, title_fr: `Jour ${n}`, scripture_ref_en: `Psalm ${n}`, scripture_ref_fr: `Psaume ${n}`, note_en: n === 1 ? "Read slowly.\n\nPray." : null, note_fr: n === 1 ? "Lisez lentement." : null });
  const jdata = (o = {}) => ({ program: { id: uid(1), title_en: "Psalms in 30 days", title_fr: "Les Psaumes en 30 jours", description_en: "A month of Psalms.", description_fr: "Un mois de Psaumes." }, church: { username: "grace-church", name: "Grace Chapel" }, sessions: [jsess(1), jsess(2), jsess(3)], enrollment: { joined_at: "2026-10-01T00:00:00Z" }, completed: [uid(201)], total: 3, done: 1, ...o });
  const jbase = (o = {}) => ({ lang: "en", data: jdata(), signedIn: true, notice: "", error: "", busyId: "", leaving: false, onJoin() {}, onToggle() {}, onAskLeave() {}, onLeave: async () => "", ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang], c = t.churchBible.journey;
    const T = (en, fr) => (lang === "en" ? en : fr);
    const h = html(JourneyBody, jbase({ lang }), lang);
    check(`journey (${lang}): joined: the church link, the title, the description, the progress in words and as a progressbar, in ${lang}`, h.includes(c.backToChurch("Grace Chapel")) && h.includes('href="/grace-church"') && h.includes(T("Psalms in 30 days", "Les Psaumes en 30 jours")) && h.includes(T("A month of Psalms.", "Un mois de Psaumes.")) && h.includes(c.progress(1, 3)) && /role="progressbar"[^>]*aria-valuenow="1"/.test(h) && /aria-valuemax="3"/.test(h), h.slice(0, 400));
    check(`journey (${lang}): each day is a named checkbox, the finished one checked and the others not, with its reference and note`, h.includes(`role="checkbox" aria-checked="true" aria-label="${c.markUndone(T("Day 1", "Jour 1"))}"`) && h.includes(`role="checkbox" aria-checked="false" aria-label="${c.markDone(T("Day 2", "Jour 2"))}"`) && h.includes(T("Psalm 3", "Psaume 3")) && h.includes(T("Read slowly.", "Lisez lentement.")) && (h.match(/role="checkbox"/g) || []).length === 3);
    check(`journey (${lang}): joined: a way to stop following, no join button, no sign-in prompt`, h.includes(c.leave) && !h.includes(c.join) && !h.includes(c.signInTitle));
    const notJoined = html(JourneyBody, jbase({ lang, data: jdata({ enrollment: null, completed: [], done: 0 }) }), lang);
    check(`journey (${lang}): signed in but not joined: the join button and the privacy line, days listed WITHOUT checkboxes, no progress`, notJoined.includes(c.join) && notJoined.includes(c.privacy) && !/role="checkbox"/.test(notJoined) && !/role="progressbar"/.test(notJoined) && !notJoined.includes(c.leave));
    const out = html(JourneyBody, jbase({ lang, signedIn: false, data: jdata({ enrollment: null, completed: [], done: 0 }) }), lang);
    check(`journey (${lang}): signed out: the programme can be read, with the sign-in prompt linking to My Ringo sign-in, and nothing to tick`, out.includes(c.signInTitle) && out.includes(c.signInBody) && out.includes('href="/my-ringo/signin"') && out.includes(T("Day 2", "Jour 2")) && !/role="checkbox"/.test(out) && !out.includes(c.join));
    const done = html(JourneyBody, jbase({ lang, data: jdata({ completed: [uid(201), uid(202), uid(203)], done: 3 }) }), lang);
    check(`journey (${lang}): finished: the congratulation`, done.includes(c.completed) && done.includes(c.progress(3, 3)));
    check(`journey (${lang}): a day being saved is disabled; an error line and a notice are shown`, new RegExp(`aria-label="${c.markDone(T("Day 2", "Jour 2"))}"[^>]*disabled=""|disabled=""[^>]*aria-label="${c.markDone(T("Day 2", "Jour 2"))}"`).test(html(JourneyBody, jbase({ lang, busyId: uid(202) }), lang)) && html(JourneyBody, jbase({ lang, error: "Boom sentence" }), lang).includes("Boom sentence") && html(JourneyBody, jbase({ lang, notice: "Joined note" }), lang).includes("Joined note"));
    const leaving = html(JourneyBody, jbase({ lang, leaving: true }), lang);
    check(`journey (${lang}): the leave confirmation is a danger action that says the progress is erased`, leaving.includes(`[${c.leaveTitle}|${c.leaveBody}|${c.leaveConfirm}|danger]`) && /erased|effacée/.test(c.leaveBody));
    const fb = html(JourneyBody, jbase({ lang: "fr", data: jdata({ program: { id: uid(1), title_en: "Only English", title_fr: null, description_en: null, description_fr: null }, sessions: [{ ...jsess(1), title_fr: null }] }) }), "fr");
    check("journey (fr): an English-only programme falls back to English with a note in French", fb.includes("Only English") && fb.includes(translations.fr.churchBible.journey.shownIn("anglais")));
    const evil = html(JourneyBody, jbase({ lang, data: jdata({ program: { id: uid(1), title_en: "<img src=x onerror=alert(1)>", title_fr: null, description_en: "<script>alert(1)</script>", description_fr: null }, sessions: [{ ...jsess(1), note_en: "<b>bold</b>" }] }) }), lang);
    check(`journey (${lang}): markup in the programme is escaped, never injected`, !/<img src=x|<script>alert|<b>bold/.test(evil) && evil.includes("&lt;"));
    check(`journey (${lang}): nothing in the page names the visitor or another visitor`, !/customer|@example|email/i.test(h));
  }
  const View = component("components/church/bible/journey/JourneyView.tsx");
  const signedOutPage = html(View, { programId: uid(1), signedIn: false, preloaded: jdata({ enrollment: null, completed: [], done: 0 }) }, "en");
  check("the signed-out programme page renders from the public data", signedOutPage.includes("Psalms in 30 days") && signedOutPage.includes('href="/my-ringo/signin"'));
  const unavailable = html(View, { programId: uid(1), signedIn: false, preloaded: null }, "fr");
  check("an unavailable programme says so in the visitor's language", unavailable.includes(translations.fr.churchBible.journey.notFoundTitle));
  const List = component("components/church/bible/journey/JourneyList.tsx");
  check("the signed-out list only asks to sign in", html(List, { signedIn: false }, "en").includes(translations.en.churchBible.journey.signInTitle) && html(List, { signedIn: false }, "fr").includes(translations.fr.churchBible.journey.signInTitle));
  const Shell = component("components/church/bible/journey/JourneyShell.tsx");
  check("the visitor frame has the title, a way back to My Ringo and the language switch", html(Shell, { children: null }, "fr").includes(translations.fr.churchBible.journey.pageTitle) && html(Shell, { children: null }, "en").includes('href="/my-ringo"'));

  // the church editor and list render
  const S = (name) => component("components/church/bible/BibleScreens.tsx", name);
  const pcaps = caps("church.bible.publish");
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const form = html(S("ProgramEditor"), { caps: pcaps }, lang);
    check(`programme editor (${lang}): the new-programme form with title and description, tabs and the save button; the days appear only after saving`, form.includes(t.churchBible.programs.editor.newTitle) && form.includes(t.churchBible.programs.fields.title.label) && form.includes(t.churchBible.programs.fields.description.label) && form.includes(t.churchBible.programs.editor.saveDraft) && /role="tablist"/.test(form) && !form.includes(t.churchBible.sessions.heading));
    const list = html(S("ProgramsList"), { caps: pcaps }, lang);
    check(`programmes list (${lang}): the intro, the view filter and the add button; a view-only person gets no add button`, list.includes(t.churchBible.programs.subtitle) && list.includes(t.churchBible.programs.list.views.published) && list.includes(t.churchBible.programs.list.add) && !html(S("ProgramsList"), { caps: caps("church.bible.view") }, lang).includes(t.churchBible.programs.list.add));
  }

  // the real ProfileView
  let PV = null, loadErr = "";
  try { PV = component("components/ProfileView.tsx"); } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 500));
  if (PV) {
    const opts = (category, lang) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false });
    const extras = { events: [], announcements: [], programs: [prog(30)], music: [] };
    const page = (category, lang, churchPublic) => html(PV, { profile: buildPreviewProfile(opts(category, lang)), pageViewEventId: "preview", preview: false, churchPublic }, lang);
    const ch = page("church_ministries", "en", extras);
    check("church page with a published programme: the card appears, after 'Visit us'", ch.includes("church-bible-heading") && ch.indexOf("church-visit-heading") > -1 && ch.indexOf("church-visit-heading") < ch.indexOf("church-bible-heading"));
    check("church page (fr): the French card", page("church_ministries", "fr", extras).includes("Programmes bibliques") && page("church_ministries", "fr", extras).includes("Les Psaumes en 30 jours"));
    check("church page with nothing published (default prop, or an empty list): no card, as before", !page("church_ministries", "en", undefined).includes("church-bible-heading") && !page("church_ministries", "en", { events: [], announcements: [], programs: [], music: [] }).includes("church-bible-heading"));
    const leaks = [];
    for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-bible-heading/.test(page(c, lang, extras))) leaks.push(`${c}/${lang}`);
    check("no other category's page shows the card even if programmes were passed (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    check("the editor's live preview (nothing passed) shows no card", !html(PV, { profile: buildPreviewProfile(opts("church_ministries", "en")), pageViewEventId: "preview", preview: true }, "en").includes("church-bible-heading"));
  }
  const pageSrc = read("src/app/[username]/page.tsx");
  check("the public route is unchanged by Phase 5 (the aggregate loader carries the programmes)", /loadChurchPublic\(supabase, profile\.id\)/.test(pageSrc) && !/bible_/.test(pageSrc));
  check("ProfileView: the card is gated on the church flag (the church template) and on having programmes", /isChurch \? \(\s*<ChurchSiteView/.test(read("src/components/ProfileView.tsx")) && /\{churchPublic\.programs\.length > 0 && \(/.test(read("src/components/church/site/ChurchSiteView.tsx")));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
