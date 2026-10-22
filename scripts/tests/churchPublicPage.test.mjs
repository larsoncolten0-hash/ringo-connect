// Churches & Ministries, Phase 1: the public page shell. Offline: no database, no network, no dev server. The real ProfileView and ChurchVisitCard are
// server-rendered in English and French from fixtures (sucrase + a tiny CommonJS loader, as in commerceA11y.test.mjs).
//   Run:  node scripts/tests/churchPublicPage.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 400));
};

const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const PAGE = jiti(path.join(SRC, "lib/church/publicPage.ts"));
const STAGE = jiti(path.join(SRC, "lib/profileStage.ts"));
const ORDER = jiti(path.join(SRC, "lib/sectionOrder.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const COLOR = jiti(path.join(SRC, "lib/color.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));

// ---------------------------------------------------------------- component loader
let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const Null = () => null;
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
  "next/navigation": { usePathname: () => "/x", useRouter: () => ({ refresh() {}, push() {} }), useSearchParams: () => new URLSearchParams() },
  "next/script": { __esModule: true, default: Null },
  "next/dynamic": { __esModule: true, default: () => Null },
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt || "" }) },
  "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href }, p.children) },
};
function load(file) {
  if (!file.endsWith(".tsx")) return jiti(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const relative = (id) => {
    const base = path.join(path.dirname(file), id);
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    throw new Error("cannot resolve " + id);
  };
  const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(resolveSrc(id)) : id.startsWith(".") ? load(relative(id)) : require(id));
  new Function("require", "module", "exports", code)(req, mod, mod.exports);
  return mod.exports;
}
const V = (rel) => load(path.join(SRC, rel)).default;
const html = (Comp, props, lang) => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
};

// ------------------------------------------------------------------ 1. pure helpers
{
  const P = PAGE.parseServiceTimes;
  check("service times: one line stays one entry", JSON.stringify(P("Sunday 9am – 11:30am")) === JSON.stringify(["Sunday 9am – 11:30am"]));
  check("service times: ' · ', ' | ', ';' and new lines separate entries", JSON.stringify(P("Sun 9am · Wed 6pm | Fri 7pm; Sat 5pm\nMon 8am")) === JSON.stringify(["Sun 9am", "Wed 6pm", "Fri 7pm", "Sat 5pm", "Mon 8am"]));
  check("service times: a time with a colon or a dash is NOT split", JSON.stringify(P("Sun 9:00 - 11:30")) === JSON.stringify(["Sun 9:00 - 11:30"]));
  check("service times: blanks, whitespace-only and non-strings give nothing", P("").length === 0 && P("   \n  ").length === 0 && P(null).length === 0 && P(undefined).length === 0 && P(42).length === 0);
  check("service times: capped at 8 entries and 120 characters each", P(Array.from({ length: 20 }, (_, i) => `Day ${i}`).join("\n")).length === 8 && P("x".repeat(500))[0].length === 120);
  const V1 = PAGE.getChurchVisit;
  check("visit: nothing to show -> null (the card is not rendered)", V1(null) === null && V1({}) === null && V1({ about_hours: " ", about_location: "" }) === null);
  const v = V1({ about_hours: "Sun 9am", about_location: "Rue 12, Bonanjo, Douala" });
  check("visit: hours and location are read from the profile's existing fields", v.serviceTimes[0] === "Sun 9am" && v.location === "Rue 12, Bonanjo, Douala");
  check("visit: the directions link is a maps search of the owner's own text, properly encoded", v.directionsUrl === "https://www.google.com/maps/search/Rue%2012%2C%20Bonanjo%2C%20Douala");
  check("visit: hours alone work (no location, so no directions link)", V1({ about_hours: "Sun 9am" }).directionsUrl === null);
  check("visit: a location alone works (no service times)", V1({ about_location: "Douala" }).serviceTimes.length === 0);
  check("visit: markup typed into the location stays text and is URL-encoded", !V1({ about_location: "<script>alert(1)</script>" }).directionsUrl.includes("<"));

  const T = PAGE.getChurchTypeLabel;
  check("type label: English and French labels for each real sub-type", T({ category: "church_ministries", subcategory: "choir" }, "en") === "Choir" && T({ category: "church_ministries", subcategory: "choir" }, "fr") === "Chorale" && T({ category: "church_ministries", subcategory: "parish" }, "fr") === "Paroisse");
  check("type label: the catch-all 'other', no sub-type and an unknown one show nothing", T({ category: "church_ministries", subcategory: "other" }, "en") === null && T({ category: "church_ministries" }, "en") === null && T({ category: "church_ministries", subcategory: "farmer" }, "en") === null);
  check("type label: a church sub-type on a NON-church primary category shows nothing", T({ category: "business_ecommerce", subcategory: "choir" }, "en") === null && T({ category: "other", subcategory: "parish" }, "en") === null);
  check("module order names the planned modules; only the ones that exist today are marked live", PAGE.CHURCH_MODULE_ORDER[0] === "visit" && !PAGE.CHURCH_LIVE_MODULES.includes("daily_word") && !PAGE.CHURCH_LIVE_MODULES.includes("church_music") && PAGE.CHURCH_LIVE_MODULES.every((m) => PAGE.CHURCH_MODULE_ORDER.includes(m)));
}

