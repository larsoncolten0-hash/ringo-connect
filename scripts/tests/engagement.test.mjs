// Phase 6: engagement and return behaviour on public pages: what a visitor shares (clean address, a copy that
// works or says it did not), the "add to home screen" card (storage-safe, an accessible iOS sheet) and the
// owner push prompt (storage-safe). Pure helpers are called directly; views are server-rendered with the real
// components; behaviour that needs a DOM is pinned on the source and verified in the browser harness.
//   Run:  node scripts/tests/engagement.test.mjs
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
const { cleanShareUrl, isTrackingParam } = jiti(path.join(SRC, "lib/shareUrl.ts"));
let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = { "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children } };
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

// ------------------------------------------------------------------ 1. the shared address
await test("cleanShareUrl removes advertising / analytics identifiers and utm_* tags", () => {
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada?fbclid=IwAR1&utm_source=x&UTM_Medium=y&gclid=abc&ttclid=t&msclkid=m&igshid=i&_ga=1&mc_cid=c"), "https://ringoconnectltd.com/ada");
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada?utm_campaign=a"), "https://ringoconnectltd.com/ada");
});
await test("cleanShareUrl keeps everything the page itself uses: path, other parameters, #section", () => {
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada/book?service=123&fbclid=z"), "https://ringoconnectltd.com/ada/book?service=123");
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/r/ada?table=T4&utm_source=qr#menu"), "https://ringoconnectltd.com/r/ada?table=T4#menu");
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada#merch"), "https://ringoconnectltd.com/ada#merch");
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada?ref=ABC123"), "https://ringoconnectltd.com/ada?ref=ABC123", "a referral code is not an ad identifier and is not touched");
  assert.equal(cleanShareUrl("https://ringoconnectltd.com/ada"), "https://ringoconnectltd.com/ada");
});
await test("cleanShareUrl never throws and never invents: a non-URL is returned as is", () => {
  for (const v of ["", "not a url", "/relative?utm_source=x", "javascript:alert(1)"]) assert.doesNotThrow(() => cleanShareUrl(v));
  assert.equal(cleanShareUrl(""), "");
  assert.equal(cleanShareUrl("/relative?utm_source=x"), "/relative?utm_source=x");
  assert.equal(isTrackingParam("utm_term"), true);
  assert.equal(isTrackingParam("service"), false);
});

// ------------------------------------------------------------------ 2. the share control
const ShareButton = V("components/ShareButton.tsx");
const shareProps = {
  accent: "#D4A954",
  title: "Ada Mbella",
  strings: Object.fromEntries(
    ["share", "copyLink", "linkCopied", "shareWhatsapp", "shareFacebook", "shareX", "moreOptions", "showQrCode", "qrCodeSubtitle", "qrCodeError", "downloadQrCode", "close"].map((k) => [k, k])
  ),
};
shareProps.strings.qrCodeTitle = (n) => `QR ${n}`;

await test("share control: still a named menu button, plus a polite status region for the copy result (closed state)", () => {
  const h = html(ShareButton, shareProps, "en");
  assert.match(h, /aria-haspopup="menu"/);
  assert.match(h, /aria-label="share"/);
  assert.match(h, /<span role="status" aria-live="polite" class="sr-only"><\/span>/);
});
await test("share control source: copies the cleaned address, falls back to select-and-copy, and reports failure", () => {
  const s = src("src/components/ShareButton.tsx");
  assert.match(s, /const getUrl = \(\) => \(typeof window !== "undefined" \? cleanShareUrl\(window\.location\.href\) : ""\);/);
  assert.match(s, /await navigator\.clipboard\.writeText\(getUrl\(\)\);\s*ok = true;\s*\} catch \{\s*ok = legacyCopy\(getUrl\(\)\);/);
  assert.match(s, /document\.execCommand\("copy"\)/);
  assert.match(s, /copied \? strings\.linkCopied : copyFailed \? t\.profilePage\.copyFailed : strings\.copyLink/);
  assert.match(s, /role="status" aria-live="polite" className="sr-only"/);
  assert.equal((s.match(/window\.location\.href/g) || []).length, 1, "the address is read from one place only");
});
await test("share links are unchanged apart from the cleaned address: WhatsApp, Facebook, X, native share, QR", () => {
  const s = src("src/components/ShareButton.tsx");
  assert.match(s, /https:\/\/wa\.me\/\?text=\$\{encodeURIComponent\(`\$\{title\} — \$\{getUrl\(\)\}`\)\}/);
  assert.match(s, /https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=\$\{encodeURIComponent\(getUrl\(\)\)\}/);
  assert.match(s, /https:\/\/twitter\.com\/intent\/tweet\?url=\$\{encodeURIComponent\(getUrl\(\)\)\}&text=\$\{encodeURIComponent\(title\)\}/);
  assert.match(s, /navigator\.share\(\{ title, url: getUrl\(\) \}\)/);
  assert.match(s, /drawQrCodeWithLogo\(canvas, getUrl\(\), 512\)/);
  assert.match(s, /min-h-\[44px\]/, "menu items keep their 44px targets");
});
await test("the copy-failure message exists in EN and FR and differs", () => {
  assert.equal(translations.en.profilePage.copyFailed, "Couldn't copy the link");
  assert.equal(translations.fr.profilePage.copyFailed, "Impossible de copier le lien");
});

// ------------------------------------------------------------------ 3. add to home screen
await test("add to home screen: reading the saved dismissal can never throw, and a never-installable browser still shows nothing", () => {
  const s = src("src/components/AddToHomeScreen.tsx");
  assert.match(s, /try \{\s*if \(localStorage\.getItem\(dismissKey\)\) return;\s*\} catch \{/);
  assert.match(s, /if \(dismissed \|\| \(!deferredPrompt && !isIOS\)\) return null;/);
  assert.ok(!/(^|[^.\w])localStorage\.getItem\(dismissKey\)/m.test(s.replace(/try \{\s*if \(localStorage\.getItem\(dismissKey\)\) return;/, "")), "no unguarded read remains");
  const h = html(V("components/AddToHomeScreen.tsx"), { displayName: "Ada", username: "ada", accent: "#D4A954", radiusClass: "rounded-full", buttonStyle: {}, borderTint: "#333", textColor: "#fff" }, "en");
  assert.equal(h, "", "server render: nothing until the browser says install is possible");
});
await test("add to home screen: the iOS steps are a real modal (named, trapped focus, Escape, 44px close) in both languages", () => {
  const s = src("src/components/AddToHomeScreen.tsx");
  assert.match(s, /function IosDialogShell\(/);
  assert.match(s, /const ref = useModalA11y<HTMLDivElement>\(onClose\);/);
  assert.match(s, /role="dialog"\s*aria-modal="true"\s*aria-label=\{label\}\s*tabIndex=\{-1\}/);
  assert.match(s, /<IosDialogShell label=\{t\.addToHomeScreen\.iosTitle\(displayName\)\}/);
  assert.match(s, /aria-label=\{t\.addToHomeScreen\.close\}\s*className="absolute right-2 top-2 w-11 h-11/);
  assert.ok(!/w-8 h-8/.test(s));
  assert.equal(typeof translations.en.addToHomeScreen.iosTitle("A"), "string");
  assert.notEqual(translations.en.addToHomeScreen.iosTitle("A"), translations.fr.addToHomeScreen.iosTitle("A"));
});

// ------------------------------------------------------------------ 4. owner push prompt
await test("push prompt: storage can never break it; the choice is remembered exactly as before when storage works", () => {
  const s = src("src/components/PushPermissionPrompt.tsx");
  assert.match(s, /function readDismissed\(\): boolean \{\s*try \{\s*return !!localStorage\.getItem\(DISMISS_KEY\);\s*\} catch \{\s*return false;/);
  assert.match(s, /function rememberDismissed\(\) \{\s*try \{\s*localStorage\.setItem\(DISMISS_KEY, "1"\);\s*\} catch \{/);
  const outside = s.replace(/function readDismissed[\s\S]*?\n\}\nfunction rememberDismissed[\s\S]*?\n\}\n/, "");
  assert.ok(!/localStorage\./.test(outside), "every storage access goes through the guarded helpers");
  assert.match(s, /result\.ok \|\| result\.error === "permission_denied"/, "a technical failure still does not permanently hide the prompt");
});

console.log(`\nengagement: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
