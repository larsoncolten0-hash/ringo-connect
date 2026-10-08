// Password visibility, the Privacy Policy and the Terms of Service (EN + FR), and the facts the policy states about cookies and tracking.
// Run: node scripts/tests/legal.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transform } = require("sucrase");
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
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

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const stubs = {
  "next/link": { __esModule: true, default: ({ href, children, ...p }) => React.createElement("a", { href, ...p }, children) },
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt }) },
};
const cache = new Map();
function load(rel) {
  const file = path.join(SRC, rel);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  if (!file.endsWith(".tsx")) {
    mod.exports = jiti(file);
    return mod.exports;
  }
  const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(id.slice(2) + (fs.existsSync(path.join(SRC, id.slice(2) + ".tsx")) ? ".tsx" : "")) : require(id));
  new Function("require", "module", "exports", code)(req, mod, mod.exports);
  return mod.exports;
}
const html = (Comp, props, initialLocale) => {
  const { LanguageProvider } = load("components/LanguageProvider.tsx");
  return renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale }, React.createElement(Comp, props)));
};

// ------------------------------------------------------------------------------------------------ passwords
await test("password audit: every ACCOUNT password field goes through the one shared FormField (login, signup, reset x2)", () => {
  const pages = { "src/app/auth/login/page.tsx": 1, "src/app/auth/signup/page.tsx": 1, "src/app/auth/reset-password/page.tsx": 2 };
  for (const [f, n] of Object.entries(pages)) {
    const s = raw(f);
    assert.equal((s.match(/type="password"/g) || []).length, n, f + ": password field count");
    assert.ok((s.match(/<FormField/g) || []).length >= n, f + ": FormField used");
    assert.ok(!/<input[^>]*type="password"/.test(s), `${f}: no raw password input bypasses FormField`);
  }
  assert.ok(!/type="password"/.test(raw("src/app/auth/forgot-password/page.tsx")), "forgot-password asks for an email only");
  assert.ok(!/type="password"/.test(raw("src/components/dashboard/ChangePasswordModal.tsx")), "change password sends the reset email; it has no password field");
  // The other password-typed inputs are secrets / API tokens (not account passwords) and stay masked on purpose.
  for (const f of ["src/components/admin/SettingsForm.tsx", "src/components/editor/PixelsCard.tsx"]) assert.ok(/type="password"/.test(raw(f)) && !/FormField/.test(raw(f)), f);
});
await test("password toggle: an accessible eye / eye-off button that only changes how the typed text is shown", () => {
  const f = strip(raw("src/components/auth/FormField.tsx"));
  assert.ok(f.includes('type="button"'), "never submits the form");
  assert.ok(f.includes("aria-label={showPassword ? t.passwordField.hide : t.passwordField.show}"));
  assert.ok(f.includes("<EyeOff") && f.includes("<Eye "), "eye / eye-off");
  assert.ok(f.includes("h-11 w-11"), "44px touch target");
  assert.ok(f.includes("focus-visible:outline"), "visible keyboard focus");
  assert.ok(f.includes('const inputType = isPassword && showPassword ? "text" : type;'), "only the input's type changes");
  assert.ok(f.includes("autoComplete={autoComplete}") && f.includes("required={required}") && f.includes("onChange={(e) => onChange(e.target.value)}"), "validation, autocomplete and the value are untouched");
  assert.ok(!/localStorage|sessionStorage|console\.|fetch\(|document\.cookie|track|analytics/i.test(f), "the password is never stored, logged or sent anywhere");
  assert.ok(!/aria-pressed/.test(f), "the label itself says Show / Hide");
});
await test("password toggle labels: Show / Hide password and Afficher / Masquer le mot de passe, rendered", () => {
  assert.deepEqual(translations.en.passwordField, { show: "Show password", hide: "Hide password" });
  assert.deepEqual(translations.fr.passwordField, { show: "Afficher le mot de passe", hide: "Masquer le mot de passe" });
  const FormField = load("components/auth/FormField.tsx").default;
  const props = { label: "Password", type: "password", value: "x", onChange() {}, autoComplete: "current-password" };
  const en = html(FormField, props, "en");
  const fr = html(FormField, props, "fr");
  assert.ok(en.includes('aria-label="Show password"') && en.includes('type="password"') && en.includes('autoComplete="current-password"') || en.includes('autocomplete="current-password"'));
  assert.ok(fr.includes('aria-label="Afficher le mot de passe"'));
  const text = html(FormField, { ...props, type: "text" }, "en");
  assert.ok(!text.includes("<button"), "a non-password field gets no toggle");
});

// ------------------------------------------------------------------------------------------------ legal documents
const docs = {
  privacy: { en: jiti(path.join(SRC, "lib/legal/privacy.en.ts")).privacyEn, fr: jiti(path.join(SRC, "lib/legal/privacy.fr.ts")).privacyFr },
  terms: { en: jiti(path.join(SRC, "lib/legal/terms.en.ts")).termsEn, fr: jiti(path.join(SRC, "lib/legal/terms.fr.ts")).termsFr },
  cookies: { en: jiti(path.join(SRC, "lib/legal/cookies.en.ts")).cookiesEn, fr: jiti(path.join(SRC, "lib/legal/cookies.fr.ts")).cookiesFr },
};
const shape = (d) => d.sections.map((s) => `${s.id}:${s.blocks.map((b) => Object.keys(b)[0] + ("ul" in b ? b.ul.length : "")).join(",")}`).join("|");
await test("Privacy, Terms and Cookie Policy: English and French have the same sections and the same blocks", () => {
  for (const k of ["privacy", "terms", "cookies"]) {
    assert.equal(shape(docs[k].en), shape(docs[k].fr), k);
    assert.equal(docs[k].en.sections.length, { privacy: 30, terms: 33, cookies: 8 }[k], `${k}: every requested topic has a section`);
    assert.equal(docs[k].en.intro.length, docs[k].fr.intro.length);
    for (const l of ["en", "fr"]) {
      const d = docs[k][l];
      assert.ok(d.title && d.description && d.updated && d.intro.length, `${k}.${l}`);
      assert.equal(new Set(d.sections.map((s) => s.id)).size, d.sections.length, "unique section ids (anchors)");
    }
  }
  assert.equal(docs.privacy.en.updated, "October 8, 2026");
  assert.equal(docs.privacy.fr.updated, "8 octobre 2026");
});
await test("legal safety: no compliance or certification claims, no invented company details, no 'Admin' in outward copy, the real contact only", () => {
  const all = JSON.stringify(docs);
  assert.ok(!/GDPR|RGPD|HIPAA|ISO ?27001|SOC ?2|PCI|certified|certifi|fully compliant|entièrement conforme|compliant with/i.test(all), "no compliance / certification claim");
  assert.ok(!/\bAdmin\b/.test(all), "outward copy says Ringo, not Admin");
  assert.ok(!/\b(RCCM|NIU|SIRET|VAT number|registration number|P\.?O\.? Box|BP \d|DPO|Data Protection Officer)\b/i.test(all), "no invented legal identity details");
  const emails = [...new Set(all.match(/[\w.-]+@[\w.-]+\.\w+/g) || [])];
  assert.deepEqual(emails, ["info@ringoconnectltd.com"]);
  assert.ok(all.includes("Ringo Connect Ltd.") && all.includes("Yaoundé"), "the company identity already established in the project");
  // the documents read as finished text: no leftover "to be confirmed" notes, and no invented numbers, ages, rights or safeguards
  assert.ok(!all.includes('"review"'), "no unfinished review notes in the published text");
  const text = (d) => JSON.stringify(d.sections);
  const days = (t) => [...t.matchAll(/(\d+)\s*(days|jours|hours|heures|years|ans|months|mois)/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(days(text(docs.privacy.en)))].sort(), ["3 hours", "60 days", "7 days"], "only the retention limits the code establishes (60 days referral code, 3 hours signup payment id, 7 days demo account)");
  assert.deepEqual([...new Set(days(text(docs.privacy.fr)))].sort(), ["3 heures", "60 jours", "7 jours"]);
  assert.ok(!/minimum age|at least \d+|years old|âge minimum|\b1[3-9] (years|ans)|over 1[3-9]|(aged|age of) 1[3-9]/i.test(all), "no invented age requirement");
  assert.ok(!/delete all|all (of )?your (data|information) (is|will be) (deleted|erased)|toutes vos données seront/i.test(all), "no promise that everything is deleted");
  assert.ok(!/we do not sell|nous ne vendons pas/i.test(all), "no claim the code cannot prove");
  const del = JSON.stringify(docs.privacy.en.sections.find((x) => x.id === "account-deletion"));
  assert.ok(/no self-service/i.test(del) && /info@ringoconnectltd\.com/.test(del) && /does not necessarily mean everything is erased/.test(del), "account closure: the real (email) process, and records may remain");
  const prog = docs.terms.en.sections.find((x) => x.id === "ambassadors");
  assert.ok(/Affiliate program/.test(prog.title) && /Ambassador program/.test(prog.title) && /two separate programs/.test(JSON.stringify(prog)), "Affiliate and Ambassador stay two programs");
  for (const l of ["en", "fr"]) assert.ok(/Ringo Connect Smart Card/.test(JSON.stringify(docs.terms[l])), "the physical product is the Ringo Connect Smart Card");
  assert.ok(!/Ringo Card/.test(all), "no other name for it in the legal text");
});
await test("the pages render in both languages with a title, a last-updated date, a table of contents and every section anchor", () => {
  const Legal = load("components/legal/LegalDocument.tsx").default;
  for (const kind of ["privacy", "terms", "cookies"]) {
    for (const l of ["en", "fr"]) {
      const out = html(Legal, { kind }, l);
      const d = docs[kind][l];
      assert.ok(out.includes(`<h1`) && out.includes(d.title.replace(/'/g, "&#x27;")), `${kind} ${l} title`);
      assert.ok(out.includes(translations[l].legalPage.lastUpdated) && out.includes(d.updated));
      assert.ok(out.includes(`aria-label="${translations[l].legalPage.contents}"`), "table of contents");
      for (const s of d.sections) assert.ok(out.includes(`href="#${s.id}"`) && out.includes(`id="${s.id}"`), `${kind} ${l} ${s.id}`);
      assert.ok(out.includes('href="mailto:info@ringoconnectltd.com"'));
      assert.ok(!out.includes(translations[l].legalPage.reviewLabel), "no unfinished-review box on a published page");
    }
  }
  const fr = html(Legal, { kind: "privacy" }, "fr");
  assert.ok(!/Last updated|Contents|Back to Ringo/.test(fr), "no English chrome in the French page");
});
await test("page metadata and reachability: both pages have titles + descriptions (EN / FR), a canonical, and links from the landing footer, sign-in / sign-up surfaces, signup payment and the account menu", () => {
  for (const [f, title] of [["src/app/privacy/page.tsx", "Privacy Policy · Politique de confidentialité"], ["src/app/terms/page.tsx", "Terms of Service · Conditions d'utilisation"], ["src/app/cookies/page.tsx", "Cookie Policy · Politique relative aux cookies"]]) {
    const s = raw(f);
    assert.ok(s.includes(title) && s.includes("description:") && /canonical: "\/(privacy|terms|cookies)"/.test(s), f);
  }
  assert.ok(/href="\/terms"/.test(raw("src/components/landing/ClosingSection.tsx")) && /href="\/privacy"/.test(raw("src/components/landing/ClosingSection.tsx")), "landing footer");
  assert.ok(raw("src/components/auth/AuthShell.tsx").includes("<LegalLinks"), "every auth page");
  assert.ok(raw("src/components/dashboard/AvatarMenu.tsx").includes("<LegalLinks"), "account menu");
  assert.equal((raw("src/components/onboarding/GetStartedFlow.tsx").match(/<LegalLinks variant="agree"/g) || []).length, 2, "signup details and payment steps");
  assert.ok(/href="\/terms"/.test(raw("src/app/auth/signup/page.tsx")) && /href="\/privacy"/.test(raw("src/app/auth/signup/page.tsx")), "the signup agreement checkbox");
  const signup = raw("src/app/auth/signup/page.tsx");
  assert.equal((signup.match(/<AuthShell/g) || []).length, 3);
  assert.equal((signup.match(/showLegalLinks=\{false\}/g) || []).length, 1, "only the form that has its own agreement checkbox hides the shell's links, so the user sees one set");
  assert.ok(signup.indexOf("showLegalLinks={false}") > signup.lastIndexOf("<AuthShell") - 5 && signup.indexOf("showLegalLinks={false}") < signup.indexOf("I agree to Ringo"), "and it is the form with the checkbox (the last shell)");
  assert.ok(raw("src/components/association/AssociationGetStartedFlow.tsx").includes('<LegalLinks variant="agree"'), "association Get Started");
  assert.ok(raw("src/app/get-started-affiliate/page.tsx").includes('variant="affiliate"') && raw("src/components/onboarding/GetStartedFlow.tsx").includes("<LegalLinks"), "affiliate Get Started renders the shared flow, which carries the links");
  for (const l of ["en", "fr"]) for (const k of ["terms", "privacy", "cookies", "agreeLead", "agreeMid"]) assert.ok(translations[l].legalLinks[k], `${l}.legalLinks.${k}`);
  const keys = (o) => Object.keys(o).sort().join();
  assert.equal(keys(translations.en.legalLinks), keys(translations.fr.legalLinks));
  assert.equal(keys(translations.en.legalPage), keys(translations.fr.legalPage));
});

// ------------------------------------------------------------------------------------------------ the policy's facts about cookies and tracking, checked against the code
await test("the cookie / tracking statements in the policy match the code (they fail if the code changes and the policy does not)", () => {
  const ot = raw("src/lib/optionalTracking.ts");
  assert.ok(/export const OPTIONAL_TRACKING_ENABLED: boolean = false;/.test(ot), "optional advertising tracking is off");
  for (const c of ["ringo_vid", "ringo_ttclid", "_fbp", "_fbc", "_ttp"]) assert.ok(ot.includes(`"${c}"`), `${c} is cleared while tracking is off`);
  const pv = strip(raw("src/components/ProfileView.tsx"));
  assert.equal((pv.match(/ensureVisitorId\(\)/g) || []).length, 1, "the visitor id is written in one place");
  assert.ok(/if \(OPTIONAL_TRACKING_ENABLED\) \{\s*setVisitorId\(ensureVisitorId\(\)\);\s*captureTtclid\(\);\s*\} else \{\s*clearOptionalTrackingCookies\(\);/.test(pv), "visitor id and TikTok click id only behind the switch; otherwise old ones are removed");
  assert.ok(/\{visitorId && fbPixelId && pageViewEventId && \(/.test(pv) && /\{visitorId && ttPixelId && \(/.test(pv), "the browser pixel scripts render only once a visitor id exists, and that is set only behind the switch");
  const pt = strip(raw("src/lib/pixelTracking.ts"));
  assert.equal((pt.match(/if \(!OPTIONAL_TRACKING_ENABLED\) return;/g) || []).length, 2, "nothing is sent server-side to Meta / TikTok (page view and click events) while it is off");
  const tr = strip(raw("src/app/api/track/route.ts"));
  assert.ok(tr.includes('from("click_events").insert') && tr.includes("dispatchServerPixelEvents("), "first-party click statistics are unchanged");
  const cookiesDoc = JSON.stringify(docs.cookies.en);
  for (const name of ["ringo_customer", "ringo_active_org", "rc_active_ping", "rc_signup_pay", "rc_ref", "rc_amb", "ringo-lang", "ringo_vid", "ringo_ttclid"]) assert.ok(cookiesDoc.includes(name), `the Cookie Policy lists ${name}`);
  assert.ok(raw("src/lib/ambassadorReferral.ts").includes("60 * 24 * 60 * 60 * 1000") && raw("src/lib/referral.ts").includes("rc_ref"), "referral codes: 60 days");
  assert.ok(raw("src/lib/signupPaymentClient.ts").includes("PENDING_PAYMENT_TTL_MS = 3 * 60 * 60_000"), "signup payment id: 3 hours");
  assert.ok(raw("src/app/api/cron/cleanup-demo-accounts/route.ts").includes("7-day"), "demo accounts: 7 days");
  assert.ok(raw("src/lib/team/access.ts").includes('"ringo_active_org"') && raw("src/middleware.ts").includes('"rc_active_ping"') && raw("src/lib/customer/session.ts").includes("ringo_customer"), "the necessary cookies the policy lists");
  const sw = raw("public/pwa-sw.js");
  assert.ok(!/caches\.open/.test(strip(sw)), "the service worker stores nothing");
  const pkg = JSON.parse(raw("package.json"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
  assert.ok(!/analytics|gtag|mixpanel|segment|hotjar|posthog|sentry|amplitude|@vercel\/analytics/i.test(deps), "no third-party analytics SDK, as the policy says");
  assert.ok(!/cookie-?consent|cookiebanner|CookieBanner/i.test(Object.keys(translations.en).join(" ")) && !fs.existsSync(path.join(SRC, "components/CookieBanner.tsx")), "no cookie banner exists, as the policy says");
  assert.ok(raw("src/lib/pixelTracking.ts").includes("pixels_enabled"), "pixels are plan-gated");
  assert.ok(raw("src/lib/ai/providers/index.ts").includes("anthropicProvider") && raw("src/lib/ai/providers/index.ts").includes("openaiProvider"), "AI providers named in the policy");
});
await test("scope: authentication, payments, RLS and the database are untouched by this change", async () => {
  const { execFileSync } = require("child_process");
  const git = (a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  const { PHASE28_FILES } = await import("./phase28Files.mjs"); // the Inbox push phase: its exact files (webhook wiring + one additive migration) belong to its own scope guard
  assert.deepEqual(changed.filter((f) => /^(supabase\/|src\/middleware|src\/app\/api\/|src\/lib\/(auth|supabase|fapshi|payments|productCheckout|protection))/.test(f) && !PHASE28_FILES.has(f)), [], "no API route, migration, auth, payment or database file changed");
  assert.ok(!/GH₵|GHS/.test(JSON.stringify(docs)));
});

console.log(`\nlegal: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