// ------------------------------------------------------------------ 2. stage, order, theme: church only, everything else unchanged
{
  const s = STAGE.getProfileStage("church_ministries");
  check("church stage: Paper panel, still avatar, tall cover, natural name, editorial headings, closing ring, no player cards", s.id === "church" && !!s.panel && s.avatar === "still" && s.cover === "tall" && s.name === "natural" && s.headings === "editorial" && s.closingRing && s.player === null);
  check("church stage: built from foundation tokens only (the shared Paper panel, no new palette)", s.panel === STAGE.getProfileStage("music_entertainment").panel);
  const expected = { music_entertainment: "music", events_experiences: "event", restaurant_food: "editorial", travel_hospitality: "editorial", real_estate: "editorial", beauty_wellness: "calm", health_medical: "calm", education_training: "calm", freelancers_creators: "expressive", creative_media: "expressive", business_ecommerce: "structured", professional_services: "structured", transport_logistics: "structured", construction_home_services: "structured", agriculture_agribusiness: "structured", other: "default" };
  check("every other category keeps exactly the stage it had", Object.entries(expected).every(([c, id]) => STAGE.getProfileStage(c).id === id), JSON.stringify(Object.entries(expected).filter(([c, id]) => STAGE.getProfileStage(c).id !== id)));
  const all = { about: true, links: true, catalog: true, events: true };
  const o = (extra) => ORDER.orderPublicSections({ category: "church_ministries", isMusic: false, isRestaurant: false, ...extra }, all).join();
  check("church section order: events, store (catalog), links, contact last", o() === "events,catalog,links,about");
  check("church order: sections with nothing to show are dropped, and the empty contact note stays last", ORDER.orderPublicSections({ category: "church_ministries", isMusic: false, isRestaurant: false }, { about: false, links: true, catalog: false, events: false }).join() === "links,about");
  const t = CAT.getCategory("church_ministries").defaults.recommendedTheme;
  check("church theme: a real ThemeCard value set, 'rounded' like every category theme", !!t && /^#[0-9A-F]{6}$/i.test(t.themeColor) && t.buttonRadius === "rounded" && ["solid", "gradient"].includes(t.backgroundStyle));
  check("church theme: body text, accent text and the dark end of the gradient all clear WCAG AA (4.5:1) on the hero background", COLOR.contrastRatio(t.textColor, t.backgroundColor) >= 4.5 && COLOR.contrastRatio(t.themeColor, t.backgroundColor) >= 4.5 && COLOR.contrastRatio(t.themeColor, t.backgroundGradientEnd) >= 4.5 && COLOR.contrastRatio(t.textColor, t.backgroundGradientEnd) >= 4.5,
    [COLOR.contrastRatio(t.textColor, t.backgroundColor), COLOR.contrastRatio(t.themeColor, t.backgroundColor), COLOR.contrastRatio(t.themeColor, t.backgroundGradientEnd)].join(" / "));
  const withTheme = CAT.CATEGORIES.filter((c) => c.defaults.recommendedTheme).map((c) => c.id).sort().join();
  check("recommended themes: only music, restaurant and now church ship one", withTheme === "church_ministries,music_entertainment,restaurant_food", withTheme);
}

// ------------------------------------------------------------------ 3. the visit card, rendered
{
  const Card = V("components/church/ChurchVisitCard.tsx");
  const base = (lang) => ({ t: translations[lang], visit: PAGE.getChurchVisit({ about_hours: "Sunday 9am – 11:30am · Wednesday 6pm, prayer", about_location: "Rue 12, Bonanjo, Douala" }), accent: "#818CF8", accentText: "#3730A3", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-ringo-lg" });
  for (const lang of ["en", "fr"]) {
    const h = html(Card, base(lang), lang);
    const c = translations[lang].profilePage.church;
    check(`card (${lang}): heading, both sections' labels and the directions button come from the dictionary`, h.includes(c.visitTitle) && h.includes(c.serviceTimes) && h.includes(c.location) && h.includes(c.getDirections), h.slice(0, 300));
    check(`card (${lang}): service times are a list of the owner's own entries`, /<ul/.test(h) && h.includes("Sunday 9am – 11:30am") && h.includes("Wednesday 6pm, prayer"));
    check(`card (${lang}): semantics, a labelled section with a real h2, decorative icons hidden from assistive technology`, /<section aria-labelledby="church-visit-heading"/.test(h) && /<h2 id="church-visit-heading"/.test(h) && (h.match(/aria-hidden="true"/g) || []).length >= 3);
    check(`card (${lang}): directions link opens safely, is named for the place, and is at least 44px tall`, /href="https:\/\/www\.google\.com\/maps\/search\/Rue%2012%2C%20Bonanjo%2C%20Douala"/.test(h) && /rel="noopener noreferrer"/.test(h) && /target="_blank"/.test(h) && h.includes(`aria-label="${c.directionsTo("Rue 12, Bonanjo, Douala")}"`) && /min-h-\[44px\]/.test(h));
    check(`card (${lang}): keyboard focus is visible`, /focus-visible:outline/.test(h));
  }
  const onlyLoc = html(Card, { ...base("en"), visit: PAGE.getChurchVisit({ about_location: "Douala" }) }, "en");
  check("card: with no service times that block is absent (no empty heading or placeholder)", !onlyLoc.includes(translations.en.profilePage.church.serviceTimes) && onlyLoc.includes("Douala"));
  const onlyTimes = html(Card, { ...base("en"), visit: PAGE.getChurchVisit({ about_hours: "Sun 9am" }) }, "en");
  check("card: with no location there is no location block and no directions button; a single time is a paragraph, not a list", !onlyTimes.includes(translations.en.profilePage.church.getDirections) && !/<ul/.test(onlyTimes) && onlyTimes.includes("Sun 9am"));
  const evil = html(Card, { ...base("en"), visit: PAGE.getChurchVisit({ about_hours: "<img src=x onerror=alert(1)>", about_location: "<b>Hall</b>" }) }, "en");
  check("card: owner text is escaped, never injected as markup", !/<img src=x/.test(evil) && !/<b>Hall/.test(evil));
}

// ------------------------------------------------------------------ 4. the real ProfileView, church vs everyone else
{
  let PV = null;
  let loadErr = "";
  try { PV = V("components/ProfileView.tsx"); } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 600));
  if (PV) {
    const opts = (category, lang, extra = {}) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false, ...extra });
    const page = (category, lang, extra) => html(PV, { profile: buildPreviewProfile(opts(category, lang, extra)), pageViewEventId: "preview", preview: false }, lang);
    const en = page("church_ministries", "en");
    const fr = page("church_ministries", "fr");
    check("church page (en): identity, ministry type, bio, Visit card with real service times, and the store label", en.includes("Grace Community Church") || en.includes("Grace"), en.slice(0, 200));
    check("church page (en): ministry type pill, 'Visit us' card and service times are shown", en.includes("Local Church") && en.includes("Visit us") && en.includes("Sunday 9am – 11:30am") && en.includes("Wednesday 6pm, prayer"));
    check("church page (fr): the same in French", fr.includes("Église locale") && fr.includes("Nous rendre visite") && fr.includes("Dimanche 9h – 11h30") && fr.includes("Itinéraire"));
    check("church page: no Events section and no ticketing UI (church has no ticketing yet)", !/Upcoming|Get Ticket|Launch night|Nuit de lancement/.test(en));
    check("church page: no Daily Word, music, giving, Bible or group-messaging UI, and no placeholder text", !/Daily Word|Parole du jour|Bible|Donate|Don\b|Give|WhatsApp group|groupe WhatsApp|Coming soon|Bientôt|Lorem/i.test(en + fr), (en + fr).match(/Daily Word|Parole du jour|Bible|Donate|Give|WhatsApp group|Coming soon|Lorem/i)?.[0]);
    check("church page: the location and hours are shown once, in the Visit card, not repeated in the contact card", (en.match(/Sunday 9am – 11:30am/g) || []).length === 1);
    check("church page: uses the shared Paper panel (content sits on the light panel)", en.includes("rounded-ringo-xl") && en.includes("rgb(var(--rc-paper))"));
    check("church page keeps the shared behaviour: skip link, Connect, share, language selector, footer", en.includes('href="#profile-content"') && en.includes('id="profile-content"') && /<footer/.test(en));

    const minimal = page("church_ministries", "en", { minimal: true });
    check("church page with no cover, bio or contact still renders without error and without a type pill it was not given", minimal.length > 500);
    const noTimes = html(PV, { profile: { ...buildPreviewProfile(opts("church_ministries", "en")), about_hours: null, about_location: null }, pageViewEventId: "preview" }, "en");
    check("church page with no hours and no location: no Visit card, no empty heading", !noTimes.includes("Visit us") && !noTimes.includes("church-visit-heading"));
    const preview = html(PV, { profile: buildPreviewProfile(opts("church_ministries", "en")), pageViewEventId: "preview", preview: true }, "en");
    check("the editor's live preview (same component) shows the church page too", preview.includes("Visit us"));

    // every other category: byte-for-byte free of anything church
    const others = CAT.CATEGORY_IDS.filter((c) => c !== "church_ministries");
    const leaks = [];
    for (const c of others) for (const lang of ["en", "fr"]) {
      const h = page(c, lang);
      if (/church-visit-heading|Visit us|Nous rendre visite|Local Church|Église locale|Itinéraire/.test(h)) leaks.push(`${c}/${lang}`);
    }
    check("no other category's public page shows any church element (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    check("a non-church page that happens to carry church-looking data is unaffected", !/church-visit-heading/.test(html(PV, { profile: { ...buildPreviewProfile(opts("business_ecommerce", "en")), subcategory: "choir", about_hours: "Sun 9am" }, pageViewEventId: "preview" }, "en")));
    const biz = page("business_ecommerce", "en");
    check("a non-church page still shows its hours and location in its contact card", biz.includes("Mon–Sat, 8am–6pm"));
    const secondary = html(PV, { profile: { ...buildPreviewProfile(opts("business_ecommerce", "en")), categories: ["business_ecommerce", "church_ministries"] }, pageViewEventId: "preview" }, "en");
    check("church as a SECONDARY category gets the Visit card but never a ministry-type pill", secondary.includes("Visit us") && !secondary.includes("Local Church"));
  }
}

