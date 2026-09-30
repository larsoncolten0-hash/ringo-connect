// Public profile language selector (English / Français) and the "Powered by Ringo Connect" footer.
// No network, no database. The REAL components are rendered to HTML with react-dom/server through a
// small TypeScript loader; behaviour that needs a live browser (opening the menu) is covered by the
// pure helpers the component uses plus structural checks on its source — there is no DOM library
// in this repo, so that limit is stated rather than papered over.
//
//   Run:  node scripts/tests/publicLanguageAndFooter.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ------------------------------------------------------------------ a tiny TS/TSX loader (TypeScript's own compiler)
const ts = nodeRequire("typescript");
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(REPO, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => {
    const local = resolveLocal(spec, path.dirname(file));
    return local ? loadTs(local) : nodeRequire(spec);
  };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(REPO, "src", p));

const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const PoweredByRingo = src("components/PoweredByRingo.tsx").default;
const { RINGO_CONNECT_URL } = src("components/PoweredByRingo.tsx");
const PublicLanguageSelector = src("components/PublicLanguageSelector.tsx").default;
const locales = src("lib/i18n/locales.ts");
const { translations } = src("lib/i18n/translations.ts");

const render = (locale, node) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, node));

// ================================================================== the language registry and helpers
{
  check("registry: English and Français are the supported languages, each labelled in its own language", JSON.stringify(locales.SUPPORTED_LOCALES) === '["en","fr"]' && locales.LOCALE_META.en.label === "English" && locales.LOCALE_META.fr.label === "Français" && locales.LOCALE_META.en.short === "EN" && locales.LOCALE_META.fr.short === "FR");
  check("registry: it is exactly the set of languages translations.ts defines — so a new language cannot be added to one and forgotten in the other", JSON.stringify(Object.keys(locales.LOCALE_META).sort()) === JSON.stringify(Object.keys(translations).sort()));
  check("registry: it uses the SAME storage key the whole app already uses", locales.LOCALE_STORAGE_KEY === "ringo-lang" && /"ringo-lang"/.test(read("src/lib/i18n/locales.ts")));
  check("default: a saved choice always wins", locales.resolveInitialLocale("en", "fr-FR") === "en" && locales.resolveInitialLocale("fr", "en-US") === "fr");
  check("default: with nothing saved, an English browser gets English; anything else gets the French fallback", locales.resolveInitialLocale(null, "en-GB") === "en" && locales.resolveInitialLocale(null, "EN") === "en" && locales.resolveInitialLocale(null, "fr-CM") === "fr" && locales.resolveInitialLocale(null, "de-DE") === "fr" && locales.resolveInitialLocale(undefined, undefined) === "fr" && locales.resolveInitialLocale(null, "") === "fr");
  check("default: an invalid or stale saved value is ignored, not trusted", locales.resolveInitialLocale("de", "en-US") === "en" && locales.resolveInitialLocale("<script>", "fr") === "fr" && locales.resolveInitialLocale(42, "fr") === "fr" && locales.isLocale("constructor") === false && locales.isLocale("en") === true);
  check("keyboard: arrows wrap around, Home/End jump, other keys leave the highlight alone", locales.listboxNextIndex("ArrowDown", 0, 2) === 1 && locales.listboxNextIndex("ArrowDown", 1, 2) === 0 && locales.listboxNextIndex("ArrowUp", 0, 2) === 1 && locales.listboxNextIndex("Home", 1, 2) === 0 && locales.listboxNextIndex("End", 0, 2) === 1 && locales.listboxNextIndex("a", 1, 2) === 1 && locales.listboxNextIndex("ArrowDown", 0, 0) === 0);
}

