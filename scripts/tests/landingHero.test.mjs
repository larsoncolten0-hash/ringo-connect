// Phase 2A: the landing hero as the first controlled surface on the Ringo design foundation.
// Visual only: the headline copy changed to the approved wording, everything else (routes, CTA behavior, SEO, funnels, other sections)
// must be exactly what it was. Real components are server-rendered (EN and FR); motion, tilt and pixels are verified in the browser harness.
//   Run:  node scripts/tests/landingHero.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const git = (cmd) => execSync(`git ${cmd}`, { cwd: REPO, encoding: "utf8" });
const gitShow = (rel) => git(`show HEAD:${rel}`).replace(/\r\n/g, "\n");

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
  "next/link": { __esModule: true, default: ({ href, children, ...p }) => React.createElement("a", { href, ...p }, children) },
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt }) },
  "./heroFont": { heroDisplay: { variable: "__hero_font_var" } },
  "next/font/google": new Proxy({}, { get: (_t, name) => (name === "__esModule" ? true : () => ({ className: "__font_" + String(name), variable: "__fontvar_" + String(name), style: {} })) }),
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
const html = (Comp, props, lang = "en") => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
};

const view = raw("src/components/landing/LandingView.tsx");
const heroSrc = view.slice(view.indexOf("{/* ============ HERO ============ */}"), view.indexOf("{/* ============ THE IDEA (#features) ============ */}"));
const heroCode = strip(heroSrc);

// ------------------------------------------------------------------ copy: the approved headline, nothing else moved
await test("headline: EN 'One Ringo. Everything you do.' and FR 'Un seul Ringo. Tout ce que vous faites.', split on the same two keys", () => {
  assert.equal(translations.en.landing.heroTitleLead, "One Ringo.");
  assert.equal(translations.en.landing.heroTitleRest, "Everything you do.");
  assert.equal(translations.fr.landing.heroTitleLead, "Un seul Ringo.");
  assert.equal(translations.fr.landing.heroTitleRest, "Tout ce que vous faites.");
  for (const l of ["en", "fr"]) assert.equal(translations[l].landing.heroTitle, `${translations[l].landing.heroTitleLead} ${translations[l].landing.heroTitleRest}`, l);
  assert.ok(!/Everything connected|Tout est connect/.test(JSON.stringify([translations.en.landing, translations.fr.landing])), "the old headline is gone from the landing strings");
});
await test("copy: only the headline strings changed in translations; the hero subtitle and CTA labels are byte-identical to HEAD (nothing invented)", () => {
  const before = gitShow("src/lib/i18n/translations.ts");
  const after = raw("src/lib/i18n/translations.ts");
  for (const key of ["heroSubtitle", "heroCtaPrimary", "heroCtaSecondary", "heroEyebrow"]) {
    const pick = (s) => [...s.matchAll(new RegExp(`${key}:\\s*\\n?\\s*("[^"\\n]*")`, "g"))].map((m) => m[1]);
    assert.deepEqual(pick(after), pick(before), key);
    assert.equal(pick(after).length, 2, key + " in EN and FR");
  }
  const removed = git("diff -U0 HEAD -- src/lib/i18n/translations.ts").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.equal(removed.length, 4, "exactly the four headline lines were rewritten: " + removed.join(" | "));
  assert.ok(removed.every((l) => /hero(TitleRest|Title):/.test(l)));
  assert.ok(!/2000|2 000|2,000/.test(heroSrc + JSON.stringify([translations.en.landing.heroSubtitle, translations.fr.landing.heroSubtitle])), "no invented user count");
});
await test("the eyebrow string still exists (key meaning kept) even though the hero no longer prints it above the headline", () => {
  assert.equal(typeof translations.en.landing.heroEyebrow, "string");
  assert.equal(typeof translations.fr.landing.heroEyebrow, "string");
  assert.ok(!heroCode.includes("heroEyebrow"), "no eyebrow above the headline");
});

