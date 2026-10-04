// Phase 2: the complete landing page as one story on one visual language ("warm technology").
// Visual and structural only: destinations, funnels, SEO, pricing logic, language behavior and product truth must be exactly what they were.
// Real components are server-rendered in EN and FR; layout at 320-1440px, motion and pixels are verified in the browser harness.
//   Run:  node scripts/tests/landingStory.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const LANDING = path.join(SRC, "components/landing");
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
const landingFiles = fs.readdirSync(LANDING).filter((f) => /\.(tsx|ts)$/.test(f));
const landingSrc = (f) => strip(raw(`src/components/landing/${f}`));

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

const LandingView = load(path.join(SRC, "components/landing/LandingView.tsx")).default;
const plan = (id, name, display, team, usd, xaf) => ({ id, name, display_name: display, team_enabled: team, price_usd: usd, price_usd_yearly: usd * 10, price_xaf: xaf, price_xaf_yearly: xaf * 10, features_en: ["One page"], features_fr: ["Une page"], max_team_seats: team ? 3 : null });
const plans = [plan("a", "free", "Free", false, 0, 0), plan("b", "basic", "Basic", false, 5, 3000), plan("c", "pro", "Pro", false, 12, 7000)];
const props = (over = {}) => ({ isLoggedIn: false, dashboardHref: "/dashboard", appName: "Ringo Connect", logoUrl: "/logo.png", plans, bundleAddons: [], isCameroon: true, ...over });
const pageEN = html(LandingView, props(), "en");
const pageFR = html(LandingView, props(), "fr");

