// Phase 7: premium polish of public pages: a branded, bilingual error state that leaks nothing, and a QR sheet
// that shows the address it opens. Views are server-rendered with the real components; DOM behaviour is
// verified in the browser harness.
//   Run:  node scripts/tests/premiumPolish.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (rel) => strip(fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n"));

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
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt, width: p.width, height: p.height }) },
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
const html = (Comp, props, lang) => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
};

// ------------------------------------------------------------------ 1. public error state
const PublicProfileError = load(path.join(SRC, "app/[username]/error.tsx")).default;
const secret = new Error("SQL: relation \"profiles\" does not exist — service_role key sk_live_123");
secret.digest = "DIGEST-98765";

await test("error state: a named alert with a title, a calm explanation, Try again and a way out (EN)", () => {
  const h = html(PublicProfileError, { error: secret, reset() {} }, "en");
  assert.match(h, /<main[^>]*role="alert"/);
  assert.ok(h.includes("<h1") && h.includes(translations.en.profilePage.errorTitle) && h.includes(translations.en.profilePage.errorBody));
  assert.ok(h.includes(`>${translations.en.profilePage.errorRetry}</button>`));
  assert.match(h, /<a[^>]*href="\/"[^>]*>Go to Ringo Connect<\/a>/);
});
await test("error state: French is complete and no English UI text remains", () => {
  const h = html(PublicProfileError, { error: secret, reset() {} }, "fr");
  for (const k of ["errorTitle", "errorBody", "errorRetry", "notFoundCta"]) assert.ok(h.includes(translations.fr.profilePage[k]), k);
  for (const k of ["errorTitle", "errorBody", "errorRetry"]) assert.ok(!h.includes(translations.en.profilePage[k]), k);
});
await test("error state: nothing about the failure reaches the visitor (no message, digest, SQL or key)", () => {
  for (const lang of ["en", "fr"]) {
    const h = html(PublicProfileError, { error: secret, reset() {} }, lang);
    assert.ok(!/SQL|relation|service_role|sk_live|DIGEST|profiles/.test(h), lang);
  }
  const s = src("src/app/[username]/error.tsx");
  assert.ok(!/error\.(message|digest|stack)/.test(s));
  assert.match(s, /\{ reset \}: \{ error: Error & \{ digest\?: string \}; reset: \(\) => void \}/, "only reset is read");
});
await test("error state: both actions are 44px targets and Try again calls reset", () => {
  const s = src("src/app/[username]/error.tsx");
  assert.equal((s.match(/min-h-\[44px\]/g) || []).length, 2);
  assert.match(s, /onClick=\{\(\) => reset\(\)\}/);
  let called = 0;
  const el = PublicProfileError({ error: secret, reset: () => called++ });
  assert.ok(el);
});
await test("error state is a client boundary for the public profile segment only; dashboard and admin keep their own", () => {
  assert.match(fs.readFileSync(path.join(SRC, "app/[username]/error.tsx"), "utf8"), /^"use client";/);
  assert.ok(fs.existsSync(path.join(SRC, "app/dashboard/error.tsx")));
  assert.ok(!fs.existsSync(path.join(SRC, "app/error.tsx")), "no site-wide boundary was added");
});
await test("new error strings exist in EN and FR and differ", () => {
  for (const k of ["errorTitle", "errorBody", "errorRetry"]) {
    assert.equal(typeof translations.en.profilePage[k], "string", k);
    assert.equal(typeof translations.fr.profilePage[k], "string", k);
    assert.notEqual(translations.en.profilePage[k], translations.fr.profilePage[k], k);
  }
  assert.equal(translations.fr.profilePage.errorRetry, "Réessayer");
});

// ------------------------------------------------------------------ 2. QR sheet
await test("QR sheet: shows the address the code opens (same cleaned address, no scheme), readable and selectable, LTR", () => {
  const s = src("src/components/ShareButton.tsx");
  // read un-stripped: the scheme pattern itself contains "//", which the comment stripper would eat
  const raw = fs.readFileSync(path.join(REPO, "src/components/ShareButton.tsx"), "utf8");
  assert.ok(raw.includes('{getUrl().replace(/^https?:\\/\\//, "")}'));
  assert.match(s, /break-all text-xs font-medium select-all/);
  assert.match(s, /dir="ltr"/);
  assert.match(s, /drawQrCodeWithLogo\(canvas, getUrl\(\), 512\)/, "the code itself still encodes the same address");
  assert.match(s, /mt-4 flex items-center justify-center gap-2 py-3 min-h-\[44px\]/, "the download button keeps a 44px target");
});
await test("QR sheet: generation, download and dialog behaviour are untouched", () => {
  const s = src("src/components/ShareButton.tsx");
  assert.match(s, /downloadCanvas\(canvas, `\$\{filename\}-qr`, "png"\)/);
  assert.match(s, /role="dialog"\s*aria-modal="true"/);
  assert.match(s, /useModalA11y<HTMLDivElement>\(onClose\)/);
});

console.log(`\npremiumPolish: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