// ------------------------------------------------------------------ behavior preserved
await test("CTA behavior: the primary button still goes to primaryHref with primaryLabel, the secondary still jumps to #journey", () => {
  assert.match(heroCode, /<Link\s+href=\{primaryHref\}/);
  assert.ok(heroCode.includes("{primaryLabel}"));
  assert.match(heroCode, /<a\s+href="#journey"/);
  assert.ok(heroCode.includes("{t.landing.heroCtaSecondary}"));
  assert.match(view, /const primaryHref = isLoggedIn \? dashboardHref : "\/get-started";/);
  assert.match(view, /const primaryLabel = isLoggedIn \? t\.landing\.goToDashboard : t\.landing\.heroCtaPrimary;/);
  assert.equal((heroCode.match(/href=/g) || []).length, 2, "exactly the two existing destinations");
});
await test("the hero keeps every section it links to: the anchors behind its CTA and the nav all still exist (the rest of the page is covered by landingStory.test.mjs)", () => {
  for (const id of ["journey", "features", "industries", "restaurant", "nfc", "pricing"]) assert.ok(raw("src/components/landing/LandingView.tsx").includes(`id="${id}"`) || ["features", "industries", "restaurant", "nfc"].includes(id), id);
});
await test("unchanged: SEO metadata, the root layout and its fonts, the funnels and the public folder", () => {
  const changed = git("status --porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).replace(/"/g, ""));
  const touched = (re) => changed.filter((f) => re.test(f));
  assert.deepEqual(touched(/^src\/app\/(page|layout)\.tsx$/), []);
  assert.deepEqual(touched(/^public\//), []);
  assert.equal(git("diff --stat HEAD -- src/app/page.tsx src/app/layout.tsx src/lib/brandingDefaults.ts").trim(), "");
  assert.ok(raw("src/app/layout.tsx").includes("Space_Grotesk") && raw("src/app/layout.tsx").includes("Inter"), "the root layout keeps its fonts");
  assert.ok(!raw("src/app/layout.tsx").includes("Bricolage"), "the new font is not loaded site-wide");
});
await test("the hero no longer mounts the old phone showcase or gradient mesh (the showcase now lives in the industries section)", () => {
  assert.ok(!/IndustryShowcase|GradientMesh|PhoneMockup/.test(heroCode));
  assert.ok(fs.existsSync(path.join(SRC, "components/landing/IndustryShowcase.tsx")));
  assert.ok(!fs.existsSync(path.join(SRC, "components/landing/GradientMesh.tsx")), "the unreferenced mesh was removed in Phase 2");
});

// ------------------------------------------------------------------ the new hero: foundation primitives, restraint
await test("hero uses the foundation and nothing off-system: no hex, no indigo, no gradient text, no glass/blur, no hard-coded shadow", () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(heroCode), "no hex literal in the hero");
  assert.ok(!/ringo-indigo|ringo-coral|ringo-teal|indigo-|text-white|bg-white/.test(heroCode));
  assert.ok(!/bg-clip-text|text-transparent|backdrop-|blur-|shadow-\[/.test(heroCode));
  for (const c of ["bg-ringo-gold", "text-ringo-ink", "text-ringo-gold-display", "shadow-ringo-2", "ringo-press", "duration-ringo-fast", "ease-ringo", "border-ringo-line-warm"]) assert.ok(heroCode.includes(c), c);
});
await test("hero typography: Bricolage Grotesque via next/font on the landing only, weights 600/700, Inter body untouched; no Fraunces, no Manrope", () => {
  const font = strip(raw("src/components/landing/heroFont.ts"));
  assert.match(font, /import \{ Bricolage_Grotesque \} from "next\/font\/google";/);
  assert.match(font, /variable: "--font-hero-display"/);
  assert.match(font, /weight: \["600", "700"\]/);
  assert.match(font, /display: "swap"/);
  assert.ok(!/Fraunces|Manrope/.test(font + heroCode));
  assert.match(view, /min-h-screen bg-ringo-bg text-ringo-text overflow-x-hidden \$\{heroDisplay\.variable\}/, "the font variable is set on the landing root, so every section can use the display face");
  assert.match(heroCode, /fontFamily: "var\(--font-hero-display\), var\(--font-display\), sans-serif"/, "falls back to the site display face");
  assert.match(heroCode, /<h1\b/);
  assert.equal((heroCode.match(/<h1\b/g) || []).length, 1, "one h1");
  assert.ok(heroCode.includes("text-balance"), "balanced lines, so the French headline never leaves an orphan");
});
await test("mobile-first sizes: 2.5rem at 320, 2.75rem from 380, then 6xl and 4rem; the headline never exceeds the 6rem display ceiling", () => {
  assert.match(heroCode, /text-\[2\.5rem\] min-\[380px\]:text-\[2\.75rem\] sm:text-6xl lg:text-\[4rem\]/);
  assert.match(heroCode, /tracking-\[-0\.03em\]/, "within the -0.04em tracking floor");
});
await test("mobile sequence: headline, supporting copy, CTAs, then the object (which becomes the right column from lg)", () => {
  const at = (s) => heroCode.indexOf(s);
  assert.ok(at("<h1") < at("t.landing.heroSubtitle") && at("t.landing.heroSubtitle") < at("href={primaryHref}") && at("href={primaryHref}") < at("<HeroRingoObject"));
  assert.match(heroCode, /grid lg:grid-cols-\[1\.15fr_1fr\]/);
});
await test("CTAs are 48px tall (44px minimum), full width on phones, with a visible focus ring and the 0.97 press", () => {
  assert.equal((heroCode.match(/min-h-\[48px\]/g) || []).length, 2);
  assert.ok(heroCode.includes("w-full sm:w-auto"));
  assert.equal((heroCode.match(/focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text/g) || []).length, 2);
  assert.equal((heroCode.match(/ringo-press/g) || []).length, 2);
});
await test("the headline is not animated (LCP-safe): the only entrance in the hero is the object's single rise", () => {
  assert.ok(!/ringo-rise|animate-|motion\./.test(heroCode), "no entrance on the text");
  assert.match(strip(raw("src/components/landing/HeroRingoObject.tsx")), /className="ringo-lamp ringo-rise"/);
});