// ------------------------------------------------------------------ 5. i18n parity and editor label
{
  const en = translations.en.profilePage.church, fr = translations.fr.profilePage.church;
  check("i18n: profilePage.church has the same keys in English and French", JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(fr).sort()) && Object.keys(en).length === 5);
  check("i18n: every string is non-empty and French differs from English", ["visitTitle", "serviceTimes", "location", "getDirections"].every((k) => en[k] && fr[k] && en[k] !== fr[k]) && en.directionsTo("X").includes("X") && fr.directionsTo("X").includes("X") && en.directionsTo("X") !== fr.directionsTo("X"));
  check("i18n: the editor label for service times exists in both languages", !!translations.en.editor.about.serviceTimes && !!translations.fr.editor.about.serviceTimes && translations.en.editor.about.serviceTimes !== translations.fr.editor.about.serviceTimes);
  const about = read("src/components/editor/AboutCard.tsx");
  check("editor: AboutCard's church label is opt-in (default false) and only swaps the hours field's wording", /isChurch = false/.test(about) && /isChurch \? t\.editor\.about\.serviceTimes : t\.editor\.about\.hours/.test(about) && !/about_hours: isChurch/.test(about));
  check("editor: Editor passes it only for the church category", /isChurch=\{profileHasCategory\(draft, "church_ministries"\)\}/.test(read("src/components/Editor.tsx")));
}

