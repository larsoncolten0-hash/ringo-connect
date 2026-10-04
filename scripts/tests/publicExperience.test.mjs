// Phase 3 (public Ringo experience), first pass: 3A meaningful public content, 3G public states and
// language, 3D public accessibility. Pure logic is exercised directly; React wiring is checked on the
// source with comments stripped (there is no React renderer in this repo), so a comment that merely
// mentions a behaviour cannot satisfy a check.
//   Run:  node scripts/tests/publicExperience.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });

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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (rel) => strip(raw(rel));
const count = (s, re) => (s.match(re) || []).length;

const C = jiti(path.join(SRC, "lib/publicContent.ts"));
const N = jiti(path.join(SRC, "components/ui/menuNav.ts"));
const { translations: TR } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

// ------------------------------------------------------------------ 3A: meaningful public content
await test("3A links: only a real, safe address is shown; the editor's empty placeholders are not", () => {
  const shown = ["https://example.com", "http://example.com/a?b=1", "example.com", "  instagram.com/ringo ", "mailto:a@b.co", "tel:+237677123456", "whatsapp://send?phone=237677123456"];
  for (const url of shown) assert.equal(C.isPublicLink({ url, title: "x" }), true, url);
  const hollow = ["", "   ", "https://", "http://", "https:///", "mailto:", null, undefined, 42, "hello world", "javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "​javascript:alert(1)", "data:text/html,x", "vbscript:x"];
  for (const url of hollow) assert.equal(C.isPublicLink({ url, title: "Visit" }), false, JSON.stringify(url));
  assert.equal(C.isPublicLink(null), false);
  assert.equal(C.isPublicLink(undefined), false);
});
await test("3A links: a usable address is shown even without a title (the address becomes the label)", () => {
  assert.equal(C.isPublicLink({ url: "https://www.example.com/shop/", title: "" }), true);
  assert.equal(C.publicLinkTitle({ url: "https://www.example.com/shop/", title: "" }), "example.com/shop");
  assert.equal(C.publicLinkTitle({ url: "mailto:a@b.co", title: "  " }), "a@b.co");
  assert.equal(C.publicLinkTitle({ url: "https://x.co", title: "  My shop  " }), "My shop");
  assert.equal(C.publicLinkTitle({ url: "example.com" }), "example.com");
  assert.equal(C.publicLinkTitle({}), "");
});
await test("3A social links follow the same rule as links", () => {
  assert.equal(C.isPublicSocialLink({ platform: "instagram", url: "https://instagram.com/ringo" }), true);
  assert.equal(C.isPublicSocialLink({ platform: "instagram", url: "instagram.com/ringo" }), true);
  assert.equal(C.isPublicSocialLink({ platform: "instagram", url: "https://" }), false);
  assert.equal(C.isPublicSocialLink({ platform: "instagram", url: "" }), false);
  assert.equal(C.isPublicSocialLink({ platform: "instagram", url: "javascript:alert(1)" }), false);
});
await test("3A products, dishes, tracks and releases need a name / title; a price or photo alone is not enough", () => {
  assert.equal(C.isPublicProduct({ name: "Shirt" }), true);
  assert.equal(C.isPublicProduct({ name: "  " }), false);
  assert.equal(C.isPublicProduct({ name: "", price: 5000, image_url: "https://a/b.jpg", description: "d" }), false);
  assert.equal(C.isPublicProduct({}), false);
  assert.equal(C.isPublicMenuItem({ name: "Ndolé" }), true);
  assert.equal(C.isPublicMenuItem({ name: "", price: 2500 }), false);
  assert.equal(C.isPublicTrack({ title: "Song" }), true);
  assert.equal(C.isPublicTrack({ title: "", artist_name: "Ada", audio_url: "https://a/x.mp3" }), false);
  assert.equal(C.isPublicRelease({ title: "EP 1" }), true);
  assert.equal(C.isPublicRelease({ title: " ", price: 2000, cover_image_url: "https://a/c.jpg" }), false);
  for (const f of [C.isPublicProduct, C.isPublicMenuItem, C.isPublicTrack, C.isPublicRelease]) {
    assert.equal(f(null), false);
    assert.equal(f(undefined), false);
  }
});
await test("3A publicRows keeps the original order, never mutates the input and tolerates missing lists", () => {
  const rows = [{ id: 1, name: "A" }, { id: 2, name: "" }, { id: 3, name: "C" }];
  const before = JSON.stringify(rows);
  assert.deepEqual(C.publicRows(rows, C.isPublicProduct).map((r) => r.id), [1, 3]);
  assert.equal(JSON.stringify(rows), before, "input untouched");
  assert.deepEqual(C.publicRows(null, C.isPublicProduct), []);
  assert.deepEqual(C.publicRows(undefined, C.isPublicProduct), []);
  assert.deepEqual(C.publicRows("nope", C.isPublicProduct), []);
  assert.notStrictEqual(C.publicRows(rows, () => true), rows, "a copy, so a caller may sort it");
});
await test("3A agrees with the Profile Health definitions it is built on (a link / product counted there is shown here, except unsafe addresses)", () => {
  const H = jiti(path.join(SRC, "lib/profileHealth/criteria.ts"));
  const profile = {
    links: [{ url: "https://a.co" }, { url: "https://" }, { url: "" }, { url: "javascript:alert(1)" }],
    products: [{ name: "Shirt" }, { name: "" }, { name: "  " }],
    menu_items: [{ name: "Ndolé" }, { name: "" }],
    tracks: [{ title: "Song" }, { title: "" }],
    music_releases: [{ title: "EP" }, { title: "" }],
  };
  const m = H.meaningfulRows(profile);
  assert.equal(C.publicRows(profile.products, C.isPublicProduct).length, m.products.length);
  assert.equal(C.publicRows(profile.menu_items, C.isPublicMenuItem).length, m.menuItems.length);
  assert.equal(C.publicRows(profile.tracks, C.isPublicTrack).length, m.tracks.length);
  assert.equal(C.publicRows(profile.music_releases, C.isPublicRelease).length, m.releases.length);
  // links: Health counts "has more than a scheme"; the public page additionally refuses an unsafe scheme
  assert.equal(m.links.length, 2);
  assert.equal(C.publicRows(profile.links, C.isPublicLink).length, 1);
});
await test("3A ProfileView renders only the filtered lists (no raw row lists left in the public sections)", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /publicRows<any>\(profile\.links, isPublicLink\)/);
  assert.match(v, /publicRows<any>\(profile\.social_links, isPublicSocialLink\)/);
  assert.match(v, /publicRows<any>\(profile\.products, isPublicProduct\)/);
  assert.match(v, /publicRows<any>\(profile\.menu_items, isPublicMenuItem\)/);
  assert.match(v, /publicRows<any>\(profile\.tracks, isPublicTrack\)/);
  assert.match(v, /publicRows<any>\(profile\.music_releases, isPublicRelease\)/);
  // Phase 3C moved the link / catalogue / events blocks into the keyed \`sections\` object (placed by lib/sectionOrder.ts)
  assert.match(v, /links: publicLinks\.length > 0 && \(/);
  assert.match(v, /\{socialLinks\.length > 0 && \(/);
  assert.match(v, /releases=\{releases\}/);
  assert.match(v, /publicLinkTitle\(link\)/);
  assert.match(v, /href=\{displayHref\(link\.url\)\}/, "the link href still goes through displayHref");
  assert.doesNotMatch(v, /profile\.links\?\.length/);
  assert.doesNotMatch(v, /profile\.social_links\?\.length/);
  assert.doesNotMatch(v, /profile\.links\s*\.sort/);
  assert.doesNotMatch(v, /\(profile\.products \|\| \[\]\)/);
  assert.doesNotMatch(v, /releases=\{profile\.music_releases/);
  assert.doesNotMatch(v, /=\s*profile\.menu_items \|\| \[\]/);
});
await test("3A it is a rendering decision only: the helper has no database, storage or delete code", () => {
  const h = src("lib/publicContent.ts");
  assert.doesNotMatch(h, /supabase|\.delete\(|\.update\(|\.insert\(|fetch\(|localStorage/);
});

// ------------------------------------------------------------------ 3G: public states and language
await test("3G the loading and not-found texts exist in English AND French and are really translated", () => {
  for (const k of ["loading", "notFoundTitle", "notFoundBody", "notFoundCta", "skipToContent"]) {
    const en = TR.en.profilePage[k];
    const fr = TR.fr.profilePage[k];
    assert.ok(typeof en === "string" && en.trim().length > 0, `en ${k}`);
    assert.ok(typeof fr === "string" && fr.trim().length > 0, `fr ${k}`);
    assert.notEqual(en, fr, `${k} is not translated`);
  }
  assert.match(TR.fr.profilePage.loading, /Chargement/);
});
await test("3G the site loader no longer hard-codes English; it uses the translated label", () => {
  const l = src("app/loading.tsx");
  assert.doesNotMatch(l, /Loading your Ringo/);
  assert.match(l, /<LoadingLabel \/>/);
  assert.match(src("components/public/PublicStates.tsx"), /t\.profilePage\.loading/);
});
await test("3G the profile not-found page is bilingual, branded, has a 44px way home, and reveals nothing about why", () => {
  assert.ok(fs.existsSync(path.join(SRC, "app/[username]/not-found.tsx")));
  const nf = src("app/[username]/not-found.tsx");
  assert.match(nf, /<PublicNotFound \/>/);
  assert.doesNotMatch(nf, /supabase|isPublicProfileSuspended|headers\(|cookies\(|notFound\(/, "the screen decides nothing: status and suspension logic stay in the routes");
  const s = src("components/public/PublicStates.tsx");
  assert.match(s, /<h1[^>]*>\{t\.profilePage\.notFoundTitle\}<\/h1>/);
  assert.match(s, /t\.profilePage\.notFoundBody/);
  assert.match(s, /t\.profilePage\.notFoundCta/);
  assert.match(s, /href="\/"/);
  assert.match(s, /min-h-\[44px\]/);
  assert.match(s, /src="\/logo\.png"/);
  assert.doesNotMatch(s.replace(/\{t\.[^}]+\}/g, ""), />\s*[A-Za-z][A-Za-z ,.'’!?:-]{2,}\s*</, "no literal JSX text");
});
await test("3G the routes still answer 404 through notFound(); suspension handling is untouched", () => {
  const page = src("app/[username]/page.tsx");
  assert.match(page, /if \(!profile\) return notFound\(\);/);
  assert.match(page, /if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/);
});

// ------------------------------------------------------------------ 3D: public accessibility
await test("3D menuNav: arrow keys wrap, Home / End jump, other keys are left alone", () => {
  assert.equal(N.nextMenuIndex("ArrowDown", 0, 3), 1);
  assert.equal(N.nextMenuIndex("ArrowDown", 2, 3), 0);
  assert.equal(N.nextMenuIndex("ArrowUp", 0, 3), 2);
  assert.equal(N.nextMenuIndex("ArrowUp", 2, 3), 1);
  assert.equal(N.nextMenuIndex("ArrowDown", -1, 3), 0);
  assert.equal(N.nextMenuIndex("ArrowUp", -1, 3), 2);
  assert.equal(N.nextMenuIndex("Home", 2, 3), 0);
  assert.equal(N.nextMenuIndex("End", 0, 3), 2);
  assert.equal(N.nextMenuIndex("a", 0, 3), null);
  assert.equal(N.nextMenuIndex("Enter", 0, 3), null);
  assert.equal(N.nextMenuIndex("ArrowDown", 0, 0), null);
});
await test("3D tap area: the invisible extension takes a 36px control to 44px", () => {
  assert.equal(N.MIN_TAP_TARGET_PX, 44);
  assert.match(N.TAP_AREA_36, /before:absolute/);
  assert.match(N.TAP_AREA_36, /before:-inset-1/);
  assert.equal(36 + 2 * 4, N.MIN_TAP_TARGET_PX);
});
await test("3D Share: a real menu - haspopup, controls, role=menu, menuitems, Escape returns focus, arrow keys, first item focused", () => {
  const s = src("components/ShareButton.tsx");
  assert.match(s, /aria-haspopup="menu"/);
  assert.match(s, /aria-controls=\{open \? menuId : undefined\}/);
  assert.match(s, /role="menu"/);
  assert.ok(count(s, /role="menuitem"/g) >= 6, "copy, QR, WhatsApp, Facebook, X and the native share item");
  assert.match(s, /e\.key === "Escape"/);
  assert.match(s, /triggerRef\.current\?\.focus\(\)/);
  assert.match(s, /nextMenuIndex\(e\.key,/);
  assert.match(s, /querySelector<HTMLElement>\('\[role="menuitem"\]'\)\?\.focus\(\)/);
  assert.match(s, /onKeyDown=\{onMenuKeyDown\}/);
  assert.match(s, /reduceMotion \? 0 : 0\.15/);
  assert.match(s, /\$\{TAP_AREA_36\}/, "the trigger's class list includes the tap-area extension (not just the import)");
  assert.ok(count(s, /min-h-\[44px\]/g) >= 1, "menu rows are 44px");
});
await test("3D Share: the QR sheet is a real modal with a name, trap, Escape, focus return and a 44px close button", () => {
  const s = src("components/ShareButton.tsx");
  assert.match(s, /useModalA11y<HTMLDivElement>\(onClose\)/);
  assert.match(s, /role="dialog"/);
  assert.match(s, /aria-modal="true"/);
  assert.match(s, /aria-label=\{label\}/);
  assert.match(s, /<QrDialogShell label=\{strings\.qrCodeTitle\(title\)\} onClose=\{closeQr\}>/);
  assert.match(s, /const closeQr = \(\) => \{\s*setShowQr\(false\);\s*triggerRef\.current\?\.focus\(\);/);
  assert.match(s, /aria-label=\{strings\.close\}[\s\S]{0,40}className="[^"]*w-11 h-11/);
  assert.doesNotMatch(s, /className="absolute right-4 top-4 w-8 h-8/);
});
await test("3D the fan badge: haspopup, controls, a labelled dialog panel, Escape returns focus, 44px actions", () => {
  const f = src("components/FanRecognitionHeader.tsx");
  assert.match(f, /aria-haspopup="dialog"/);
  assert.match(f, /aria-controls=\{open \? panelId : undefined\}/);
  assert.match(f, /role="dialog"/);
  assert.match(f, /aria-label=\{t\.communitySection\.fanBadgeLabel\(membership\.name\)\}/);
  assert.match(f, /e\.key === "Escape"/);
  assert.match(f, /triggerRef\.current\?\.focus\(\)/);
  assert.match(f, /panelRef\.current\?\.focus\(\)/);
  assert.match(f, /\$\{TAP_AREA_36\}/);
  assert.ok(count(f, /min-h-\[44px\]/g) >= 2, "the notifications button and the manage link");
  assert.match(f, /reduceMotion \? 0 : 0\.15/);
  // business logic is as it was
  assert.match(f, /readMembership\(username\)/);
  assert.match(f, /\/api\/push\/subscribe-subscriber/);
});
await test("3D Stay Connected: the shared modal behaviour is attached to the dialog, with a 44px close button and the same API calls", () => {
  const m = src("components/connect/StayConnectedModal.tsx");
  assert.match(m, /import \{ useModalA11y \} from "@\/components\/ui\/useModalA11y"/);
  assert.match(m, /function DialogPanel\(/);
  assert.match(m, /useModalA11y<HTMLDivElement>\(onClose\)/);
  assert.match(m, /role="dialog"/);
  assert.match(m, /aria-modal="true"/);
  assert.match(m, /<DialogPanel label=\{t\.connect\.modalTitle\} onClose=\{onClose\}>/);
  assert.match(m, /aria-label=\{t\.connect\.close\}[\s\S]{0,120}h-11 w-11/);
  assert.doesNotMatch(m, /h-8 w-8/);
  for (const ep of ["/api/customer/connect/start", "/api/customer/connect/verify", "/api/customer/connect/register"]) assert.ok(m.includes(ep), ep);
  assert.doesNotMatch(m, /\/api\/customer\/(me|signin|logout)/, "no new customer endpoint");
});
await test("3D the language selector keeps its keyboard behaviour and gets 44px targets", () => {
  const l = src("components/PublicLanguageSelector.tsx");
  assert.match(l, /\$\{TAP_AREA_36\}/);
  assert.match(l, /min-h-\[44px\] cursor-pointer/);
  assert.doesNotMatch(l, /min-h-\[40px\]/);
  assert.match(l, /e\.key === "Escape"/);
});
await test("3D ProfileView: skip link, landmark footer, quiet decorative emoji, reduced-motion pulse and framer config", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /href="#profile-content"/);
  assert.match(v, /\{t\.profilePage\.skipToContent\}/);
  assert.match(v, /\{!preview && \(\s*<a\s+href="#profile-content"/, "the skip link is public-page only");
  assert.match(v, /id=\{preview \? undefined : "profile-content"\}/);
  assert.match(v, /<footer role="contentinfo"/);
  assert.match(v, /<span className="text-lg" aria-hidden="true">🎵<\/span>/);
  assert.equal(count(v, /motion-reduce:animate-none/g), 2, "both pulse rings");
  assert.match(v, /<MotionConfig reducedMotion="user">/);
  assert.match(v, /<\/MotionConfig>/);
});
await test("3D public section headings are real <h2> elements with the same classes (look unchanged)", () => {
  const expect = [
    ["components/ProfileView.tsx", /<h2\s+className=\{isMusic \? "text-base font-bold flex items-center gap-2" : "text-\[11px\] uppercase tracking-wider"\}/],
    ["components/music/MusicSection.tsx", /<h2 className="text-base font-bold flex items-center gap-2">/],
    ["components/music/ReleasesSection.tsx", /<h2 className="text-base font-bold flex items-center gap-2">/],
    ["components/music/EventsSection.tsx", /<h2 className="text-base font-bold flex items-center gap-2">/],
    ["components/music/SupportArtistSection.tsx", /<h2 className="text-base font-bold">/],
    ["components/restaurant/FeaturedMenuSection.tsx", /<h2 className="text-base font-bold">/],
    ["components/catalog/CatalogSection.tsx", /<h2 className="flex items-center gap-2 text-\[11px\] font-medium uppercase tracking-\[0\.18em\]"/],
  ];
  for (const [f, re] of expect) assert.match(src(f), re, f);
  assert.equal(count(src("components/ProfileView.tsx"), /<h1\b/g), 1, "still exactly one h1");
});

await test("3D focus return: the opener is captured BEFORE the dialog mounts, so an autoFocus field cannot become the 'previous' element", () => {
  const h = src("components/ui/useModalA11y.ts");
  const hook = h.slice(h.indexOf("export function useModalA11y"));
  const capture = hook.indexOf("openerRef.current = document.activeElement");
  const firstEffect = hook.indexOf("useEffect(");
  assert.ok(capture > 0, "the opener is read from document.activeElement into a ref");
  assert.ok(firstEffect > 0 && capture < firstEffect, "...during render, before any effect (autoFocus has already run by the time an effect does)");
  assert.match(hook, /if \(openerRef\.current === null && typeof document !== "undefined"\) openerRef\.current = /, "captured once, SSR-safe");
  const effect = hook.slice(firstEffect);
  assert.doesNotMatch(effect, /const previous = document\.activeElement/, "no late capture inside the effect");
  assert.match(effect, /const opener = openerRef\.current;\s*if \(opener && opener !== document\.body && opener\.isConnected\) opener\.focus\?\.\(\);/, "restored on close only if the opener is still on the page");
  // the dialogs that rely on it are unchanged in how they use it
  assert.match(src("components/connect/StayConnectedModal.tsx"), /autoFocus/, "the modal keeps its autoFocus fields");
  assert.match(src("components/connect/StayConnectedModal.tsx"), /useModalA11y<HTMLDivElement>\(onClose\)/);
  assert.match(src("components/ShareButton.tsx"), /const closeQr = \(\) => \{\s*setShowQr\(false\);\s*triggerRef\.current\?\.focus\(\);/, "the QR sheet still returns focus to its Share button itself");
  assert.match(h, /document\.addEventListener\("keydown", onKey, true\)/, "Escape / Tab trap unchanged");
  assert.match(h, /nextTrapIndex\(idx, list\.length, e\.shiftKey\)/);
});

// ------------------------------------------------------------------ shared-component safety (ProfileView is also the editor preview)
await test("preview safety: public-only behaviour is still gated on `preview`, and the Connect / owner logic is as before", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /const logClick = async[\s\S]{0,400}if \(preview\) return;/, "no pixel / analytics from the editor preview");
  assert.match(v, /\{!preview && <RegisterServiceWorker \/>\}/);
  assert.match(v, /\{!preview && <AppBadgeReset \/>\}/);
  assert.match(v, /\{!preview && \(\s*<div className="absolute top-4 right-4 z-20/, "share / language / fan cluster is public-only");
  assert.match(v, /\{!isOwner && \(\s*<ConnectButton[\s\S]{0,400}preview=\{preview\}/);
  assert.match(v, /\{!preview && \(\s*<AddToHomeScreen/);
  assert.match(v, /fbPixelId = !preview && pixelsEnabled/);
});
await test("preview parity: the preview feeds ProfileView the same plan-limited rows, which then pass through the same public filter", () => {
  const lp = src("components/editor/LivePreviewPanel.tsx");
  assert.match(lp, /ProfileView/);
  assert.match(lp, /preview/);
  const plan = src("lib/previewPlan.ts");
  assert.match(plan, /limitPublicRows/);
  // ProfileView is the only place the public filter is applied, so preview and public cannot diverge
  assert.ok(count(src("components/ProfileView.tsx"), /publicRows</g) >= 6);
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