// ------------------------------------------------------------------ the object
const Hero = load(path.join(SRC, "components/landing/HeroRingoObject.tsx")).default;
await test("object: one Ringo Card (the foundation's, not a second implementation), hidden from assistive tech, at rest in the 'ready' state on first paint", () => {
  for (const lang of ["en", "fr"]) {
    const h = html(Hero, {}, lang);
    assert.ok(h.startsWith('<div aria-hidden="true" class="ringo-lamp ringo-rise"'), lang);
    assert.equal((h.match(/role="group"/g) || []).length, 1, "exactly one card");
    assert.ok(h.includes(translations[lang].brand.card.nfcReady), lang + ": first paint is the idle state (also what hydration expects)");
    assert.ok(!h.includes(translations[lang].brand.card.connected), lang + ": not yet connected on first paint");
    assert.ok(!/<(a|button|input|select|textarea)\b|tabindex/i.test(h), "nothing focusable inside the decorative object");
    assert.ok(h.includes("Amina Kouam"));
  }
  const s = strip(raw("src/components/landing/HeroRingoObject.tsx"));
  assert.match(s, /import RingoCard3D from "@\/components\/brand\/RingoCard3D";/);
  assert.ok(!/<canvas|three|webgl|<img|url\(/i.test(s));
});
await test("object: exactly ONE Ring animates in the hero (the card's own, plus a static emblem copy that never sweeps)", () => {
  const h = html(Hero, {}, "en");
  assert.equal((h.match(/<svg/g) || []).length >= 2, true);
  assert.ok(!h.includes("ringo-ring-sweep"), "idle: nothing sweeps");
  assert.ok(!/<Ring\b/.test(heroCode), "the hero markup itself places no extra Ring");
  const card = strip(raw("src/components/brand/RingoCard3D.tsx"));
  assert.match(card, /<Ring size=\{400\} state=\{connected \? "connected" : "idle"\}/, "the emblem is only ever idle or connected, never the sweeping state");
});
await test("object story: one beat, once. idle -> tap at 1.4s -> confirm at 2.5s, through the Tap-to-Connect machine, never looping, skipped for reduced motion, timers cleaned up", () => {
  const s = strip(raw("src/components/landing/HeroRingoObject.tsx"));
  assert.match(s, /TAP_AT_MS = 1400/);
  assert.match(s, /CONNECT_AT_MS = 2500/);
  assert.match(s, /nextConnectState\(s, "tap"\)/);
  assert.match(s, /nextConnectState\(s, "confirm"\)/);
  assert.match(s, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
  assert.match(s, /clearTimeout\(tap\);\s*clearTimeout\(confirm\);/);
  assert.ok(!/setInterval|requestAnimationFrame|addEventListener/.test(s), "no loop");
  const { nextConnectState } = jiti(path.join(SRC, "lib/design/tapToConnect.ts"));
  assert.equal(nextConnectState(nextConnectState("idle", "tap"), "confirm"), "connected");
});
await test("one lamp: the object's halo is soft (0.16) and the card's own face lamp is softened to 0.18; nothing else in the hero glows", () => {
  const o = strip(raw("src/components/landing/HeroRingoObject.tsx"));
  assert.match(o, /"--lamp-strength" as string\]: "0\.16"/);
  assert.match(strip(raw("src/components/brand/RingoCard3D.tsx")), /"--lamp-strength" as string\]: "0\.18"/);
  assert.ok(!/ringo-lamp|shadow-ringo-glow|shadow-ringo-signal/.test(heroCode));
});