// ------------------------------------------------------------------ the story: order, rhythm, hierarchy
const sectionTones = (h) => [...h.matchAll(/<section(?: id="[^"]*")? class="([^"]*)"/g)].map((m) => (m[1].includes("bg-ringo-ink") ? "ink" : m[1].includes("bg-ringo-surface") ? "quiet" : "paper"));
await test("story order: hero, idea, connection, industries, restaurant, card, commerce, how it works, pricing, path picker, affiliate, close", () => {
  const t = translations.en;
  const at = (s) => {
    const i = pageEN.indexOf(s);
    assert.ok(i > 0, "missing: " + s);
    return i;
  };
  const marks = [t.landing.heroTitleLead, t.landing.ecosystemTitle, t.landing.africaTitle, t.landing.industriesTitle, t.landing.restaurantTitle, t.landing.nfcTitle, t.landing.commerceTitle, t.landing.journeyTitle, t.landing.pricingTitle, t.landing.pathPickerHeading, t.landing.affiliateTitle, t.landing.contactTitle, t.landing.footerTagline].map(at);
  assert.deepEqual([...marks].sort((a, b) => a - b), marks, "sections appear in the story order");
  assert.equal((pageEN.match(/<h1\b/g) || []).length, 1, "still one h1");
  assert.equal((pageFR.match(/<h1\b/g) || []).length, 1);
});
await test("rhythm: light and dark alternate on purpose (hero, quiet, ink, paper, quiet, ink, paper, quiet, paper, quiet, paper, ink); never two dark sections in a row except the close and the footer", () => {
  const tones = sectionTones(pageEN);
  assert.deepEqual(tones, ["paper", "quiet", "ink", "paper", "quiet", "ink", "paper", "quiet", "paper", "quiet", "paper", "ink"]);
  for (let i = 1; i < tones.length; i++) assert.ok(!(tones[i] === "ink" && tones[i - 1] === "ink"), "ink twice in a row at " + i);
  assert.ok(pageEN.includes('<footer class="border-t border-ringo-paper/10 bg-ringo-ink'), "the footer continues the closing ink");
});
await test("every nav, footer and hero anchor still has a section to land on", () => {
  const hrefs = [...new Set([...pageEN.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(hrefs.sort(), ["features", "industries", "journey", "nfc", "pricing", "restaurant"]);
  for (const id of hrefs) assert.equal((pageEN.match(new RegExp(`<section id="${id}"`, "g")) || []).length, 1, id);
});
await test("hierarchy: nothing outranks the hero. Display headings share one size ladder; the close is smaller than the hero; exactly one h1", () => {
  const section = landingSrc("Section.tsx");
  assert.match(section, /text-\[2rem\] sm:text-4xl lg:text-\[2\.75rem\] font-semibold/);
  const hero = strip(raw("src/components/landing/LandingView.tsx"));
  assert.match(hero, /lg:text-\[4rem\] font-semibold/);
  assert.match(landingSrc("ClosingSection.tsx"), /text-\[2\.5rem\] font-semibold leading-\[1\.02\] tracking-\[-0\.03em\] text-balance sm:text-6xl/);
  assert.ok(!/<h1/.test(landingFiles.filter((f) => f !== "LandingView.tsx").map((f) => landingSrc(f)).join("\n")), "no other h1");
});

// ------------------------------------------------------------------ one visual language
const DEMO_FILES = ["RestaurantShowcase.tsx", "IndustryShowcase.tsx", "PhoneMockup.tsx", "CommerceStory.tsx"];
await test("one palette: no indigo, coral, teal, green, amber or per-section brand colors anywhere on the landing page, except inside the product demonstrations", () => {
  const off = /ringo-indigo|ringo-coral|ringo-teal|#4F46E5|#FF6B4A|#14B8A6|#1F9D55|#F2B705|#7C3AED|#0EA5E9|#E11D48|#DB2777|#65A30D|#D97706|#25D366|hexToRgba|indigo-|violet|amber-/;
  const offenders = landingFiles.filter((f) => !DEMO_FILES.includes(f) && off.test(landingSrc(f)));
  assert.deepEqual(offenders, []);
  // the demonstrations keep the product's own look (a creator's theme), and are named here on purpose
  for (const f of ["RestaurantShowcase.tsx", "IndustryShowcase.tsx"]) assert.ok(/#[0-9A-Fa-f]{6}/.test(landingSrc(f)), f + " is a product demo");
});
await test("no rainbow: no per-item color arrays, no colored dots, no colored section headers", () => {
  for (const f of landingFiles.filter((f) => !DEMO_FILES.includes(f))) {
    const s = landingSrc(f);
    assert.ok(!/color:\s*"#/.test(s) && !/backgroundColor:\s*item\.color|style=\{\{\s*backgroundColor:\s*"#/.test(s), f);
  }
  assert.ok(!/color: "#/.test(strip(raw("src/components/landing/LandingView.tsx"))), "the nav dropdown items carry no brand colors");
  assert.ok(!/color: string/.test(landingSrc("NavDropdown.tsx")));
});
await test("no eyebrows or kickers: the section eyebrow strings still exist but no landing component prints them", () => {
  for (const key of ["ecosystemEyebrow", "moreEyebrow", "industriesEyebrow", "restaurantEyebrow", "pricingEyebrow", "journeyEyebrow", "nfcEyebrow", "commerceEyebrow", "connectionEyebrow", "africaEyebrow", "whyEyebrow", "affiliateEyebrow", "contactEyebrow", "heroEyebrow"]) {
    assert.equal(typeof translations.en.landing[key], "string", key);
    assert.ok(!landingFiles.some((f) => landingSrc(f).includes(key)), key + " is not printed");
  }
  assert.ok(!/uppercase tracking-\[0\.14em\]|tracking-\[0\.14em\] uppercase/.test(landingFiles.map((f) => landingSrc(f)).join("\n")));
});
await test("typography: Bricolage (ringo-display) for display, Inter for body; no Manrope, no Fraunces, no leftover font-display on the landing, no private font loads", () => {
  const all = landingFiles.map((f) => landingSrc(f)).join("\n");
  assert.ok(!/Manrope|Fraunces|next\/font\/google/.test(all.replace(/import \{ Bricolage_Grotesque \} from "next\/font\/google";/, "")), "only heroFont.ts loads a font");
  const nonDemo = landingFiles.filter((f) => !DEMO_FILES.includes(f)).map((f) => landingSrc(f)).join("\n");
  assert.ok(!/(?<![-\w])font-display\b/.test(nonDemo.replace(/var\(--font-display\)/g, "")), "display text uses ringo-display (the product demos keep the profile display face)");
  assert.ok((all.match(/ringo-display/g) || []).length >= 15, "ringo-display is used throughout");
  assert.match(raw("src/app/globals.css"), /\.ringo-display \{\s*font-family: var\(--font-hero-display\), var\(--font-display\), sans-serif;/);
  assert.equal(git("diff --stat HEAD -- src/app/layout.tsx").trim(), "", "the root layout and the site fonts are untouched");
});
await test("mono is only for meaning: the micro-language appears on the Ringo Card, never as a heading label (no landing component uses it)", () => {
  const all = landingFiles.map((f) => landingSrc(f)).join("\n");
  assert.ok(!/font-micro|ringo-micro|MicroLabel/.test(all));
});
await test("foundation tokens only: warm borders, the radius ladder, the elevation scale; no private shadows or radii outside the demos", () => {
  for (const f of landingFiles.filter((f) => !DEMO_FILES.includes(f))) {
    const s = landingSrc(f).replace(/rounded-md object-contain/g, ""); // a custom (admin-uploaded) logo keeps its original markup
    assert.ok(!/shadow-\[|rounded-\[|rounded-(2xl|3xl|xl|lg|md|sm)\b|border-ringo-border|bg-white|text-white/.test(s), f + ": " + (s.match(/shadow-\[[^\]]*\]|rounded-\[[^\]]*\]|rounded-(?:2xl|3xl|xl|lg|md|sm)\b|border-ringo-border|bg-white|text-white/) || [""])[0]);
  }
  const demo = landingSrc("CommerceStory.tsx");
  assert.ok(demo.includes("bg-white"), "the receipt is white paper, on purpose: a physical object");
});
await test("glass: only the header uses it, with the one foundation recipe", () => {
  const users = landingFiles.filter((f) => /ringo-glass|backdrop-|blur-/.test(landingSrc(f)));
  assert.deepEqual(users, ["LandingView.tsx"]);
  assert.match(landingSrc("LandingView.tsx"), /className="ringo-glass fixed top-0/);
});
await test("lamplight: at most one lamp per section; the ink sections that have one, have exactly one", () => {
  for (const f of landingFiles) {
    const n = (landingSrc(f).match(/radial-gradient\(closest-side/g) || []).length;
    assert.ok(n <= 1, f + " has " + n);
  }
  assert.equal((landingSrc("ConnectionSection.tsx").match(/radial-gradient\(closest-side/g) || []).length, 1);
  assert.equal((landingSrc("CardStorySection.tsx").match(/radial-gradient\(closest-side/g) || []).length, 1);
  assert.equal((landingSrc("ClosingSection.tsx").match(/radial-gradient/g) || []).length, 0, "the close is lit by the Ring emblem, not a glow");
});
await test("gold is special: gold fills only on the header, hero, close and pricing primary actions (plus the sample Order button); everything else is outline or text", () => {
  const fills = landingFiles.filter((f) => /bg-ringo-gold(?!\/|-)/.test(landingSrc(f)));
  assert.deepEqual(fills.sort(), ["CommerceStory.tsx", "LandingView.tsx", "PricingSection.tsx", "Section.tsx"]);
  assert.ok(!/ringo-gilt--strong/.test(landingFiles.filter((f) => f !== "PricingSection.tsx").map((f) => landingSrc(f)).join("\n")), "the strong gilt edge belongs to the one featured plan only");
});
await test("teal means connected: it only appears as the Ring's connected state (and the card's), never as a decorative color", () => {
  for (const f of landingFiles) assert.ok(!/ringo-signal|--rc-signal|text-ringo-signal/.test(landingSrc(f)), f);
  const rings = landingFiles.map((f) => (landingSrc(f).match(/<Ring [^>]*state="connected"/g) || []).length).reduce((a, b) => a + b, 0);
  assert.ok(rings >= 3, "the connected Ring ends the card flows, the journey and the receipt: " + rings);
});

// ------------------------------------------------------------------ header and navigation
await test("header: the primary action is the hero's gold button at header size, same destination; no indigo anywhere in the nav", () => {
  const v = raw("src/components/landing/LandingView.tsx");
  const header = v.slice(v.indexOf("<header"), v.indexOf("</header>"));
  assert.ok(!/ringo-indigo|bg-ringo-indigo/.test(header));
  assert.match(v, /const headerCta = `[^`]*bg-ringo-gold text-ringo-ink[^`]*`/);
  assert.match(header, /<Link href="\/get-started" className=\{`px-3\.5 sm:px-4 \$\{headerCta\}`\}>\s*\{t\.landing\.getStarted\}/);
  assert.match(header, /<Link href=\{dashboardHref\} className=\{`lg:ml-1 w-11 sm:w-auto sm:px-4 \$\{headerCta\}`\}>/);
});
await test("header at 320px: logo, language, theme, one gold action and the menu all fit (login moves into the menu below 400px); every control is 44px", () => {
  const v = raw("src/components/landing/LandingView.tsx");
  assert.match(v, /max-\[399px\]:hidden lg:hidden px-2\.5 py-2 rounded-card/);
  assert.match(v, /min-\[400px\]:hidden flex items-center min-h-\[48px\]/);
  assert.match(v, /w-11 h-11 -mr-2 rounded-full/);
  assert.match(v, /min-h-\[44px\] rounded-full bg-ringo-gold/);
  assert.match(raw("src/app/globals.css"), /\.ringo-touch-toggles > button \{\s*width: 2\.75rem;\s*height: 2\.75rem;/);
  assert.match(pageEN, /ringo-touch-toggles/);
});
await test("header: signed-out and signed-in states keep their destinations; the mobile menu still has every link, My Ringo and Log in", () => {
  const out = pageEN;
  for (const href of ["/get-started", "/auth/login"]) assert.ok(out.includes(`href="${href}"`), href);
  assert.ok(raw("src/components/landing/LandingView.tsx").includes('href: "/my-ringo/signin"'), "My Ringo stays in the desktop dropdown and the mobile menu (closed menus are not in the server HTML)");
  const inn = html(LandingView, props({ isLoggedIn: true, dashboardHref: "/dashboard/shop" }), "en");
  assert.ok(inn.includes('href="/dashboard/shop"') && inn.includes(translations.en.landing.goToDashboard));
  assert.ok(!/<header[\s\S]*href="\/get-started"[\s\S]*<\/header>/.test(inn), "no sign-up button for a signed-in visitor");
});
await test("nav dropdown: one monochrome treatment, a 44px trigger, warm hairline, a themed focus ring", () => {
  const s = landingSrc("NavDropdown.tsx");
  assert.match(s, /min-h-\[44px\]/);
  assert.match(s, /bg-ringo-gold\/15 text-ringo-gold-text/);
  assert.match(s, /rounded-ringo-md border border-ringo-line-warm bg-ringo-surface shadow-ringo-3/);
  assert.ok(!/\$\{item\.color\}/.test(s));
});

// ------------------------------------------------------------------ language: first paint untouched, both languages complete
await test("language behavior is unchanged: the provider, its fallback and its resolution are byte-identical to HEAD (first-paint flash documented, not re-architected)", () => {
  assert.equal(git("diff --stat HEAD -- src/components/LanguageProvider.tsx src/lib/i18n/locales.ts src/components/LanguageToggle.tsx").trim(), "");
});
await test("French page: every section is French; no English landing string leaks (checked against all landing strings that differ between languages)", () => {
  const en = translations.en.landing;
  const fr = translations.fr.landing;
  const leaks = [];
  for (const key of Object.keys(en)) {
    if (typeof en[key] !== "string" || en[key].length < 18 || en[key] === fr[key]) continue;
    if (pageFR.includes(en[key])) leaks.push(key);
  }
  assert.deepEqual(leaks, []);
  for (const s of ["Un seul Ringo.", translations.fr.landing.ecosystemTitle, translations.fr.landing.africaTitle, translations.fr.landing.commerceTitle, translations.fr.landing.nfcTitle, translations.fr.landing.pricingTitle, translations.fr.landing.contactTitle, translations.fr.landing.commerceDemoProduct, translations.fr.landing.commerceStepSaleBody]) assert.ok(pageFR.includes(s), s);
});
await test("the page has no hard-coded English prose left: the old About section (English only) is gone, and new strings exist in both languages", () => {
  assert.ok(!fs.existsSync(path.join(LANDING, "AboutSection.tsx")));
  assert.ok(!pageEN.includes("About Ringo Connect") && !pageEN.includes("MTN and Orange"));
  const en = translations.en.landing;
  const fr = translations.fr.landing;
  for (const k of Object.keys(en).filter((k) => /^commerce(Step|Demo)/.test(k))) {
    assert.equal(typeof fr[k], "string", k);
    if (k !== "commerceDemoMethod") assert.notEqual(en[k], fr[k], k);
  }
});

// ------------------------------------------------------------------ product truth and behavior
await test("destinations: every link the page had still exists (funnels, get-started, plans, WhatsApp, mail, phone, legal) and nothing new points off-site", () => {
  const hrefs = new Set([...pageEN.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
  for (const h of ["/get-started", "/auth/login", "/card-funnel.html", "/subscription-funnel.html", "/business-funnel.html", "/terms", "/privacy", "mailto:info@ringoconnectltd.com", "tel:+237694028846", "https://wa.me/237694028846", "/get-started?plan=pro", "/get-started?plan=basic", "/get-started?plan=free"]) assert.ok(hrefs.has(h), h);
  assert.ok([...hrefs].some((h) => h.startsWith("https://wa.me/237694028846?text=")), "the affiliate WhatsApp link");
  const external = [...hrefs].filter((h) => /^https?:/.test(h) && !h.startsWith("https://wa.me/237694028846"));
  assert.deepEqual(external, []);
  const before = gitShow("src/components/landing/LandingView.tsx");
  for (const h of ["/get-started", "/auth/login", "/my-ringo/signin", "mailto:info@ringoconnectltd.com", "tel:+237694028846", "https://wa.me/237694028846", "/terms", "/privacy"]) assert.ok(before.includes(h), "existed before: " + h);
});
await test("funnels: the path picker keeps its destinations, its association gate and the referral forwarding exactly", () => {
  const s = raw("src/components/landing/PathPickerSection.tsx");
  for (const h of ["/card-funnel.html", "/subscription-funnel.html", "/business-funnel.html", "/get-started-association"]) assert.ok(s.includes(`"${h}"`), h);
  assert.match(s, /const withRef = \(href: string\) => \(ref \? `\$\{href\}\?ref=\$\{encodeURIComponent\(ref\)\}` : href\);/);
  assert.match(s, /setRef\(getReferralCode\(\)\)/);
  assert.match(s, /ASSOCIATION_PUBLIC \? \[/);
  const before = gitShow("src/components/landing/PathPickerSection.tsx");
  for (const h of ["/card-funnel.html", "/subscription-funnel.html", "/business-funnel.html", "/get-started-association"]) assert.ok(before.includes(`"${h}"`) || before.includes(`href: "${h}"`), "same destination as before: " + h);
  assert.equal(git("status --porcelain -- public").trim(), "", "the static funnel files are untouched");
});
await test("pricing: only the look changed. Everything but class names is identical to HEAD (plans, prices, tracks, billing, links, the card-bundle grid rule)", () => {
  const norm = (s) => s.replace(/\s*className=\{`[^`]*`\}/g, "").replace(/\s*className="[^"]*"/g, "").replace(/\s+/g, " ").trim();
  assert.equal(norm(raw("src/components/landing/PricingSection.tsx")), norm(gitShow("src/components/landing/PricingSection.tsx")));
  assert.match(raw("src/components/landing/PricingSection.tsx"), /bundleAddons\.length >= 3 \? "max-w-5xl sm:grid-cols-3" : "max-w-3xl sm:grid-cols-2"/);
});
await test("pricing look: the featured plan is the one gilt object; checks are gold-dark text not teal; no indigo; primary is gold, others outline; toggles are 44px", () => {
  const s = landingSrc("PricingSection.tsx");
  assert.match(s, /"ringo-gilt ringo-gilt--strong ringo-lamp \[--lamp-y:18%\] \[--lamp-size:280px\] \[--lamp-strength:0\.22\] bg-ringo-ink text-ringo-paper shadow-ringo-3 sm:-my-4 sm:py-10"/);
  assert.match(s, /: "border border-ringo-line-warm"/, "the other plans are open sheets: a hairline, no fill, no shadow");
  assert.equal((s.match(/text-ringo-gold-text/g) || []).length >= 3, true, "gold-dark checks and seats on the paper sheets");
  assert.ok(!/ringo-indigo|ringo-teal/.test(s));
  assert.match(s, /"bg-ringo-gold text-ringo-ink shadow-ringo-2 hover:brightness-105 focus-visible:outline-ringo-paper"/, "the gold action on the Ink object gets a paper focus ring");
  assert.equal((s.match(/min-h-\[44px\]/g) || []).length, 1);
  assert.equal((s.match(/ringo-lamp /g) || []).length, 1, "one lamp: the featured plan only");
  const html2 = html(LandingView, props(), "en");
  assert.ok(html2.includes("ringo-gilt--strong") && (html2.match(/ringo-gilt--strong/g) || []).length === 1, "exactly one featured plan");
});
await test("affiliate: same link, same copy keys, same points, no commission rate; presented as part of the page", () => {
  const s = raw("src/components/landing/AffiliateSection.tsx");
  assert.ok(s.includes('`https://wa.me/237694028846?text=${encodeURIComponent("Hi! I\'d like to become a Ringo Connect affiliate.")}`'));
  for (const k of ["affiliateTitle", "affiliateSubtitle", "affiliatePointLink", "affiliatePointShare", "affiliatePointEarn", "affiliatePointPayout", "affiliateCta"]) assert.ok(s.includes(`t.landing.${k}`), k);
  assert.ok(!/\d+\s?%/.test(s), "no commission rate");
  assert.ok(!/#0B0B12|#F2B705/.test(s), "no separate dark / yellow affiliate world");
});
await test("close and footer: the hero's own headline, the same gold button, the existing contact ways, and every footer link from before", () => {
  const close = pageEN.slice(pageEN.indexOf(translations.en.landing.finalCtaSubtitle) - 600, pageEN.indexOf("<footer"));
  assert.ok(close.includes(translations.en.landing.heroTitleLead) && close.includes(translations.en.landing.heroTitleRest));
  assert.match(close, /href="\/get-started"[^>]*>Create My Ringo/);
  assert.match(close, /href="\/auth\/login"[^>]*>Log In/);
  assert.match(close, /href="https:\/\/wa\.me\/237694028846" target="_blank" rel="noopener noreferrer"/);
  assert.match(close, /href="mailto:info@ringoconnectltd\.com"/);
  const footer = pageEN.slice(pageEN.indexOf("<footer"));
  for (const h of ["#features", "#pricing", "#nfc", "#industries", "#restaurant", "/terms", "/privacy", "mailto:info@ringoconnectltd.com", "tel:+237694028846"]) assert.ok(footer.includes(`href="${h}"`), h);
  assert.ok(footer.includes("Yaoundé, Cameroon") && footer.includes(String(new Date().getFullYear())) && footer.includes(translations.en.landing.footerRights));
  assert.ok(footer.includes('src="/brand/ringo-logo-dark.png"') || footer.includes("ringo-logo-dark"), "the light logo variant sits on the dark footer");
});
await test("commerce story: four true beats and a sample; Mobile Money only 'where enabled'; no payment code, no new payment method named", () => {
  const s = landingSrc("CommerceStory.tsx");
  assert.ok(!/fetch\(|fapshi|stripe|checkout|api\//i.test(s));
  const en = translations.en.landing;
  assert.match(en.commerceStepSaleBody, /Mobile Money, where enabled/);
  assert.ok(!/Visa|Mastercard|PayPal|card payment|Orange|MTN|Apple Pay|crypto/i.test(JSON.stringify([en, translations.fr.landing].map((l) => Object.entries(l).filter(([k]) => /^commerce(Step|Demo)/.test(k))))));
  assert.match(s, /aria-hidden="true" className="relative mx-auto flex w-full max-w-\[420px\]/);
});
await test("Africa-first through product truth: the five existing statements, in order, with no flags, patterns, maps or stereotype imagery", () => {
  const en = translations.en.landing;
  const idx = ["africaPointMobile", "africaPointWhatsapp", "africaPointQrNfc", "africaPointMoney", "africaPointLocal"].map((k) => pageEN.indexOf(en[k]));
  assert.ok(idx.every((i) => i > 0) && [...idx].sort((a, b) => a - b).join() === idx.join());
  const all = landingFiles.map((f) => landingSrc(f)).join("\n");
  assert.ok(!/flag|\u{1F1E8}|tribal|kente|ankara-pattern|continent|silhouette|<img|background-image|url\(/iu.test(all.replace(/Ankara dress/g, "")), "no cliché imagery");
});
await test("the sample content is illustration: the card, the commerce picture, the phone mock and the menu mock are hidden from assistive technology", () => {
  assert.match(landingSrc("CardStorySection.tsx"), /ref=\{ref\} aria-hidden="true"/);
  assert.match(landingSrc("CommerceStory.tsx"), /<div aria-hidden="true" className="relative mx-auto flex/);
  assert.match(landingSrc("IndustryShowcase.tsx"), /<div aria-hidden="true">\s*<PhoneMockup>/);
  assert.match(landingSrc("RestaurantShowcase.tsx"), /<div aria-hidden="true" className="rounded-ringo-lg/);
  assert.match(landingSrc("HeroRingoObject.tsx"), /aria-hidden="true"/);
  assert.match(landingSrc("ClosingSection.tsx"), /aria-hidden="true"\s+className="pointer-events-none absolute -right-24/);
  assert.match(landingSrc("EcosystemDiagram.tsx"), /preserveAspectRatio="none" aria-hidden="true"/);
  assert.match(landingSrc("IndustryShowcase.tsx"), /aria-pressed=\{tab === tb\.id\}/, "the tabs expose their state");
});

// ------------------------------------------------------------------ motion
await test("Reveal: the server renders content visible; blocks are hidden only after hydration, only below the fold and never for reduced motion (the old version left the whole page invisible for reduced-motion visitors)", () => {
  const Reveal = load(path.join(LANDING, "Reveal.tsx")).default;
  const out = html(Reveal, { children: React.createElement("p", null, "x"), delay: 0.1, className: "c" });
  assert.equal(out, '<div class="c" style="transition-delay:0.1s"><p>x</p></div>');
  assert.ok(!/opacity|transform/.test(out), "no inline hidden state from the server");
  const s = landingSrc("Reveal.tsx");
  assert.match(s, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
  assert.match(s, /getBoundingClientRect\(\)\.top < window\.innerHeight \* 0\.92\) return;/);
  assert.match(s, /dataset\.reveal = "armed"/);
  assert.ok(!/framer-motion/.test(s), "Reveal no longer needs the animation library");
  const css = raw("src/app/globals.css");
  assert.match(css, /\[data-reveal="armed"\] \{\s*opacity: 0;\s*transform: translateY\(18px\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\[data-reveal\] \{\s*opacity: 1 !important;/);
});
await test("motion budget: the hero and the Card story each play one beat, once; reduced motion skips both; no looping animation was added to the landing page", () => {
  const card = landingSrc("CardStorySection.tsx");
  assert.match(card, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(card, /io\.disconnect\(\);\s*timers\.push/, "it fires once");
  assert.ok(!/\bsetInterval\(|requestAnimationFrame|animate-|infinite/.test(landingFiles.map((f) => landingSrc(f)).join("\n")));
  assert.equal((landingFiles.map((f) => landingSrc(f)).join("\n").match(/<Reveal\b/g) || []).length <= 30, true);
});
await test("stagger and timings use the foundation: Reveal delays are at most five steps (0, 0.1, 0.15)", () => {
  const delays = new Set();
  for (const f of landingFiles) for (const m of landingSrc(f).matchAll(/<Reveal delay=\{([\d.]+)\}/g)) delays.add(Number(m[1]));
  assert.ok([...delays].every((d) => d <= 0.25), [...delays].join());
  assert.ok(delays.size <= 5);
});

// ------------------------------------------------------------------ cards, rings, object reuse
await test("one card renderer: the hero and the Card story both use the foundation's RingoCard3D; no second card implementation anywhere", () => {
  const users = landingFiles.filter((f) => /<RingoCard3D/.test(landingSrc(f))).sort();
  assert.deepEqual(users, ["CardStorySection.tsx", "HeroRingoObject.tsx"]);
  assert.ok(!/preserve-3d|rotateX|rotateY|perspective/.test(landingFiles.filter((f) => f !== "PhoneMockup.tsx").map((f) => landingSrc(f)).join("\n")), "no private 3D code in the landing components (the phone bezel's own tilt is the one pre-existing exception)");
  assert.ok(!/<canvas|webgl|three|\.mp4|<video|lottie/i.test(landingFiles.map((f) => landingSrc(f)).join("\n")));
});
await test("the Ring is the page's signature: the hub of the diagram, the end of the Card flows, the last journey step, the receipt and the close", () => {
  const users = landingFiles.filter((f) => /<Ring\b/.test(landingSrc(f))).sort();
  assert.deepEqual(users, ["CardStorySection.tsx", "ClosingSection.tsx", "CommerceStory.tsx", "ConnectionSection.tsx", "EcosystemDiagram.tsx", "JourneySteps.tsx"]);
  assert.ok(!landingFiles.some((f) => /state="waiting"/.test(landingSrc(f))), "no landing Ring sweeps on its own");
});

// ------------------------------------------------------------------ final polish pass
await test("polish 1, the phone: its screen is as tall as the tallest sample profile needs (440px), not a fixed 560px void", () => {
  const s = landingSrc("PhoneMockup.tsx");
  assert.match(s, /const PHONE_SCREEN_HEIGHT = 440;/);
  assert.match(s, /style=\{\{ height: PHONE_SCREEN_HEIGHT \}\}/);
  assert.ok(!/height: 560/.test(s));
  assert.match(landingSrc("IndustryShowcase.tsx"), /AnimatePresence mode="wait" initial=\{false\}/, "still no entrance on load");
  for (const t of ["Artist", "Restaurant", "Business"]) assert.ok(landingSrc("IndustryShowcase.tsx").includes(t === "Artist" ? "ArtistMockup" : t === "Restaurant" ? "RestaurantMockup" : "BusinessMockup"), t + " demo kept");
});
await test("polish 2, the Ring: a 'fine' weight exists; the default is byte-identical to before; only the closing emblem uses it", () => {
  const Ring = load(path.join(SRC, "components/brand/Ring.tsx")).default;
  const regular = html(Ring, { state: "idle", size: 48 });
  const withProp = html(Ring, { state: "idle", size: 48, weight: "regular" });
  assert.equal(regular, withProp, "weight defaults to regular");
  assert.ok(regular.includes('stroke-width="6"') && regular.includes('r="8"') && !regular.includes("2.5"));
  const fine = html(Ring, { state: "idle", size: 560, weight: "fine" });
  assert.ok(fine.includes('stroke-width="2.5"') && fine.includes('r="4.5"') && !fine.includes('stroke-width="6"'));
  assert.ok(html(Ring, { state: "connected", weight: "fine" }).includes("ringo-ring-close"), "the closing animation still exists for the fine weight");
  assert.ok(html(Ring, { state: "idle", weight: "fine", label: "x" }).includes('role="img"'), "accessibility is unchanged");
  const users = landingFiles.filter((f) => /weight="fine"/.test(landingSrc(f)));
  assert.deepEqual(users, ["ClosingSection.tsx"]);
  assert.match(landingSrc("ClosingSection.tsx"), /<Ring size=\{560\} state="idle" weight="fine"/);
});
await test("polish 3, the Africa-first thread: one illustration (profile product with its WhatsApp action, the message it sends, the customer), real strings in both languages, no payment shown, hidden from assistive tech, not a second phone", () => {
  const s = landingSrc("ConnectionSection.tsx");
  assert.match(s, /function ConnectionThread\(\)/);
  assert.match(s, /aria-hidden="true"\s+className="mx-auto w-full max-w-\[380px\]/);
  assert.ok(!/fetch\(|fapshi|stripe|checkout|api\//i.test(s), "no payment or network code");
  assert.ok(!/Mobile Money|commerceDemoMethod|commerceDemoPaid/.test(s.replace(/africaPointMoney/g, "")), "no payment is shown in the thread; Mobile Money stays in the 'where enabled' statement");
  assert.ok(!/bezel|rounded-\[2|<PhoneMockup|IndustryShowcase/.test(s), "not another phone mockup");
  for (const lang of ["en", "fr"]) {
    const l = translations[lang].landing;
    const page = lang === "en" ? pageEN : pageFR;
    for (const k of ["connectionDemoAsk", "connectionDemoReply", "nfcFlowProfile", "chipWhatsapp", "connectionFlowCustomer", "commerceDemoProduct"]) assert.ok(page.includes(l[k]), lang + " " + k);
    assert.notEqual(translations.en.landing.connectionDemoAsk, translations.fr.landing.connectionDemoAsk);
    assert.notEqual(translations.en.landing.connectionDemoReply, translations.fr.landing.connectionDemoReply);
  }
  assert.equal(translations.en.landing.connectionDemoAsk, "Hi, I'm interested in the Tailored Ankara dress.", "the product page's own message wording");
  assert.ok(/Hi, I'm interested in \$\{product\.name\}/.test(raw("src/components/catalog/ProductDetailView.tsx")), "the real WhatsApp message it mirrors exists in the product");
  const ens = ["africaPointMobile", "africaPointWhatsapp", "africaPointQrNfc", "africaPointMoney", "africaPointLocal"];
  assert.ok(ens.every((k) => s.includes(`l.${k}`)), "the five true statements are all still there");
  assert.match(translations.en.landing.africaPointMoney, /where enabled/);
});
await test("polish 4, pricing: the featured plan is one Ink object (strong gilt, one lamp, taller) among open sheets; data, text, links and logic unchanged", () => {
  const html2 = html(LandingView, props(), "en");
  const grid = html2.slice(html2.indexOf('id="pricing"'), html2.indexOf("</section>", html2.indexOf('id="pricing"')));
  assert.equal((grid.match(/ringo-gilt--strong/g) || []).length, 1);
  assert.equal((grid.match(/ringo-lamp/g) || []).length, 1);
  assert.equal((grid.match(/bg-ringo-ink/g) || []).length, 1);
  assert.ok(grid.includes("sm:items-center") && grid.includes("sm:-my-4"));
  // the plans, prices and links are exactly what the data says
  for (const [n, p] of [["free", "0"], ["basic", "3,000"], ["pro", "7,000"]]) assert.ok(grid.includes(`href="/get-started?plan=${n}"`), n);
  assert.ok(grid.includes("3,000") && grid.includes("7,000") && grid.includes(translations.en.landing.pricingMostPopular));
  const norm = (t) => t.replace(/\s*className=\{`[^`]*`\}/g, "").replace(/\s*className="[^"]*"/g, "").replace(/\s+/g, " ").trim();
  assert.equal(norm(raw("src/components/landing/PricingSection.tsx")), norm(gitShow("src/components/landing/PricingSection.tsx")));
});

// ------------------------------------------------------------------ performance and scope
await test("no new dependency, no image payload, no new font: package files identical, the only font load is the hero's Bricolage", () => {
  assert.equal(git("diff --stat HEAD -- package.json package-lock.json").trim(), "");
  assert.ok(!/<Image|next\/image/.test(landingFiles.filter((f) => f !== "LandingView.tsx" && f !== "ClosingSection.tsx").map((f) => landingSrc(f)).join("\n")), "no new images (the two logo spots are the existing ones)");
  assert.equal(git("status --porcelain -- public").trim(), "");
});
await test("scope: no auth, payment, billing, settlement, inventory, profile, dashboard, commerce-app, API, SEO or branding file changed", () => {
  const changed = git("status --porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).replace(/"/g, "").replace(/\\/g, "/"));
  const protectedPath = /^(package(-lock)?\.json|\.env|supabase\/|migrations\/|public\/|src\/middleware\.ts|src\/app\/(page|layout)\.tsx|src\/app\/api\/|src\/app\/\[username\]\/|src\/app\/dashboard\/|src\/app\/auth\/|src\/lib\/(theme|branding|brandingDefaults|categories)\.ts|src\/lib\/(auth|billing|payments?|productCheckout|fapshi|stripe|shop|settlement|reports|inventory)|src\/components\/(checkout|dashboard|auth|catalog|overview|ProfileView|ShareButton)|src\/components\/LanguageProvider)/i;
  assert.deepEqual(changed.filter((f) => protectedPath.test(f)), []);
  const others = changed.filter((f) => !f.startsWith("src/components/landing/") && !/^scripts\/tests\//.test(f));
  assert.deepEqual(others.sort(), ["src/app/dev-preview-foundation/", "src/app/globals.css", "src/components/brand/", "src/lib/design/", "src/lib/i18n/translations.ts", "tailwind.config.ts"], "only the foundation files, the stylesheet, the translations and the landing folder");
});
await test("translations: only the four hero headline lines were rewritten; everything else in the file is added", () => {
  const removed = git("diff -U0 HEAD -- src/lib/i18n/translations.ts").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.equal(removed.length, 4);
  assert.ok(removed.every((l) => /hero(TitleRest|Title):/.test(l)));
});
await test("SEO is untouched: the landing route, its metadata, sitemap and robots are byte-identical to HEAD", () => {
  assert.equal(git("diff --stat HEAD -- src/app/page.tsx src/app/layout.tsx src/app/sitemap.ts src/app/robots.ts").trim(), "");
});

console.log(`\nlandingStory: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
