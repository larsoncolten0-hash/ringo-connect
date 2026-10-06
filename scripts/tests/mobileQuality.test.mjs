// Phase 3E: mobile quality of the public profile at 320-430px. The layout itself was verified in a real browser with a
// throwaway component harness (see the phase report); these source checks pin the fixes so they cannot quietly regress:
// long names / emails / phone numbers / URLs wrap instead of being cut off or pushed past the card, interactive controls
// are 44px, and the fan panel stays on screen. Comments are stripped before matching.
//   Run:  node scripts/tests/mobileQuality.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import crypto from "crypto";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
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
const raw = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const src = (rel) => strip(raw(rel));
const count = (s, re) => (s.match(re) || []).length;
const sha = (rel) => crypto.createHash("sha256").update(raw(rel)).digest("hex");

await test("a long business / person name wraps as ONE block (the first word no longer drifts away from the rest), without truncation", () => {
  const v = src("components/ProfileView.tsx");
  const h1 = v.slice(v.indexOf("<h1"), v.indexOf("</h1>"));
  assert.match(h1, /flex items-center justify-center gap-1\.5 max-w-full/);
  assert.match(h1, /<span className="min-w-0 \[overflow-wrap:anywhere\]">\s*\{firstName\} \{restName && <span style=\{\{ color: accent \}\}>\{restName\}<\/span>\}\s*<\/span>/);
  assert.doesNotMatch(h1, /truncate|line-clamp|text-ellipsis|overflow-hidden/, "the name is never cut off");
  assert.equal(count(v, /<h1\b/g), 1);
  assert.match(h1, /aria-hidden="true">🎵/);
});
await test("contact card: long e-mails, phone numbers and addresses wrap inside the card, and link rows are 44px tap targets", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /className="flex items-start gap-2\.5 min-w-0 min-h-\[44px\] transition hover:opacity-75"/, "mailto: / tel: rows");
  assert.match(v, /className="flex items-start gap-2\.5 min-w-0">/, "plain rows (location, hours) shrink too");
  assert.match(v, /<p className="text-sm font-medium \[overflow-wrap:anywhere\]">\{item\.value\}<\/p>/);
  assert.doesNotMatch(v, /text-sm font-medium truncate/, "contact values are no longer clipped");
});
await test("link titles are shown in full (wrapped), not cut with an ellipsis", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /<p className="text-sm font-semibold \[overflow-wrap:anywhere\]">\{publicLinkTitle\(link\)\}<\/p>/);
  assert.doesNotMatch(v, /font-semibold truncate">\{publicLinkTitle/);
  assert.match(v, /href=\{displayHref\(link\.url\)\}/, "the link destination is untouched");
});
await test("social icons are 44px", () => {
  const s = src("components/SocialIcon.tsx");
  assert.match(s, /className="w-11 h-11 flex items-center justify-center rounded-full/);
  assert.doesNotMatch(s, /className="w-10 h-10 flex/);
  assert.match(s, /href=\{displayHref\(url\)\}/);
});
await test("event cards: the title gets room (the ticket button wraps below on a narrow card) and the button is 44px", () => {
  const e = src("components/music/EventsSection.tsx");
  assert.match(e, /rounded-(?:2xl|ringo-lg) p-3 flex flex-wrap items-center gap-3/);
  assert.match(e, /<div className="flex-1 min-w-\[9rem\]">/);
  assert.match(e, /text-sm font-semibold line-clamp-2 \[overflow-wrap:anywhere\]">\{event\.title\}/);
  assert.match(e, /shrink-0 ml-auto inline-flex items-center min-h-\[44px\]/);
  assert.match(e, /href=\{href\}/, "ticket destinations unchanged");
});
await test("music track rows: the title wraps instead of being squeezed, and the buy links are 44px (presentation only)", () => {
  const m = src("components/music/MusicSection.tsx");
  assert.match(m, /rounded-(?:2xl|ringo-lg) p-3 flex flex-wrap items-center gap-3/);
  assert.match(m, /<div className="flex-1 min-w-\[8rem\]">/);
  assert.match(m, /text-sm font-semibold flex flex-wrap items-center gap-x-1\.5 \[overflow-wrap:anywhere\]/);
  assert.equal(count(m, /shrink-0 inline-flex items-center min-h-\[44px\] text-xs font-semibold px-3 py-2 rounded-full/g), 2);
  assert.match(m, /const detailHref = track\.price \? `\/m\/\$\{username\}\/track\/\$\{track\.id\}` : null;/, "purchase routing unchanged");
  assert.match(m, /onTogglePlay\(track\)/);
});
await test("restaurant featured dishes: names wrap (two lines) and 'View all' is a 44px target", () => {
  const f = src("components/restaurant/FeaturedMenuSection.tsx");
  assert.match(f, /inline-flex min-h-\[44px\] items-center gap-1\.5 rounded-full border px-3\.5 text-xs font-semibold/); // UX refinement phase: "View all menu" is a bordered pill, still a 44px target
  assert.match(f, /text-xs font-semibold line-clamp-2 \[overflow-wrap:anywhere\]">\{item\.name\}/);
  assert.match(f, /href=\{`\/r\/\$\{username\}`\}/, "ordering route unchanged");
});
await test("Support the Artist amounts and actions are 44px (class changes only)", () => {
  const s = src("components/music/SupportArtistSection.tsx");
  assert.equal(count(s, /px-3 py-1\.5 min-h-\[44px\] rounded-full/g), 2);
  assert.match(s, /px-3\.5 py-2\.5 min-h-\[44px\] rounded-card/);
  assert.match(s, /py-2\.5 min-h-\[44px\] rounded-full transition hover:brightness-95/);
});
await test("the fan panel stays on screen on a phone: a full-width card under the header, the anchored 256px panel from sm up", () => {
  const f = src("components/FanRecognitionHeader.tsx");
  assert.match(f, /className="fixed left-4 right-4 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-64 rounded-2xl overflow-hidden z-20 text-sm outline-none"/);
  assert.doesNotMatch(f, /className="absolute top-11 right-0 w-64/);
  assert.match(f, /role="dialog"/);
  assert.match(f, /aria-haspopup="dialog"/, "Phase 3D semantics kept");
});
await test("reduced motion: both avatar pulse rings and the global entrance animations are switched off", () => {
  const v = src("components/ProfileView.tsx");
  assert.equal(count(v, /motion-reduce:animate-none/g), 2);
  assert.match(v, /<MotionConfig reducedMotion="user">/);
  const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.animate-fade-up/);
});
await test("what must not move did not: Music / Restaurant heroes and Stay Connected are byte-identical to the approved versions", () => {
  const pins = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/tests/heroActionPins.json"), "utf8"));
  for (const f of Object.keys(pins)) assert.equal(sha(f), pins[f], `${f} changed`);
});
await test("no horizontal-scroll workaround was introduced", () => {
  for (const f of ["components/ProfileView.tsx", "components/music/EventsSection.tsx", "components/music/MusicSection.tsx", "components/restaurant/FeaturedMenuSection.tsx", "components/FanRecognitionHeader.tsx"]) {
    assert.doesNotMatch(src(f), /overflow-x-auto|overflow-x-scroll|overflow-x-hidden/, f);
  }
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