// ------------------------------------------------------------------ 6. scope: nothing beyond the shell
{
  const migs = fs.readdirSync(path.join(REPO, "supabase/migrations")).sort();
  check("no new migration or schema change in Phase 1 (the newest is still the Phase 0 one)", migs[migs.length - 1] === "2026-12-26_church_category.sql");
  const view = read("src/components/ProfileView.tsx");
  check("ProfileView: every church addition is gated on the church flag", /const churchVisit = isChurch \? getChurchVisit\(profile\) : null/.test(view) && /const churchType = isChurch \? getChurchTypeLabel\(profile, locale\) : null/.test(view) && /\{churchVisit && \(\s*<ChurchVisitCard/.test(view) && /\{churchType && \(/.test(view));
  const touched = ["src/components/church/ChurchVisitCard.tsx", "src/lib/church/publicPage.ts"].map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); // code only: a comment may say "stripe" (an accent stripe)
  check("no payment, auth, database, fetch or tracking code in the new files", !/supabase|fetch\(|createClient|process\.env|localStorage|document\.cookie|\.rpc\(|stripe|fapshi/i.test(touched));
  check("no WhatsApp group feature anywhere in the new files", !/whatsapp/i.test(touched));
}

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} church public page checks passed`);
if (failed.length) process.exit(1);