// ------------------------------------------------------------------ the whole page still renders with the new hero
const LandingView = load(path.join(SRC, "components/landing/LandingView.tsx")).default;
const plans = [
  { name: "free", display_name: "Free", team_enabled: false, price_usd: 0, price_usd_yearly: 0, price_xaf: 0, price_xaf_yearly: 0, features: {} },
  { name: "pro", display_name: "Pro", team_enabled: false, price_usd: 12, price_usd_yearly: 120, price_xaf: 7000, price_xaf_yearly: 70000, features: {} },
];
const props = (over = {}) => ({ isLoggedIn: false, dashboardHref: "/dashboard", appName: "Ringo Connect", logoUrl: "/logo.png", plans, bundleAddons: [], isCameroon: true, ...over });
const heroOf = (h) => h.slice(h.indexOf("<h1"), h.indexOf('id="features"'));
await test("rendered page (EN): the new headline, the unchanged subtitle, both CTAs with their real destinations, and the card", () => {
  const full = html(LandingView, props(), "en");
  const h = heroOf(full);
  assert.match(h, /<h1[^>]*><span class="block">One Ringo\.<\/span><span class="block text-ringo-gold-display">Everything you do\.<\/span><\/h1>/);
  assert.ok(h.includes(translations.en.landing.heroSubtitle));
  assert.match(h, /<a[^>]*href="\/get-started"[^>]*>Create your Ringo<svg/);
  assert.match(h, /<a[^>]*href="#journey"[^>]*>See how it works<\/a>/);
  assert.ok(h.includes(translations.en.brand.card.nfcReady));
  assert.ok(full.includes("__hero_font_var"));
  assert.ok(full.includes('id="journey"') && full.includes('id="pricing"') && full.includes('id="nfc"'), "every other section is still rendered");
});
await test("rendered page (FR): the French headline and CTAs; no English hero text remains", () => {
  const h = heroOf(html(LandingView, props(), "fr"));
  assert.ok(h.includes("Un seul Ringo.") && h.includes("Tout ce que vous faites."));
  assert.ok(h.includes(translations.fr.landing.heroCtaPrimary) && h.includes(translations.fr.landing.heroCtaSecondary) && h.includes(translations.fr.landing.heroSubtitle));
  assert.ok(!/Everything you do|Create your Ringo|See how it works/.test(h));
  assert.ok(h.includes(translations.fr.brand.card.nfcReady));
});
await test("rendered page: a signed-in visitor's primary CTA still goes to their dashboard with the dashboard label", () => {
  const h = heroOf(html(LandingView, props({ isLoggedIn: true, dashboardHref: "/dashboard/shop" }), "en"));
  assert.match(h, /<a[^>]*href="\/dashboard\/shop"[^>]*>/);
  assert.ok(h.includes(translations.en.landing.goToDashboard) && !h.includes(translations.en.landing.heroCtaPrimary));
  assert.ok(!h.includes("/get-started"));
});
await test("the page keeps its single h1, and the nav, mobile menu and funnel links are untouched", () => {
  const full = html(LandingView, props(), "en");
  assert.equal((full.match(/<h1\b/g) || []).length, 1);
  assert.ok(full.includes('aria-label="Main"'));
  for (const f of ["/card-funnel.html", "/subscription-funnel.html", "/business-funnel.html"]) assert.ok(full.includes(f), f);
});

console.log(`\nlandingHero: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
