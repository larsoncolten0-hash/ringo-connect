// Phase 9: the Ringo visual design foundation. Tokens, motion, glass, gilt, lamplight, the Ring, micro-labels, the Ringo Card.
// No browser: contrast is computed from the real token values in globals.css, the CSS / TypeScript / Tailwind copies of the
// motion numbers are compared, the components are server-rendered with the real code (EN and FR), and the "additive only"
// promises (nothing existing changed, nothing risky touched, no new dependency, no WebGL) are checked against git.
// Pointer tilt, the sweep and the visuals themselves are verified in the browser harness.
//   Run:  node scripts/tests/designFoundation.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { isPhase2File } from "./phase2Files.mjs";
import { PHASE11_FILES } from "./phase11Files.mjs";
import { PHASE12_FILES } from "./phase12Files.mjs";
import { PHASE13_FILES } from "./phase13Files.mjs";

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

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const motion = jiti(path.join(SRC, "lib/design/motion.ts"));
const connect = jiti(path.join(SRC, "lib/design/tapToConnect.ts"));

let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
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

const css = raw("src/app/globals.css");
const FOUNDATION_AT = css.indexOf("RINGO DESIGN FOUNDATION");
const foundation = css.slice(FOUNDATION_AT);
const tailwind = raw("tailwind.config.ts");

