// Churches & Ministries: the church site template and the church dashboard home (the UI/UX redesign). Offline: no database, no network, no dev server, no browser.
//   * the new dictionary (churchSite) in both languages;
//   * the owner's Appearance colours still paint the church hero, and NO combination an owner can choose is unreadable (contrast is computed, never assumed);
//   * the church dashboard: every card goes to a real page, the list is the same one the section navigation uses, a person sees only what they may open,
//     and nothing needs a sideways scroll;
//   * the real ProfileView: the church template is for churches only (no other category changed), its navigation lists only sections that exist,
//     published-only data rules and the testimony form's preview rule are intact, and nothing private is printed.
//   Run:  node scripts/tests/churchSiteDesign.test.mjs
import fs from "fs";
import path from "path";
import { REPO, SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const THEME = jiti(path.join(SRC, "components/church/site/churchTheme.ts"));
const COLOR = jiti(path.join(SRC, "lib/color.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));

// ---------------------------------------------------------------- 1. dictionary
{
  const out = walkDictionary(translations.en.churchSite, translations.fr.churchSite, "churchSite");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 12 && a.includes(" ")).map(([k]) => k);
  check("French is a translation, not a copy", same.length === 0, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = sampleArgs(key, a);
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  const modules = Object.keys(translations.en.churchSite.home.modules).sort().join();
  check("every dashboard section has a one-line explanation", modules === "announcements,attendance,bible,care,content,events,groups,leadership,music,people,reports,store,testimonies", modules);
}

// ---------------------------------------------------------------- 2. the hero theme: the owner's colours, never unreadable
{
  const H = THEME.churchHeroTheme;
  const d = H({}, "#D4A954");
  check("no saved colours: the page default (near-black with light text)", d.bg === "#0A0A0A" && d.ink.toLowerCase() === "#fafafa" && !d.gradient);
  const light = H({ background_color: "#FFFFFF", text_color: "#14202B" }, "#1F9D55");
  check("a light theme the owner chose is kept as they chose it", light.bg === "#FFFFFF" && light.ink === "#14202B");
  const g = H({ background_style: "gradient", background_color: "#1E3A8A", background_gradient_end: "#000000", text_color: "#FFFFFF" }, "#D4A954");
  check("a gradient keeps both ends", g.gradient && g.bg === "#1E3A8A" && g.bgEnd === "#000000" && g.ink === "#FFFFFF");
  check("a solid style ignores a stale gradient end", !H({ background_style: "solid", background_color: "#123456", background_gradient_end: "#FFFFFF" }, "#D4A954").gradient && H({ background_style: "solid", background_color: "#123456", background_gradient_end: "#FFFFFF" }, "#D4A954").bgEnd === "#123456");
  const bad = H({ background_color: "red; background:url(x)", text_color: "<script>", background_gradient_end: 42 }, "#D4A954");
  check("anything that is not a 6-digit hex colour falls back to the default, so nothing is injected into a style", bad.bg === "#0A0A0A" && !/[;<(]/.test(JSON.stringify(bad)));
  // a sweep of owner choices (including the ones a person is likely to make by accident): text and accent text must always read on the WHOLE hero
  const pal = ["#000000", "#FFFFFF", "#808080", "#888888", "#D4A954", "#4F46E5", "#1E3A8A", "#F2B705", "#0B0B12", "#FAFAF8", "#7F7F7F", "#B0B0B0"];
  let worst = 99, worstAccent = 99, n = 0;
  for (const bg of pal) for (const end of pal) for (const text of pal) for (const accent of ["#D4A954", "#4F46E5", "#808080", "#FFFFFF", "#000000"]) {
    const t = H({ background_style: "gradient", background_color: bg, background_gradient_end: end, text_color: text }, accent);
    const lo = (c) => Math.min(COLOR.contrastRatio(c, t.bg), COLOR.contrastRatio(c, t.bgEnd));
    worst = Math.min(worst, lo(t.ink));
    worstAccent = Math.min(worstAccent, lo(t.accentText));
    n++;
  }
  check(`text on the hero reads (WCAG AA 4.5:1) for all ${n} combinations of background, gradient end, text and accent`, worst >= 4.5, "worst " + worst.toFixed(2));
  check(`accent text on the hero reads (4.5:1) for all ${n} combinations`, worstAccent >= 4.5, "worst " + worstAccent.toFixed(2));
  const pageDefaults = THEME.churchPalette("#D4A954");
  check("accent text on the linen ground reads (4.5:1), whatever the accent", ["#D4A954", "#F2B705", "#FFFFFF", "#4F46E5", "#808080"].every((a) => COLOR.contrastRatio(THEME.CH.paper, THEME.churchPalette(a).accentText) >= 4.5) && COLOR.contrastRatio(THEME.CH.paper, pageDefaults.accentText) >= 4.5);
  check("accent text on the night band reads (4.5:1), whatever the accent", ["#D4A954", "#4F46E5", "#000000", "#808080"].every((a) => COLOR.contrastRatio(THEME.CH.night, THEME.churchPalette(a).accentOnNight) >= 4.5));
  check("body and muted text on the linen ground clear AA", COLOR.contrastRatio(THEME.CH.ink, THEME.CH.paper) >= 7 && COLOR.contrastRatio(THEME.CH.muted, THEME.CH.paper) >= 4.5 && COLOR.contrastRatio(THEME.CH.nightText, THEME.CH.night) >= 7);
}

// ---------------------------------------------------------------- 3. the church dashboard
{
  const Home = component("components/church/workspace/ChurchHome.tsx");
  const Shell = component("components/church/people/ChurchShell.tsx");
  const churchModules = component("components/church/people/ChurchShell.tsx", "churchModules");
  const caps = (...p) => PERM.churchCapabilities(p);
  const all = caps(...PERM.CHURCH_PERMISSIONS);
  const church = { name: "Grace Community Church", username: "grace", avatarUrl: null };
  const hrefs = (h) => [...h.matchAll(/<a href="(\/dashboard\/church\/[a-z-]+)"/g)].map((m) => m[1]);
  const pageExists = (href) => fs.existsSync(path.join(REPO, "src/app", href.replace(/^\//, ""), "page.tsx"));
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const owner = html(Home, { caps: all, isOwner: true, church }, lang);
    const list = hrefs(owner);
    check(`home (${lang}): the owner sees 19 section cards, no duplicates`, list.length === 19 && new Set(list).size === 19, list.join());
    check(`home (${lang}): every card goes to a page that exists`, list.every(pageExists), list.filter((h) => !pageExists(h)).join());
    check(`home (${lang}): the four groups are present, labelled in ${lang}`, ["community", "ministry", "care", "business"].every((g) => owner.includes(t.churchSite.home.groups[g])));
    check(`home (${lang}): each card carries its title and its one-line explanation`, Object.entries(t.churchSite.home.modules).every(([, text]) => owner.includes(text)));
    check(`home (${lang}): the church's own name is the heading, with a link to its public page`, owner.includes("Grace Community Church") && owner.includes('href="/grace"') && owner.includes(t.churchSite.home.viewPublic));
    const staff = html(Home, { caps: caps("church.attendance.view"), isOwner: false, church }, lang);
    check(`home (${lang}): staff see only the sections they may open, and no Store`, hrefs(staff).join() === "/dashboard/church/attendance" && !staff.includes(t.churchSite.home.groups.business) && !staff.includes(t.churchSite.home.groups.community));
    check(`home (${lang}): a church with no logo shows its initial, never a broken image`, owner.includes(">G<") && !/default-avatar/.test(owner));
    check(`home (${lang}): nothing scrolls sideways`, !/overflow-x-auto|overflow-x-scroll|snap-x/.test(owner));
    const shell = html(Shell, { caps: all, isOwner: true, children: null }, lang);
    check(`shell (${lang}): one navigation with the same 19 sections, current page marked`, hrefs(shell).length === 19 && /aria-current="page"/.test(shell) && hrefs(shell).join() === list.join(), hrefs(shell).join());
    check(`shell (${lang}): the phone menu is a real button that says what it controls, closed at first`, /aria-expanded="false"/.test(shell) && /aria-controls="church-sections"/.test(shell) && /id="church-sections"/.test(shell));
    check(`shell (${lang}): the groups are labelled`, ["community", "ministry", "care", "business"].every((g) => shell.includes(t.churchSite.home.groups[g])));
    check(`shell (${lang}): nothing scrolls sideways, and every link is at least 44px tall`, !/overflow-x-auto|snap-x/.test(shell) && (shell.match(/min-h-\[44px\]/g) || []).length >= 13);
  }
  // the list behind both screens is the permission map, section by section
  const t = translations.en;
  const only = (perm) => churchModules(t, caps(perm), false).map((m) => m.key).join();
  const expect = { "church.members.view": "people,members", "church.groups.view": "groups,pubgroups", "church.leadership.view": "leadership", "church.content.view": "content", "church.events.view": "events,announcements", "church.bible.view": "bible", "church.attendance.view": "attendance", "church.music.manage": "music", "church.reports.view": "reports", "church.care.view": "care", "church.testimonies.view": "testimonies" };
  for (const [perm, keys] of Object.entries(expect)) if (PERM.CHURCH_PERMISSIONS.includes(perm)) check(`${perm} opens exactly: ${keys}`, only(perm) === keys, only(perm));
  check("the Store is offered to the owner only", churchModules(t, all, false).every((m) => m.key !== "store") && churchModules(t, all, true).some((m) => m.key === "store"));
  // the index page mirrors the list on the server (a client module's function cannot be called there): the same capabilities, in the same order
  const shellSrc = noComments(read("src/components/church/people/ChurchShell.tsx"));
  const showCaps = [...shellSrc.matchAll(/show: ([^}]+?) \},/g)].flatMap((m) => [...m[1].matchAll(/caps\.(\w+)|isOwner/g)].map((x) => x[1] || "isOwner"));
  const indexSrc = noComments(read("src/app/dashboard/church/page.tsx"));
  const arr = indexSrc.match(/const sections = \[([^\]]+)\]/)?.[1] || "";
  const indexCaps = [...arr.matchAll(/caps\.(\w+)|isOwner/g)].map((x) => x[1] || "isOwner");
  const dedupe = (a) => a.filter((x, i) => a[i - 1] !== x || false);
  check("the church index counts the same capabilities, in the same order, as the section list", JSON.stringify(dedupe(showCaps)) === JSON.stringify(dedupe(indexCaps)), `${showCaps.join()} vs ${indexCaps.join()}`);
  check("a person with a single section still goes straight to it", /sections\.length <= 1/.test(indexSrc) && /redirect\(sections\[0\]\?\.href \?\? "\/dashboard"\)/.test(indexSrc));
  check("the home page reads nothing but the church's own public name, picture and username", /select\("name, username, avatar_url"\)/.test(indexSrc) && !/church_members|church_groups|ministry_|daily_words/.test(indexSrc));
  for (const f of ["components/church/workspace/ChurchHome.tsx", "components/church/people/ChurchShell.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, no storage, no raw HTML, typed buttons, no database client`, problems.length === 0, problems.join(" ; "));
  }
}

// ---------------------------------------------------------------- 4. the public church site, through the real ProfileView
{
  const PV = component("components/ProfileView.tsx");
  const opts = (category, lang, extra = {}) => ({ category, lang, accent: "#D4A954", bg: "#0A0A0A", text: "#FAFAFA", bgStyle: "solid", button: "outline", radius: "rounded", long: false, minimal: false, ...extra });
  const empty = { events: [], announcements: [], programs: [], music: [], care: [], testimonies: [] };
  const full = {
    events: [{ id: uid(1), event_date: "2026-11-01", start_time: "09:00", end_time: null, title_en: "Thanksgiving service", title_fr: "Culte d'action de grâce", description_en: null, description_fr: null, venue: null, address: null, online_url: null, is_cancelled: false }],
    announcements: [{ id: uid(2), title_en: "New members class", title_fr: "Classe", body_en: "Next Sunday.", body_fr: "Dimanche.", expires_on: null }],
    programs: [{ id: uid(3), title_en: "John in 21 days", title_fr: "Jean en 21 jours", description_en: null, description_fr: null, session_count: 21 }],
    music: [{ id: uid(4), platform: "youtube", title: "Sunday worship", url: "https://youtube.com/" }],
    care: [{ id: uid(5), category: "medical", title_en: "Surgery support", title_fr: "Soutien", summary_en: "Meals for two weeks.", summary_fr: "Repas." }],
    testimonies: [{ id: uid(6), display_name: "Esther N.", body: "God answered my prayer.", lang: "en" }, { id: uid(7), display_name: null, body: "Thank you for the welcome.", lang: "en" }],
  };
  const words = [{ id: uid(8), publish_on: "2026-10-24", title_en: "Peace", title_fr: "Paix", scripture_ref_en: "Phil 4:6", scripture_ref_fr: "Phil 4:6", scripture_text_en: "Do not be anxious", scripture_text_fr: "Ne vous inquiétez", body_en: "Body", body_fr: "Corps", prayer_en: null, prayer_fr: null }];
  const page = (category, lang, props = {}, o = {}) => html(PV, { profile: buildPreviewProfile(opts(category, lang, o)), pageViewEventId: "preview", preview: false, ...props }, lang);
  const navLinks = (h) => [...(h.match(/<nav aria-label="[^"]*" class="ml-auto hidden xl:block">([\s\S]*?)<\/nav>/)?.[1] || "").matchAll(/href="#(church-[a-z]+)"/g)].map((m) => m[1]);

  for (const lang of ["en", "fr"]) {
    const t = translations[lang].churchSite.public;
    const ch = page("church_ministries", lang, { churchPublic: full, dailyWords: words });
    check(`church page (${lang}): the church template, with its own heading hierarchy`, ch.includes("church-site") && /<h1/.test(ch) && ch.includes('id="top"'));
    check(`church page (${lang}): the navigation lists every section that has content, in page order`, navLinks(ch).join() === "church-visit,church-news,church-word,church-testimonies,church-bible,church-music,church-care,church-store,church-links,church-contact", navLinks(ch).join());
    const ids = [...ch.matchAll(/id="(church-(?:visit|news|word|testimonies|bible|music|care|store|links|contact))"/g)].map((m) => m[1]);
    check(`church page (${lang}): every navigation link points at a section that is really on the page`, navLinks(ch).every((l) => ids.includes(l)) && new Set(ids).size === ids.length, ids.join());
    check(`church page (${lang}): the navigation labels come from the ${lang} dictionary`, navLinks(ch).every((l) => ch.includes(t.sections[l.replace("church-", "")])));
    check(`church page (${lang}): the phone menu is a labelled, closed button`, /aria-controls="church-site-menu"/.test(ch) && /aria-expanded="false"/.test(ch));
    check(`church page (${lang}): Plan a visit points at the Visit section, with real service times shown`, ch.includes(`href="#church-visit"`) && ch.includes(t.planVisit));
    const bare = page("church_ministries", lang, { churchPublic: empty, dailyWords: [] }, { minimal: true });
    check(`church page (${lang}): with nothing published, only the sections that exist are in the navigation (no empty headings)`, !/church-(events|daily-word|bible|music|care)-heading/.test(bare) && navLinks(bare).every((l) => ["church-testimonies", "church-contact", "church-visit", "church-links", "church-store"].includes(l)), navLinks(bare).join());
    const prev = page("church_ministries", lang, { churchPublic: full, dailyWords: words, preview: true });
    const heroOf = (h) => h.match(/<header id="top"[\s\S]*?<\/header>/)?.[0] || "";
    check(`church page (${lang}): the editor's preview shows no testimony form, and its hero buttons carry no live link`, !prev.includes("church-testimony-share-heading") && heroOf(prev).length > 200 && !/href="https:\/\/wa\.me|href="tel:/.test(heroOf(prev)) && /href="https:\/\/wa\.me|href="tel:/.test(heroOf(ch)));
  }
  const en = page("church_ministries", "en", { churchPublic: full, dailyWords: words });
  check("the page never prints a phone number or a private field of a testimony or a care case", !/237670999888|Secret Group/.test(page("church_ministries", "en", { churchPublic: { ...full, testimonies: [{ ...full.testimonies[0], phone: "237670999888", group_label: "Secret Group" }], care: [{ ...full.care[0], beneficiary_name: "Secret Group", internal_notes: "237670999888" }] }, dailyWords: words })));
  const Slides = component("components/church/ChurchTestimoniesCard.tsx");
  const slide = (item) => html(Slides, { t: translations.en, testimonies: [item], accent: "#D4A954", accentText: "#D4A954", textColor: "#F4EEE4", borderTint: "rgba(244,238,228,0.16)", radiusClass: "rounded-[28px]", surface: "#18212B" }, "en");
  check("a testimony with name consent shows the name; one without shows only the words", slide(full.testimonies[0]).includes("Esther N.") && slide(full.testimonies[1]).includes("Thank you for the welcome.") && !/<footer/.test(slide(full.testimonies[1])));
  const tinted = page("church_ministries", "en", { churchPublic: empty }, { bg: "#FFFFFF", text: "#14202B", accent: "#1F9D55" });
  check("the owner's background and text colours still paint the church hero", /<header id="top"[^>]*background-color:#FFFFFF/.test(tinted) && /<header id="top"[^>]*color:#14202B/.test(tinted));
  const grad = page("church_ministries", "en", { churchPublic: empty }, { bgStyle: "gradient", bg: "#1E3A8A", text: "#FFFFFF" });
  check("a gradient background paints the hero as a gradient", /<header id="top"[^>]*linear-gradient\(135deg, ?#1E3A8A/.test(grad));
  const unreadable = page("church_ministries", "en", { churchPublic: empty }, { bg: "#808080", text: "#888888" });
  check("an unreadable text colour the owner picked is replaced by one that reads", /<header id="top"[^>]*color:#14110A/.test(unreadable));
  // the editor stores the accent as free text; the church site writes colours into a style rule, so only a real hex colour ever gets there
  const evilAccent = 'red;}</style><script>alert(1)</script><style>*{display:none}';
  const hostile = page("church_ministries", "en", { churchPublic: empty }, { accent: evilAccent });
  const hostileStyle = hostile.match(/<style>([^<]*)<\/style>/)?.[1] || "";
  const hostileHero = hostile.match(/<header id="top"[\s\S]*?<\/header>/)?.[0] || "";
  check("a hostile accent value is never written as markup, and the church template's own style rule and hero only ever carry the sanitized colour (the default gold)", !/<script|<style>\*/.test(hostile) && hostileStyle.length > 20 && !/red|alert|display:none/.test(hostileStyle) && hostileHero.length > 200 && !/alert\(1\)|display:none/.test(hostileHero) && THEME.safeAccent(evilAccent) === "#D4A954" && THEME.safeAccent("#4F46E5") === "#4F46E5" && THEME.safeAccent(undefined) === "#D4A954", hostileStyle.slice(0, 120));
  const leaks = [];
  for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-site|church-visit-heading|church-testimony-share/.test(page(c, lang, { churchPublic: full, dailyWords: words }))) leaks.push(`${c}/${lang}`);
  check("no other category's page uses the church template, even if church rows were passed (every other category x 2 languages)", leaks.length === 0, leaks.join(", "));

  // source rules for the new public files
  for (const f of ["components/church/site/ChurchSiteView.tsx", "components/church/site/Monogram.tsx", "components/church/DailyWordCard.tsx", "components/church/ChurchEventsCards.tsx", "components/church/ChurchBibleCard.tsx", "components/church/ChurchMusicCard.tsx", "components/church/ChurchCareCard.tsx", "components/church/ChurchVisitCard.tsx", "components/church/ChurchTestimoniesCard.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, no storage, no raw HTML, typed buttons, no database client`, problems.length === 0, problems.join(" ; "));
  }
  const site = noComments(read("src/components/church/site/ChurchSiteView.tsx"));
  check("the site view makes no request of its own and reads no data (everything arrives as props)", !/fetch\(|createClient|supabase/.test(site));
  check("the site view's menu closes on Escape and returns focus to its button", /e\.key === "Escape"/.test(site) && /menuButton\.current\?\.focus\(\)/.test(site));
  check("nothing in the church template scrolls sideways", !/overflow-x-auto|overflow-x-scroll|snap-x/.test(site));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