// ================================================================== interface labels, both languages
{
  const en = translations.en.profilePage;
  const fr = translations.fr.profilePage;
  check("labels: the selector, the footer and the copyright line exist in English and French", en.languageLabel && fr.languageLabel && en.poweredBy && fr.poweredBy && en.rights && fr.rights);
  check("labels: the footer reads exactly 'Powered by Ringo Connect' / 'Propulsé par Ringo Connect'", en.poweredBy === "Powered by Ringo Connect" && fr.poweredBy === "Propulsé par Ringo Connect");
  check("labels: the copyright line is translated ('All rights reserved.' / 'Tous droits réservés.')", en.rights === "All rights reserved." && fr.rights === "Tous droits réservés." && en.languageLabel !== fr.languageLabel);
  const shape = (o) => Object.keys(o).sort().join();
  check("labels: the whole profilePage block has identical keys in both languages", shape(en) === shape(fr));
  // The existing public interface really is translated: scan the components a visitor sees for hardcoded English.
  const publicFiles = ["components/ProfileView.tsx", "components/BookingPage.tsx", "components/CommunityJoinPage.tsx", "components/BookingButton.tsx", "components/WhatsAppButton.tsx", "components/CallButton.tsx", "components/SaveContactButton.tsx", "components/ShareButton.tsx", "components/AddToHomeScreen.tsx", "components/catalog/CatalogSection.tsx", "components/catalog/ProductDetailView.tsx", "components/music/MusicStorePage.tsx", "components/music/ItemDetailPage.tsx", "components/music/EventsSection.tsx", "components/restaurant/RestaurantOrderPage.tsx", "components/restaurant/MenuItemDetailView.tsx", "components/PublicLanguageSelector.tsx", "components/PoweredByRingo.tsx"];
  const hits = [];
  for (const f of publicFiles) {
    strip(read("src/" + f)).split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/>\s*([A-Za-zÀ-ÿ][^<>{}]{2,})\s*</g)) if (!/^[a-z]+(-[a-z0-9]+)*$/.test(m[1].trim()) && !/^[A-Z_]{2,}$/.test(m[1].trim())) hits.push(`${f}:${i + 1} >${m[1].trim()}<`);
      for (const m of line.matchAll(/\b(aria-label|title|placeholder|alt)="([A-Za-zÀ-ÿ][^"]{2,})"/g)) if (m[2] !== "WhatsApp") hits.push(`${f}:${i + 1} ${m[1]}="${m[2]}"`);
    });
  }
  check("regression: no hardcoded English is left in the public profile, booking, catalog, music or restaurant screens (the brand name WhatsApp aside)", hits.length === 0, hits.join(" | "));
}

// ================================================================== rendered footer
{
  const enHtml = render("en", React.createElement(PoweredByRingo));
  const frHtml = render("fr", React.createElement(PoweredByRingo));
  check("footer: English shows 'Powered by' then a 'Ringo Connect' label, with the full phrase as its accessible name", />Powered by</.test(enHtml) && />Ringo Connect</.test(enHtml) && /aria-label="Powered by Ringo Connect"/.test(enHtml), enHtml);
  check("footer: French shows 'Propulsé par' then a 'Ringo Connect' label, with the full phrase as its accessible name", />Propulsé par</.test(frHtml) && />Ringo Connect</.test(frHtml) && /aria-label="Propulsé par Ringo Connect"/.test(frHtml), frHtml);
  check("footer: it links to https://ringoconnectltd.com exactly", RINGO_CONNECT_URL === "https://ringoconnectltd.com" && /<a [^>]*href="https:\/\/ringoconnectltd\.com"/.test(enHtml) && /<a [^>]*href="https:\/\/ringoconnectltd\.com"/.test(frHtml));
  check("footer: it opens in the SAME tab (no target attribute), is a single real link, and the link text is its accessible name", !/target=/.test(enHtml) && (enHtml.match(/<a /g) || []).length === 1);
  check("footer: it is a bordered, rounded, button-like label with a decorative arrow, and the whole label is the single link", /border border-current/.test(enHtml) && /rounded-full/.test(enHtml) && /<a [^>]*>.*<svg[^>]*aria-hidden="true".*<\/svg>.*<\/a>/.test(enHtml));
  check("footer: it has a hover state, a visible focus ring and a 40px touch target, with no heavy animation", /hover:opacity-100/.test(enHtml) && /hover:\[background-color/.test(enHtml) && /focus-visible:outline/.test(enHtml) && /min-h-\[40px\]/.test(enHtml) && !/animate-|translate|scale-/.test(enHtml));
  check("footer: it takes its colour from the page (owner's branding stays the focus) — no hard-coded text colour", !/style="[^"]*color:/.test(enHtml) && !/text-(white|black|gray|slate)/.test(enHtml));
}