// ------------------------------------------------------------------ helpers: tokens and contrast
const channels = (name) => {
  const m = foundation.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`));
  assert.ok(m, `--${name} is defined as an R G B triplet`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg, bg, a) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
const WHITE = [255, 255, 255];

// ------------------------------------------------------------------ 1. tokens exist and match the approved scales
await test("color tokens: the approved palette exists (Ink, Paper, Gold, Gold dark, Gold light, Ember, Signal, Rose, neutrals)", () => {
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  assert.equal(hex(channels("rc-gold")), "#D4A954", "gold is the approved #D4A954");
  assert.equal(hex(channels("rc-ink")), "#0A0A0A");
  assert.equal(hex(channels("rc-paper")), "#FAFAF8", "paper equals the existing --ringo-bg");
  for (const n of ["rc-ink-2", "rc-gold-dark", "rc-gold-light", "rc-ember", "rc-ember-dark", "rc-signal", "rc-signal-dark", "rc-rose", "rc-rose-dark", "rc-stone-50", "rc-stone-100", "rc-stone-200", "rc-stone-300", "rc-stone-500", "rc-stone-600", "rc-stone-700", "rc-stone-900"]) channels(n);
});
await test("radius scale is 8 / 14 / 22 / 32 / pill; spacing scale is 4 8 12 16 24 32 48 72 112", () => {
  for (const [k, v] of Object.entries({ sm: "8px", md: "14px", lg: "22px", xl: "32px", pill: "9999px" })) assert.match(foundation, new RegExp(`--ringo-radius-${k}:\\s*${v};`), k);
  const space = [...foundation.matchAll(/--ringo-space-(\d):\s*(\d+)px;/g)].map((m) => Number(m[2]));
  assert.deepEqual(space, [4, 8, 12, 16, 24, 32, 48, 72, 112]);
  // every step is reachable with a stock or added Tailwind spacing key: 1 2 3 4 6 8 12 (default) + 18 (added) + 28 (default)
  const tw = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 18: 72, 28: 112 };
  assert.deepEqual(Object.values(tw), space);
  assert.match(tailwind, /spacing:\s*\{\s*18: "4\.5rem"/);
});
await test("elevation: three levels plus a warm glow and a signal glow, each with an offset and a soft blur (never a zero-offset halo)", () => {
  for (const n of ["shadow-1", "shadow-2", "shadow-3", "glow-warm", "glow-signal"]) {
    const m = foundation.match(new RegExp(`--ringo-${n}:\\s*([^;]+);`));
    assert.ok(m, n);
    for (const layer of m[1].split(/,(?![^(]*\))/)) {
      const nums = layer.trim().split(/\s+/).slice(0, 4);
      assert.ok(/^-?\d/.test(nums[1]) && Number.parseFloat(nums[1]) > 0, `${n}: a vertical offset in "${layer.trim()}"`);
      assert.ok(Number.parseFloat(nums[2]) > 0, `${n}: a blur in "${layer.trim()}"`);
    }
  }
});
await test("borders: neutral (the existing token), warm and gilt", () => {
  assert.match(foundation, /--ringo-line-warm:/);
  assert.match(foundation, /--ringo-line-gilt:/);
  assert.match(tailwind, /"line-warm": "var\(--ringo-line-warm\)"/);
  assert.match(tailwind, /"line-gilt": "var\(--ringo-line-gilt\)"/);
  assert.match(css, /--ringo-border: rgba\(15, 23, 42, 0\.12\);/, "the existing neutral border is untouched");
});

// ------------------------------------------------------------------ 2. contrast (WCAG), computed from the real values
await test("contrast: every text pairing the system recommends clears WCAG AA (4.5:1), the headline pairings clear AAA (7:1)", () => {
  const C = (n) => channels(n);
  const pairs = [
    ["gold on ink", C("rc-gold"), C("rc-ink"), 7],
    ["ink on gold fill (the primary button)", C("rc-ink"), C("rc-gold"), 7],
    ["gold-light on ink", C("rc-gold-light"), C("rc-ink"), 7],
    ["signal on ink", C("rc-signal"), C("rc-ink"), 7],
    ["rose on ink", C("rc-rose"), C("rc-ink"), 7],
    ["ember on ink", C("rc-ember"), C("rc-ink"), 4.5],
    ["gold-dark on paper (gold as text on light)", C("rc-gold-dark"), C("rc-paper"), 4.5],
    ["gold-dark on white", C("rc-gold-dark"), WHITE, 4.5],
    ["signal-dark on paper", C("rc-signal-dark"), C("rc-paper"), 4.5],
    ["ember-dark on paper", C("rc-ember-dark"), C("rc-paper"), 4.5],
    ["rose-dark on paper", C("rc-rose-dark"), C("rc-paper"), 4.5],
    ["stone-600 on paper (warm body text)", C("rc-stone-600"), C("rc-paper"), 4.5],
    ["muted micro-label on the card (stone-300 at 80% over ink)", over(C("rc-stone-300"), C("rc-ink"), 0.8), C("rc-ink"), 7],
    ["paper on ink (the card name)", C("rc-paper"), C("rc-ink"), 7],
  ];
  const bad = pairs.filter(([, fg, bg, min]) => ratio(fg, bg) < min).map(([n, fg, bg, min]) => `${n}: ${ratio(fg, bg).toFixed(2)} < ${min}`);
  assert.deepEqual(bad, []);
});
await test("contrast: the theme-flipping *-text tokens pick the dark step on light and the bright step on dark", () => {
  const rootBlock = foundation.slice(foundation.indexOf(":root {"), foundation.indexOf(".dark {"));
  const darkBlock = foundation.slice(foundation.indexOf(".dark {"), foundation.indexOf(".dark {") + 600);
  for (const hue of ["gold", "ember", "signal", "rose"]) {
    assert.match(rootBlock, new RegExp(`--ringo-${hue}-text: var\\(--rc-${hue}-dark\\);`), `${hue} light`);
    assert.match(darkBlock, new RegExp(`--ringo-${hue}-text: var\\(--rc-${hue}\\);`), `${hue} dark`);
  }
});
await test("contrast: gold-display (large display text only) clears 3:1 on paper, and flips to the bright gold on dark", () => {
  assert.ok(ratio(channels("rc-gold-display"), channels("rc-paper")) >= 3, "gold-display on paper: " + ratio(channels("rc-gold-display"), channels("rc-paper")).toFixed(2));
  assert.ok(ratio(channels("rc-gold"), [11, 17, 32]) >= 7, "gold on the dark app background");
  assert.match(foundation, /--ringo-gold-display: var\(--rc-gold-display\);/);
  assert.match(foundation.slice(foundation.indexOf(".dark {"), foundation.indexOf(".dark {") + 600), /--ringo-gold-display: var\(--rc-gold\);/);
  assert.ok(ratio(channels("rc-gold-display"), channels("rc-paper")) < 4.5, "and it is therefore never to be used for body text");
});
await test("contrast: raw gold as text on a light surface would FAIL, which is exactly why the dark step exists", () => {
  assert.ok(ratio(channels("rc-gold"), channels("rc-paper")) < 3, "gold on paper is under 3:1");
});

// ------------------------------------------------------------------ 3. motion: one set of numbers in CSS, TypeScript and Tailwind
await test("motion: 120 / 220 / 420ms, the Reveal ease and the 0.97 press scale agree across CSS, TypeScript and Tailwind", () => {
  const ms = (n) => Number(foundation.match(new RegExp(`--ringo-dur-${n}:\\s*(\\d+)ms;`))[1]);
  assert.deepEqual([ms("fast"), ms("base"), ms("slow")], [120, 220, 420]);
  assert.deepEqual([motion.RINGO_DURATION.fast, motion.RINGO_DURATION.base, motion.RINGO_DURATION.slow].map((s) => Math.round(s * 1000)), [120, 220, 420]);
  const cssEase = foundation.match(/--ringo-ease:\s*cubic-bezier\(([^)]+)\);/)[1].split(",").map(Number);
  assert.deepEqual(cssEase, [...motion.RINGO_EASE]);
  assert.equal(motion.RINGO_EASE_CSS, `cubic-bezier(${cssEase.join(", ")})`);
  // The landing Reveal (Phase 2) is CSS-driven and reads the very same tokens, so its curve and duration are the foundation's by construction.
  assert.match(foundation, /\[data-reveal="in"\]\s*\{[^}]*transition: opacity var\(--ringo-dur-slow\) var\(--ringo-ease\), transform var\(--ringo-dur-slow\) var\(--ringo-ease\);/);
  assert.ok(!/cubic-bezier|ease:|duration/.test(raw("src/components/landing/Reveal.tsx").replace(/\/\/.*$/gm, "")), "no private timing in Reveal");
  assert.match(foundation, new RegExp(`--ringo-press-scale:\\s*${motion.RINGO_PRESS_SCALE};`));
  for (const k of ["fast", "base", "slow"]) assert.match(tailwind, new RegExp(`"ringo-${k}": "var\\(--ringo-dur-${k}\\)"`));
  assert.match(tailwind, /ringo: "var\(--ringo-ease\)"/);
});
await test("motion: staggering never exceeds five steps, however long the list, and bad indexes are safe", () => {
  assert.equal(motion.RINGO_STAGGER_MAX, 5);
  const d = [0, 1, 2, 3, 4, 5, 6, 50, 1000].map((i) => motion.staggerDelay(i));
  assert.deepEqual(d.map((v) => Math.round(v * 1000)), [0, 60, 120, 180, 240, 240, 240, 240, 240]);
  assert.equal(motion.staggerDelay(-3), 0);
  assert.equal(motion.staggerDelay(NaN), 0);
  assert.equal(motion.staggerDelay(Infinity, 0.1), 0.1);
  assert.equal(motion.staggerDelay(2, 0.5), 0.5 + 2 * motion.RINGO_STAGGER_STEP);
  assert.match(foundation, /animation-delay:\s*calc\(min\(var\(--i, 0\), 4\) \* 60ms\)/, "the CSS stagger caps at index 4 too");
  assert.deepEqual(motion.ringoTransition("slow", 0.1), { duration: 0.42, ease: motion.RINGO_EASE, delay: 0.1 });
});

// ------------------------------------------------------------------ 4. reduced motion is part of the system
await test("reduced motion: every animated class the foundation adds is switched off in the reduced-motion block", () => {
  const reducedAt = foundation.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedAt > 0);
  const before = foundation.slice(0, reducedAt);
  const reduced = foundation.slice(reducedAt);
  const animated = [...before.matchAll(/([.][\w-]+(?:::after|::before)?)\s*\{[^}]*animation:/g)].map((m) => m[1]);
  assert.ok(animated.length >= 5, "found the animated classes: " + animated.join(" "));
  for (const sel of animated) assert.ok(reduced.includes(sel), `${sel} is covered`);
  assert.match(reduced, /\.ringo-card-sweep\s*\{\s*display: none;/, "the one-time sweep is hidden, not frozen mid-band");
  assert.match(reduced, /\.ringo-press:active:not\(:disabled\)\s*\{[^}]*transform: none;/, "no scale on press, but still a visible response");
});
await test("reduced motion: the two legacy animations the old block missed (float, equalizer) are now covered; the old block is untouched", () => {
  const reduced = foundation.slice(foundation.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.animate-float\s*\{\s*animation: none !important;/);
  assert.match(reduced, /\.animate-eq-bar\s*\{\s*animation: none !important;\s*height: 8px;/, "the equalizer rests at a mid height: it still reads as playing");
  const legacy = css.slice(0, FOUNDATION_AT);
  for (const c of [".animate-ring-pulse-1", ".animate-ring-pulse-2", ".animate-ring-pulse-3", ".animate-orbit", ".animate-dropdown-in", ".animate-fade-up", ".animate-fade-in", ".skeleton::after", ".loading-reveal", ".ringo-arrival-highlight-wrap"]) assert.ok(legacy.includes(c), c);
});

// ------------------------------------------------------------------ 5. one glass language, gilt, lamplight
await test("glass: one recipe with blur + saturation, an inner highlight and an edge, with solid fallbacks for reduced transparency and no backdrop-filter", () => {
  const glass = foundation.match(/\.ringo-glass \{[^}]*\}/)[0];
  assert.match(glass, /backdrop-filter: blur\(16px\) saturate\(1\.4\)/);
  assert.match(glass, /-webkit-backdrop-filter: blur\(16px\) saturate\(1\.4\)/);
  assert.match(glass, /inset 0 1px 0 rgb\(255 255 255 \/ var\(--ringo-glass-highlight\)\)/, "an inner highlight edge");
  assert.match(glass, /border: 1px solid/);
  assert.match(foundation, /@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.ringo-glass\s*\{[^}]*backdrop-filter: none;/);
  assert.match(foundation, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.equal((foundation.match(/\.ringo-glass(?![-\w])\s*\{/g) || []).length >= 3, true);
  assert.equal((foundation.match(/backdrop-filter: blur\(16px\) saturate/g) || []).length, 2, "exactly one blur recipe (plain + -webkit-)");
});
await test("gilt edge and lamplight: a masked 1px gradient hairline on ::before, a radial pool on ::after (so they can share an element), one major lamp by rule", () => {
  assert.match(foundation, /\.ringo-gilt::before\s*\{[^}]*padding: 1px;[^}]*mask-composite: exclude|\.ringo-gilt::before\s*\{[^}]*padding: 1px;[\s\S]*?mask: linear-gradient/);
  assert.match(foundation, /\.ringo-gilt--strong::before/);
  assert.match(foundation, /\.ringo-lamp::after\s*\{[^}]*radial-gradient\(closest-side/);
  assert.ok(!/\.ringo-lamp::before/.test(foundation), "lamp does not use ::before (gilt owns it)");
  assert.ok(!/(?<!backdrop-)filter:\s*blur/.test(foundation), "no blur filter: lamplight is a plain radial gradient");
  assert.match(foundation, /RULE: at most ONE major lamp per viewport/);
  assert.match(foundation, /width: min\(var\(--lamp-size, 520px\), 140vw\)/, "a lamp can never be wider than the viewport allows");
});
await test("the component classes live in Tailwind's components layer, so a utility on the same element (absolute, p-5, text-xs) always wins", () => {
  const open = foundation.indexOf("@layer components {");
  const reducedAt = foundation.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(open > 0 && open < foundation.indexOf(".ringo-glass {") && foundation.indexOf(".ringo-focus:focus-visible") < reducedAt);
  const between = foundation.slice(open, reducedAt);
  let depth = 0;
  for (const ch of between) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  assert.equal(depth, 0, "the layer is closed right before the reduced-motion block");
});
await test("micro-language: mono face, 12px minimum, tabular numerals, uppercase tracking; the face falls back to the system mono", () => {
  const micro = foundation.match(/\.ringo-micro \{[^}]*\}/)[0];
  assert.match(micro, /font-family: var\(--ringo-font-mono\)/);
  assert.match(micro, /font-size: 0\.75rem/);
  assert.match(micro, /font-variant-numeric: tabular-nums/);
  assert.match(micro, /text-transform: uppercase/);
  assert.match(foundation, /--ringo-font-mono: ui-monospace, "JetBrains Mono"/);
  assert.match(tailwind, /micro: \["var\(--ringo-font-mono\)"\]/);
  assert.ok(!/(?<![-\w])font-mono|^\s*mono:/m.test(strip(tailwind)), "the stock `font-mono` utility is not overridden");
});

// ------------------------------------------------------------------ 6. compatibility: nothing existing changed
await test("compatibility: indigo, branding, radius, shadows and the existing tokens are exactly as before", () => {
  assert.match(css, /--ringo-indigo: 79 70 229;/);
  assert.match(tailwind, /indigo: "rgb\(var\(--ringo-indigo\) \/ <alpha-value>\)"/);
  assert.match(tailwind, /card: "12px"/);
  assert.match(tailwind, /coral: "#FF6B4A"/);
  assert.match(tailwind, /teal: "#14B8A6"/);
  assert.match(tailwind, /display: \["var\(--font-display\)", "sans-serif"\]/);
  assert.match(tailwind, /sans: \["var\(--font-body\)", "sans-serif"\]/);
  assert.match(foundation, /--ringo-accent: var\(--ringo-indigo\);/, "the accent still follows indigo, and so the admin's brand color");
  assert.match(foundation, /--ringo-on-accent: 255 255 255;/);
  const defaults = raw("src/lib/brandingDefaults.ts");
  assert.match(defaults, /primaryColor: "#4F46E5"/);
  const layout = raw("src/app/layout.tsx");
  assert.ok(layout.includes("--ringo-indigo"), "the root layout still injects the brand color");
});
await test("compatibility: the foundation only ADDS to globals.css and tailwind.config.ts (no existing line removed or changed)", () => {
  const stat = git("diff --numstat b33b1f4~1 b33b1f4 -- src/app/globals.css tailwind.config.ts src/lib/i18n/translations.ts").trim().split("\n").filter(Boolean);
  for (const line of stat) {
    const [added, removed, file] = line.split("\t");
    // globals.css had no newline after its final "}", so appending after it shows that one line as changed; nothing else may be.
    // translations.ts: the four approved hero headline lines (Phase 2A) are the only existing lines ever rewritten.
    const allowed = file === "src/app/globals.css" ? 1 : file === "src/lib/i18n/translations.ts" ? 4 : 0;
    assert.ok(Number(removed) <= allowed, `${file}: ${removed} lines removed (${added} added)`);
  }
  const removedLines = git("diff -U0 b33b1f4~1 b33b1f4 -- src/app/globals.css").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.ok(removedLines.every((l) => l.trim() === "-}"), "the only globals.css line touched is the old final closing brace: " + removedLines.join("|"));
  const i18nRemoved = git("diff -U0 b33b1f4~1 b33b1f4 -- src/lib/i18n/translations.ts").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.ok(i18nRemoved.every((l) => /hero(TitleRest|Title):/.test(l)), "translations.ts: only the hero headline lines were rewritten: " + i18nRemoved.join("|"));
});
await test("compatibility: apart from the landing hero (Phase 2A), no foundation class is applied to any existing screen (the foundation is opt-in)", () => {
  const used = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(tsx?|css)$/.test(e.name)) {
        const rel = path.relative(REPO, f).replace(/\\/g, "/");
        // Phase 2A: the landing hero is the one approved first adopter of the foundation.
        if (rel.startsWith("src/components/landing/")) continue; // Phase 2A/2: the landing page is the approved adopter (checked in landingHero / landingStory tests)
        if (PHASE13_FILES.has(rel)) continue; // visual / UX refinement phase: Ring (Ringo AI avatar) and the Ringo Card world on the dashboard
        if (PHASE12_FILES.has(rel)) continue; // Phase 3B: the category stages on every public profile
        if (PHASE11_FILES.has(rel)) continue; // Phase 3A: the Music public profile is the next approved adopter (checked in musicProfile.test.mjs)
        if (rel === "src/app/globals.css" || rel.startsWith("src/components/brand/") || rel.startsWith("src/lib/design/") || rel.startsWith("src/app/dev-preview-foundation/") || rel === "src/lib/i18n/translations.ts") continue;
        const s = fs.readFileSync(f, "utf8");
        if (/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b|(?:bg|text|border|from|to|ring|shadow|rounded)-ringo-(ink|ink-2|paper|gold|gold-dark|gold-light|ember|ember-dark|signal|signal-dark|rose|rose-dark|stone|accent|on-accent|gold-text|ember-text|signal-text|rose-text|line-warm|line-gilt|sm|md|lg|xl|1|2|3|glow|signal)\b|duration-ringo|ease-ringo|font-micro|components\/brand|lib\/design/.test(s)) used.push(rel);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(used, [], "files already using foundation classes: " + used.join(", "));
});

// ------------------------------------------------------------------ 7. Tailwind <-> CSS: every var the config reads is defined
await test("tailwind: every CSS variable the new config entries read is defined in globals.css (no silent no-op utility)", () => {
  const added = tailwind.slice(tailwind.indexOf("Design foundation"));
  const used = [...new Set([...added.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
  assert.ok(used.length > 25, "read " + used.length + " variables");
  const missing = used.filter((v) => !new RegExp(`${v}:`).test(foundation));
  assert.deepEqual(missing, []);
});
await test("tailwind: the foundation entries are wired (colors, radius, shadows, durations, easing, spacing)", () => {
  for (const k of ["ink", '"ink-2"', "paper", "gold", '"gold-dark"', '"gold-light"', "ember", "signal", "rose", "accent", '"on-accent"', '"gold-text"', '"signal-text"', '"rose-text"']) assert.ok(tailwind.includes(`${k}:`), k);
  for (const k of ['"ringo-sm"', '"ringo-md"', '"ringo-lg"', '"ringo-xl"', '"ringo-1"', '"ringo-2"', '"ringo-3"', '"ringo-glow"', '"ringo-signal"']) assert.ok(tailwind.includes(`${k}:`), k);
});

// ------------------------------------------------------------------ 8. Tap to Connect
await test("tap to connect: idle -> waiting -> connected, reset anywhere, and nothing else moves a state", () => {
  const n = connect.nextConnectState;
  assert.equal(n("idle", "tap"), "waiting");
  assert.equal(n("waiting", "confirm"), "connected");
  assert.equal(n("connected", "reset"), "idle");
  assert.equal(n("waiting", "reset"), "idle");
  assert.equal(n("idle", "reset"), "idle");
  assert.equal(n("idle", "confirm"), "idle", "a confirmation with no tap in flight is ignored");
  assert.equal(n("connected", "tap"), "connected", "a second tap does not re-open a connection");
  assert.equal(n("waiting", "tap"), "waiting");
  assert.equal(n("connected", "confirm"), "connected");
  assert.equal(n("idle", "bogus"), "idle");
  assert.deepEqual([...connect.CONNECT_STATES], ["idle", "waiting", "connected"]);
  assert.equal(connect.connectTone("connected"), "signal");
  assert.equal(connect.connectTone("idle"), "gold");
  assert.equal(connect.connectTone("waiting"), "gold");
});
await test("tap to connect is presentation only: no network, no NFC API, no storage, no payment code", () => {
  const s = strip(raw("src/lib/design/tapToConnect.ts"));
  assert.ok(!/fetch\(|XMLHttpRequest|NDEFReader|navigator\.|localStorage|sessionStorage|supabase|stripe|fapshi|import /i.test(s));
});

// ------------------------------------------------------------------ 9. the components, server-rendered with the real code
const Ring = load(path.join(SRC, "components/brand/Ring.tsx")).default;
const MicroLabel = load(path.join(SRC, "components/brand/MicroLabel.tsx")).default;
const Card = load(path.join(SRC, "components/brand/RingoCard3D.tsx")).default;
const Preview = load(path.join(SRC, "components/brand/FoundationPreview.tsx")).default;

await test("Ring: open with a node when idle, sweeping when waiting, closed and signal when connected", () => {
  const idle = html(Ring, { state: "idle" });
  const waiting = html(Ring, { state: "waiting" });
  const done = html(Ring, { state: "connected" });
  assert.ok(!idle.includes("ringo-ring-sweep") && !idle.includes("ringo-ring-close") && idle.includes("stroke-dasharray"));
  assert.ok(waiting.includes("ringo-ring-sweep") && waiting.includes("stroke-dasharray"));
  assert.ok(done.includes("ringo-ring-close") && !done.includes("ringo-ring-sweep") && done.includes("--ring-len"));
  assert.ok(done.includes("rgb(var(--rc-signal))") && !done.includes("rgb(var(--rc-gold))"), "connected wears signal only");
  assert.ok(idle.includes("rgb(var(--rc-gold))") && !idle.includes("rgb(var(--rc-signal))"), "idle wears gold only");
  assert.ok(html(Ring, {}).includes("ringo-ring") === false && html(Ring, {}).includes("stroke-dasharray"), "defaults to idle");
});
await test("Ring: the closing stroke starts at the top and its dash length is the real circumference", () => {
  const done = html(Ring, { state: "connected" });
  assert.match(done, /--ring-len:251\.33/);
  assert.match(done, /transform:rotate\(-90deg\)/);
});
await test("Ring: named when it carries the meaning (role=img + label), decorative when text says it (aria-hidden); never both", () => {
  const named = html(Ring, { state: "connected", label: translations.en.brand.ring.connected });
  assert.ok(named.includes('role="img"') && named.includes(`aria-label="${translations.en.brand.ring.connected}"`) && !named.includes("aria-hidden"));
  const deco = html(Ring, { state: "idle" });
  assert.ok(deco.includes('aria-hidden="true"') && !deco.includes("role=") && !deco.includes("aria-label"));
  assert.ok(html(Ring, { size: 72 }).includes('width="72"') && html(Ring, { size: 72 }).includes('height="72"'));
});
await test("Ring is server-renderable: no 'use client', no hooks, no state", () => {
  const s = raw("src/components/brand/Ring.tsx");
  assert.ok(!/^"use client"/.test(s) && !/use(State|Effect|Ref|Memo|Layout)/.test(s));
});
await test("MicroLabel: tone and surface choose a contrast-safe class; live adds the signal dot (hidden from screen readers)", () => {
  const one = (p) => html(MicroLabel, { children: "X", ...p });
  assert.ok(one({ tone: "gold" }).includes("text-ringo-gold-text") && one({ tone: "signal" }).includes("text-ringo-signal-text"));
  assert.ok(one({ tone: "gold", surface: "dark" }).includes("text-ringo-gold") && !one({ tone: "gold", surface: "dark" }).includes("gold-text"));
  assert.ok(one({ tone: "gold", surface: "light" }).includes("text-ringo-gold-dark"));
  assert.ok(one({ tone: "signal", surface: "light" }).includes("text-ringo-signal-dark"));
  assert.ok(one({}).includes("ringo-micro") && !one({}).includes("ringo-live-dot"));
  assert.match(one({ live: true, tone: "signal" }), /<span class="ringo-live-dot" aria-hidden="true"><\/span>X/);
  assert.ok(one({ className: "whitespace-nowrap" }).includes("whitespace-nowrap"));
});
await test("Ringo Card (EN): a named group, the holder's name, the Ringo ID, NFC READY, an open Ring, the NFC mark", () => {
  const h = html(Card, { name: "Ada Mbella", ringoId: "0042" }, "en");
  assert.ok(h.includes(`role="group" aria-label="${translations.en.brand.card.ariaLabel("Ada Mbella")}"`));
  assert.ok(h.includes("Ada Mbella") && h.includes(`${translations.en.brand.card.ringoId} 0042`) && h.includes(translations.en.brand.card.nfcReady));
  assert.ok(h.includes('aria-live="polite"'), "status changes are announced");
  assert.ok(h.includes("ringo-gilt") && h.includes("ringo-lamp") && h.includes("ringo-card-sweep"));
  assert.ok(h.includes("transform-style:preserve-3d") && h.includes("perspective:900"), "real CSS 3D");
  assert.ok(h.includes("translateZ(18px)") && h.includes("translateZ(-5px)"), "marks in front, thickness behind");
  assert.ok(h.includes("lucide-nfc"), "the NFC mark");
  assert.ok(!h.includes("ringo-live-dot") && !h.includes("shadow-ringo-signal") && h.includes("shadow-ringo-3"));
});
await test("Ringo Card: waiting says TAP TO CONNECT and sweeps; connected closes the Ring, goes signal and glows signal", () => {
  const w = html(Card, { name: "Ada", ringoId: "1", state: "waiting" }, "en");
  assert.ok(w.includes(translations.en.brand.card.tapToConnect) && w.includes("ringo-ring-sweep") && !w.includes("ringo-live-dot"));
  const c = html(Card, { name: "Ada", ringoId: "1", state: "connected" }, "en");
  assert.ok(c.includes(translations.en.brand.card.connected) && c.includes("ringo-ring-close") && c.includes("ringo-live-dot"));
  assert.ok(c.includes("shadow-ringo-signal") && c.includes("ringo-lamp--signal") && !c.includes("shadow-ringo-3"));
  assert.ok(!c.includes(translations.en.brand.card.nfcReady), "the old status is gone");
});
await test("Ringo Card (FR): every label is French and none of the English ones remain; the name is never translated", () => {
  for (const state of ["idle", "waiting", "connected"]) {
    const h = html(Card, { name: "Ada Mbella", ringoId: "0042", state }, "fr");
    assert.ok(h.includes(translations.fr.brand.card.ariaLabel("Ada Mbella")) && h.includes(`${translations.fr.brand.card.ringoId} 0042`), state);
    const key = state === "idle" ? "nfcReady" : state === "waiting" ? "tapToConnect" : "connected";
    assert.ok(h.includes(translations.fr.brand.card[key]) && !h.includes(translations.en.brand.card[key]), state);
    assert.ok(!h.includes(translations.en.brand.card.ringoId + " 0042"), state);
    assert.ok(h.includes("Ada Mbella"));
  }
});
await test("Ringo Card renders identically on the server and on a re-render (no random ids, clocks or window reads that could mismatch hydration)", () => {
  const a = html(Card, { name: "Ada", ringoId: "7", state: "idle" }, "en");
  const b = html(Card, { name: "Ada", ringoId: "7", state: "idle" }, "en");
  assert.equal(a, b);
  const s = strip(raw("src/components/brand/RingoCard3D.tsx"));
  assert.ok(!/Math\.random|Date\.now|new Date|window\.|document\./.test(s));
  assert.ok(/useReducedMotion\(\)/.test(s) && !/\{!?reduceMotion &&/.test(s), "reduced motion is read for behavior only, never to change the rendered tree");
});
await test("Ringo Card interaction: motion values (never React state), touch is ignored, leaving resets, tilt is capped, reduced motion sets no value", () => {
  const s = strip(raw("src/components/brand/RingoCard3D.tsx"));
  assert.ok(!/useState|useReducer/.test(s), "no React state for pointer values");
  assert.ok(/useMotionValue\(0\.5\)/.test(s) && /useSpring\(/.test(s) && /useTransform\(/.test(s) && /useMotionTemplate/.test(s));
  assert.match(s, /e\.pointerType === "touch"/);
  assert.match(s, /!tiltEnabled/);
  assert.match(s, /const tiltEnabled = interactive && !reduceMotion;/);
  assert.match(s, /onPointerLeave=\{onPointerLeave\}/);
  assert.match(s, /MAX_TILT_DEG = 10/);
  assert.match(s, /clamp01\(/);
  assert.ok(!/addEventListener|requestAnimationFrame|setInterval|setTimeout/.test(s), "no manual listeners or timers");
});
await test("Ringo Card has no WebGL, Three.js, canvas or image: CSS and SVG only", () => {
  for (const f of ["RingoCard3D", "Ring", "MicroLabel", "FoundationPreview"]) {
    const s = strip(raw(`src/components/brand/${f}.tsx`));
    assert.ok(!/three|webgl|getContext|<canvas|<img|next\/image|url\(/i.test(s), f);
  }
});
await test("the card and Ring carry no user-facing literal: every visible word comes from the translations", () => {
  for (const f of ["RingoCard3D", "Ring", "MicroLabel"]) {
    const s = strip(raw(`src/components/brand/${f}.tsx`));
    const text = [...s.matchAll(/>([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)</g)].map((m) => m[1].trim()).filter(Boolean);
    assert.deepEqual(text, [], f);
  }
});

// ------------------------------------------------------------------ 10. bilingual
await test("brand strings exist in EN and FR with the same shape, and differ where they are words", () => {
  const en = translations.en.brand;
  const fr = translations.fr.brand;
  assert.deepEqual(Object.keys(en), Object.keys(fr));
  for (const group of Object.keys(en)) assert.deepEqual(Object.keys(en[group]), Object.keys(fr[group]), group);
  for (const k of ["idle", "waiting", "connected"]) assert.notEqual(en.ring[k], fr.ring[k], k);
  for (const k of ["ringoId", "nfcReady", "tapToConnect", "connected"]) assert.notEqual(en.card[k], fr.card[k], k);
  assert.notEqual(en.micro.scanToOpen, fr.micro.scanToOpen);
  assert.notEqual(en.card.ariaLabel("X"), fr.card.ariaLabel("X"));
  assert.ok(en.card.ariaLabel("Ada").includes("Ada") && fr.card.ariaLabel("Ada").includes("Ada"));
  assert.ok(/NFC/.test(en.card.nfcReady) && /NFC/.test(fr.card.nfcReady), "NFC stays NFC");
});

// ------------------------------------------------------------------ 11. the QA preview page
await test("the preview page renders (EN and FR) on the real components and never ships to production", () => {
  for (const lang of ["en", "fr"]) {
    const h = html(Preview, {}, lang);
    assert.ok(h.includes("Ringo design foundation") && h.includes(translations[lang].brand.card.nfcReady) && h.includes(translations[lang].brand.micro.scanToOpen), lang);
    assert.equal((h.match(/role="group"/g) || []).length, 2, "both cards");
  }
  const page = strip(raw("src/app/dev-preview-foundation/page.tsx"));
  assert.match(page, /process\.env\.NODE_ENV === "production"\) return notFound\(\)/);
  assert.ok(!/supabase|fetch\(|cookies\(|headers\(/.test(page), "no data, no session");
  for (const f of ["src/app/sitemap.ts", "src/app/robots.ts"]) assert.ok(!raw(f).includes("dev-preview-foundation"), f);
});

// ------------------------------------------------------------------ 12. scope: nothing risky touched, nothing outside the allowlist
await test("scope: no dependency, lockfile, migration, env, auth, payment, billing, branding or creator-theme file changed", () => {
  const changed = git("diff --name-only b33b1f4~1 b33b1f4").split("\n").filter(Boolean).map((l) => l.replace(/"/g, "").replace(/\\/g, "/"));
  const protectedPath = /^(package(-lock)?\.json|\.env|supabase\/|migrations\/|src\/middleware\.ts|src\/app\/api\/|src\/lib\/(theme|branding|brandingDefaults|categories)\.ts|src\/lib\/(auth|billing|payments?|productCheckout|fapshi|stripe|shop|settlement)|src\/components\/checkout\/|public\/)/i;
  assert.deepEqual(changed.filter((f) => protectedPath.test(f)), []);
  assert.deepEqual(changed.filter((f) => !isPhase2File(f)), [], "files outside the allowlist");
});
await test("scope: package.json and package-lock.json are byte-identical to HEAD (no new dependency)", () => {
  assert.equal(git("diff --stat b33b1f4~1 b33b1f4 -- package.json package-lock.json").trim(), "");
});
await test("scope: the landing page, profiles, dashboard, commerce and the static funnels are untouched by this phase", () => {
  const changed = git("diff --name-only b33b1f4~1 b33b1f4").split("\n").filter(Boolean);
  assert.deepEqual(changed.filter((f) => !f.startsWith("src/components/landing/")).filter((f) => /^src\/components\/(landing|dashboard|overview|checkout|catalog|auth)\//.test(f) || /^src\/components\/(ProfileView|ShareButton)\.tsx$/.test(f) || /^src\/app\/(page|layout)\.tsx$/.test(f) || /^src\/app\/\[username\]\//.test(f) || /^public\//.test(f)), []);
});

console.log(`\ndesignFoundation: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