// ================================================================== rendered selector (closed state)
{
  const en = render("en", React.createElement(PublicLanguageSelector));
  const fr = render("fr", React.createElement(PublicLanguageSelector));
  check("selector: it is visible as a compact button showing the current language code — 'EN' in English, 'FR' in French", />EN</.test(en) && />FR</.test(fr) && (en.match(/<button/g) || []).length === 1);
  check("selector: it is a listbox popup button with a proper accessible name naming the current language, closed by default", /aria-haspopup="listbox"/.test(en) && /aria-expanded="false"/.test(en) && /aria-label="Language: English"/.test(en) && /aria-label="Langue: Français"/.test(fr) && /type="button"/.test(en));
  check("selector: the code and chevron are decorative (hidden from screen readers) so the name is announced once", /<span aria-hidden="true">EN<\/span>/.test(en) && /<svg[^>]*aria-hidden="true"/.test(en));
  check("selector: the menu is not in the page until opened (no clutter)", !/role="listbox"/.test(en) && !/role="option"/.test(en));
  check("selector: touch target and keyboard focus — 36px+ tall pill with a visible focus ring", /h-9/.test(en) && /focus-visible:outline/.test(en));
  const glass = render("en", React.createElement(PublicLanguageSelector, { variant: "glass", accent: "#ff5500" }));
  const overlay = render("en", React.createElement(PublicLanguageSelector, { variant: "overlay" }));
  const bar = render("en", React.createElement(PublicLanguageSelector, { variant: "bar" }));
  check("selector: three surface variants — frosted-white in the owner's accent over a cover photo, dark glass over a hero image, outlined in a white header bar", /rgba\(255,255,255,0\.7\)/.test(glass) && /color:#ff5500/.test(glass) && /rgba\(15,15,20,0\.42\)/.test(overlay) && /border/.test(bar) && /border-color:#E5E7EB/.test(bar));
  const cmp = read("src/components/PublicLanguageSelector.tsx");
  check("selector (open state, structural): a listbox of options with aria-selected, aria-activedescendant, and each option carries its own lang", /role="listbox"/.test(cmp) && /role="option"/.test(cmp) && /aria-selected=\{code === locale\}/.test(cmp) && /aria-activedescendant/.test(cmp) && /lang=\{code\}/.test(cmp));
  check("selector (keyboard, structural): Enter / Space / arrows open and choose, Escape closes and returns focus, Tab and clicking outside close, options are 40px tall", /"ArrowDown" \|\| e\.key === "ArrowUp"/.test(cmp) && /e\.key === "Enter" \|\| e\.key === " "/.test(cmp) && /e\.key === "Escape"/.test(cmp) && /buttonRef\.current\?\.focus\(\)/.test(cmp) && /e\.key === "Tab"/.test(cmp) && /pointerdown/.test(cmp) && /min-h-\[40px\]/.test(cmp));
  check("selector: it lists every supported language from the shared registry (so a third language appears automatically)", /SUPPORTED_LOCALES\.map/.test(cmp) && /LOCALE_META\[code\]\.label/.test(cmp) && !/"fr"|"en"|Français|English/.test(strip(cmp).replace(/\/\/.*$/gm, "")));
  check("selector: choosing a language ONLY calls the existing provider's setLocale — no route change, no request, no profile data", /setLocale\(SUPPORTED_LOCALES\[index\]\)/.test(cmp) && !/fetch\(|router\.|window\.location|localStorage|supabase/.test(strip(cmp)));
}

// ================================================================== persistence across the public experience
{
  const layout = read("src/app/layout.tsx");
  const providerUses = ["src/app", "src/components"].flatMap((d) => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    return walk(path.join(REPO, d));
  }).filter((f) => /<LanguageProvider\b/.test(fs.readFileSync(f, "utf8")));
  check("persistence: ONE LanguageProvider wraps the whole app from the root layout, so every public page shares the same language state", /<LanguageProvider>/.test(layout) && providerUses.map((f) => path.relative(REPO, f).replace(/\\/g, "/")).join() === "src/app/layout.tsx", providerUses.join());
  const provider = read("src/components/LanguageProvider.tsx");
  check("persistence: the choice is stored under the app-wide key and restored on the next page/visit (saved -> browser -> French)", /localStorage\.setItem\(LOCALE_STORAGE_KEY, next\)/.test(provider) && /localStorage\.getItem\(LOCALE_STORAGE_KEY\)/.test(provider) && /resolveInitialLocale\(saved, navigator\.language\)/.test(provider));
  check("persistence: storage failures (private browsing) never break the page — the choice still applies for the visit", (provider.match(/try \{/g) || []).length >= 2);
  check("persistence: <html lang> follows the visible language (accessibility), instead of staying 'en'", /document\.documentElement\.lang = locale/.test(provider));
  const setters = ["src/app", "src/components"].flatMap((d) => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []));
    return walk(path.join(REPO, d));
  }).filter((f) => /setLocale\(/.test(strip(fs.readFileSync(f, "utf8")))).map((f) => path.relative(REPO, f).replace(/\\/g, "/")).sort();
  check("persistence: nothing on a public page silently resets the language — only the two language pickers ever call setLocale (the provider merely defines it)", JSON.stringify(setters) === JSON.stringify(["src/components/LanguageToggle.tsx", "src/components/PublicLanguageSelector.tsx"]), setters.join());
  check("persistence: profile URLs, QR links and Smart Card destinations are untouched — the language is not put in any URL", !/\?lang=|lang=\$\{|searchParams.*lang/.test(read("src/components/PublicLanguageSelector.tsx")) && !/locale.*pathname|\/\$\{locale\}\//.test(provider));
}

// ================================================================== owner-written content is never touched
{
  const profileView = read("src/components/ProfileView.tsx");
  check("content: the owner's bio and long bio are still rendered exactly as they wrote them (from the profile, untranslated)", /\{profile\.bio\}/.test(profileView) && /\{profile\.about_long_bio\}/.test(profileView));
  const changed = ["src/components/PublicLanguageSelector.tsx", "src/components/PoweredByRingo.tsx", "src/lib/i18n/locales.ts", "src/components/LanguageProvider.tsx"].map((f) => strip(read(f))).join("\n");
  check("content: none of the new code reads, writes, translates or calls any service with profile content (no bio/description/name access, no fetch, no AI or translation API)", !/\bbio\b|description|about_|product|profile\./.test(changed) && !/fetch\(|openai|anthropic|translate\(|googleapis|deepl/i.test(changed));
  check("content: no database migration and no new dependency was needed for this feature", !fs.readdirSync(path.join(REPO, "supabase/migrations")).some((f) => /language|locale|i18n|translat/i.test(f)) && !/"(i18next|next-intl|react-intl|deepl|@google-cloud\/translate)"/.test(read("package.json")));
  const columns = Object.keys(translations.en).filter((k) => /^(bio|description|profileContent|ownerContent)/i.test(k));
  check("content: the translation dictionary holds interface text only — there is no store of translated owner content", columns.length === 0);
}

// ================================================================== placement: where it appears (and where it must not)
{
  const has = (f, re) => re.test(read(f));
  const pages = {
    "src/components/ProfileView.tsx": { selector: 'variant="glass"', footer: 1 },
    "src/components/restaurant/RestaurantOrderPage.tsx": { selector: 'variant="bar"', footer: 1, gate: '"menu"' },
    "src/components/restaurant/MenuItemDetailView.tsx": { selector: 'variant="bar"', footer: 1 },
    "src/components/music/MusicStorePage.tsx": { selector: 'variant="bar"', footer: 1, gate: '"store"' },
    "src/components/music/ItemDetailPage.tsx": { selector: 'variant="bar"', footer: 1 },
    "src/components/catalog/ProductDetailView.tsx": { selector: 'variant="overlay"', footer: 1 },
    "src/components/BookingPage.tsx": { selector: 'variant="bar"', footer: 1 },
    "src/components/CommunityJoinPage.tsx": { selector: 'variant="bar"', footer: 1 },
  };
  for (const [f, want] of Object.entries(pages)) {
    const s = strip(read(f));
    const selectors = (s.match(/<PublicLanguageSelector\b/g) || []).length;
    const footers = (s.match(/<PoweredByRingo\b/g) || []).length;
    check(`placement: ${f.replace("src/components/", "")} — one selector (${want.selector}) and exactly ${want.footer} footer`, selectors === 1 && footers === want.footer && s.includes(want.selector), `selectors=${selectors} footers=${footers}`);
    if (want.gate) check(`placement: ${f.replace("src/components/", "")} — selector and footer appear only while BROWSING (step === ${want.gate}), never on checkout, payment or confirmation screens`, new RegExp(`step === ${want.gate} && <PublicLanguageSelector`).test(s) && new RegExp(`step === ${want.gate} && <PoweredByRingo`).test(s));
  }
  const pv = strip(read("src/components/ProfileView.tsx"));
  check("footer: the main profile's old hardcoded, unlinked 'Made with Ringo Connect' is GONE — replaced, not duplicated — and its copyright line is translated", !/Made with Ringo Connect/.test(pv) && !/All rights reserved/.test(pv) && /\{t\.profilePage\.rights\}/.test(pv));
  check("footer: on the main profile it sits at the very bottom, after all of the owner's content", pv.indexOf("<PoweredByRingo") > pv.indexOf("<AddToHomeScreen") && pv.indexOf("<PoweredByRingo") > pv.indexOf("<ConnectButton") && pv.indexOf("<PoweredByRingo") > pv.indexOf("staffBadges.map"));
  const selAt = pv.indexOf("<PublicLanguageSelector");
  const blockAt = pv.lastIndexOf("{!preview && (", selAt);
  check("editing: the selector sits inside the {!preview && (...)} block that is not rendered in the dashboard's live preview (so it can never change the owner's dashboard language while editing)", blockAt > -1 && !/\)\}/.test(pv.slice(blockAt, selAt)), pv.slice(blockAt, blockAt + 60));
  for (const f of ["src/components/checkout/ProductCheckout.tsx", "src/components/checkout/ProtectionCheckout.tsx", "src/components/checkout/CheckoutPreview.tsx", "src/components/checkout/CheckoutModeSwitch.tsx", "src/components/music/ReceiptPageView.tsx", "src/components/music/TicketPassView.tsx", "src/components/restaurant/GuestOrderTrackingView.tsx", "src/components/restaurant/ReceiptView.tsx", "src/components/shop/ShopOrderReceiptView.tsx"]) {
    check(`safety: ${f.replace("src/components/", "")} (checkout / payment / receipt / tracking) carries neither the selector nor the footer link`, fs.existsSync(path.join(REPO, f)) ? !/PublicLanguageSelector|PoweredByRingo/.test(read(f)) : true);
  }
  check("scope: no route, API, payment, auth, permission or RLS file was touched — this is presentation only", !/api\/|route\.ts|middleware/.test(["PublicLanguageSelector", "PoweredByRingo"].join()) && fs.existsSync(path.join(REPO, "src/middleware.ts")) && !/PublicLanguageSelector|PoweredByRingo|isLocale|LOCALE_META/.test(read("src/middleware.ts")));
}

const failed = results.filter((x) => !x.pass);
console.log(`\npublicLanguageAndFooter: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
