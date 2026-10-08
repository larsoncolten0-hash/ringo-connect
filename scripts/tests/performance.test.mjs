// The performance project (phases 2-6): what it changes is proven here, and so is what it must NOT change.
// Run: node scripts/tests/performance.test.mjs
// Real components are server-rendered where that matters; every claim about the request waterfall, the cache and the image rules is checked against the source and the helpers' behaviour.
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PHASE26_FILES } from "./phase26Files.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const git = (a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
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

const ORIGIN = "https://abcdefgh.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
const IMG = `${ORIGIN}/storage/v1/object/public/uploads/u1/avatar/a.png`;
const U = jiti(path.join(SRC, "lib/imageUrl.ts"));

// =============================================================================== PHASE 2: images
await test("imageUrl: only a public still image of THIS project's uploads bucket can be transformed; everything else is returned exactly as given", () => {
  assert.equal(U.isTransformableImage(IMG), true);
  for (const bad of [
    `https://evil.example.com/storage/v1/object/public/uploads/u1/a.png`,
    `https://abcdefgh.supabase.co.evil.com/storage/v1/object/public/uploads/a.png`,
    `https://other.supabase.co/storage/v1/object/public/uploads/a.png`,
    `${ORIGIN}/storage/v1/object/public/protected-audio/a.png`,
    `${ORIGIN}/storage/v1/object/sign/uploads/a.png?token=x`,
    `${ORIGIN}/storage/v1/object/authenticated/uploads/a.png`,
    `${ORIGIN}/storage/v1/object/public/uploads/a.png?download=1`,
    `${ORIGIN}/storage/v1/object/public/uploads/a.gif`,
    `${ORIGIN}/storage/v1/object/public/uploads/a.SVG`,
    `${ORIGIN}/storage/v1/object/public/uploads/../private/a.png`,
    `${ORIGIN}/storage/v1/object/public/uploads/`,
    "http://abcdefgh.supabase.co/storage/v1/object/public/uploads/a.png",
    "data:image/png;base64,AAAA",
    "blob:https://abcdefgh.supabase.co/1",
    "javascript:alert(1)",
    "/default-avatar.png",
    "not a url",
    "",
    null,
    undefined,
  ]) {
    assert.equal(U.isTransformableImage(bad), false, String(bad));
    assert.equal(U.transformedImageUrl(bad, { width: 300 }), bad || "", "unchanged: " + String(bad));
    assert.equal(U.imageSrcSet(bad, [200, 400]), "");
  }
});
await test("imageUrl: the transformed URL is the same object served by Supabase Image Transformations at the requested width; the original is never rewritten", () => {
  assert.equal(U.transformedImageUrl(IMG, { width: 320 }), `${ORIGIN}/storage/v1/render/image/public/uploads/u1/avatar/a.png?width=320&quality=75`);
  assert.equal(U.transformedImageUrl(IMG, { width: 320, square: true }), `${ORIGIN}/storage/v1/render/image/public/uploads/u1/avatar/a.png?width=320&height=320&resize=cover&quality=75`);
  assert.match(U.transformedImageUrl(IMG, { width: 99999 }), /width=2000&/, "width is clamped");
  assert.match(U.transformedImageUrl(IMG, { width: 1 }), /width=16&/);
  assert.equal(U.imageSrcSet(IMG, [200, 400]).split(", ").length, 2);
  assert.match(U.imageSrcSet(IMG, [200, 400]), / 200w, .* 400w$/);
  assert.match(U.imageDensitySrcSet(IMG, 96), / 1x, .*width=192.* 2x, .*width=288.* 3x$/);
  assert.ok(!/storage\/v1\/object\//.test(U.imageSrcSet(IMG, [200])), "only the render endpoint is referenced");
});
await test("imageUrl: with no configured project URL nothing is ever rewritten", () => {
  const keep = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.equal(U.isTransformableImage(IMG), false);
    assert.equal(U.transformedImageUrl(IMG, { width: 300 }), IMG);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = keep;
  }
});
await test("OptImg: a plain <img> with a srcset of right-sized copies, lazy by default, eager + high priority only when asked, original kept as the failure fallback", () => {
  const { transform } = require("sucrase");
  const code = transform(fs.readFileSync(path.join(SRC, "components/ui/OptImg.tsx"), "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((id) => (id.startsWith("@/") ? jiti(path.join(SRC, id.slice(2))) : require(id)), mod, mod.exports);
  const Opt = mod.exports.default;
  const html = (props) => renderToStaticMarkup(React.createElement(Opt, props));
  const lazy = html({ src: IMG, widths: [200, 400, 800], sizes: "50vw", alt: "x", className: "c" });
  assert.match(lazy, /<img[^>]*loading="lazy"/);
  assert.match(lazy, /srcSet="[^"]*width=200[^"]* 200w, [^"]*width=400[^"]* 400w, [^"]*width=800[^"]* 800w"/);
  assert.match(lazy, /sizes="50vw"/);
  assert.ok(lazy.includes('class="c"') && lazy.includes('alt="x"') && lazy.includes('decoding="async"'));
  assert.ok(!/ src="[^"]*object\/public/.test(lazy), "the default src is the resized copy, not the multi-megapixel original");
  const hero = html({ src: IMG, widths: [200, 400], sizes: "100vw", priority: true });
  assert.ok(hero.includes('loading="eager"') && hero.includes('fetchpriority="high"'), "the one priority image");
  assert.ok(!html({ src: IMG, widths: [200, 400] }).includes("fetchpriority"), "nothing else is high priority");
  const fixed = html({ src: IMG, cssWidth: 96, square: true });
  assert.match(fixed, /srcSet="[^"]* 1x, [^"]* 2x, [^"]* 3x"/);
  const foreign = html({ src: "https://cdn.example.com/a.png", widths: [200, 400] });
  assert.ok(foreign.includes('src="https://cdn.example.com/a.png"') && !foreign.includes("srcSet"), "a foreign or default image is a plain <img>");
  assert.equal(html({ src: null }), "", "no source, nothing rendered");
  const source = strip(raw("src/components/ui/OptImg.tsx"));
  assert.ok(/onError=\{\(\) => \{\s*if \(transformable\) setFailed\(true\);/.test(source) && source.includes("const srcAttr = useOptimized ? transformedImageUrl(src, { width: fallbackWidth, square }) : src;"), "if the resized copy cannot be loaded the original file is used");
  assert.ok(source.includes("el.complete && el.naturalWidth === 0"), "a failure that happened before hydration is caught too");
});
await test("every public surface asks for right-sized images: avatar, cover, artwork, releases, products, events, shop, product pages, galleries", () => {
  const need = {
    "src/components/ProfileView.tsx": [/<OptImg src=\{profile\.cover_image_url\}[^>]*priority/, /<OptImg\s+src=\{profile\.avatar_url \|\| "\/default-avatar\.png"\}[\s\S]*?square[\s\S]*?priority/],
    "src/components/catalog/CatalogSection.tsx": [/<OptImg\s+src=\{images\[0\]\}/],
    "src/components/ImageGallery.tsx": [/<OptImg src=\{urls\[0\]\}/, /priority=\{i === 0\}/],
    "src/components/music/profile/MusicArtistView.tsx": [/<OptImg src=\{cover\}[^>]*priority/, /<OptImg\s+src=\{profile\.avatar_url \|\| "\/default-avatar\.png"\}[\s\S]*?square/],
    "src/components/music/profile/MusicSections.tsx": [/<OptImg src=\{r\.cover_image_url\}/, /<OptImg src=\{image\}/, /<OptImg src=\{img\}/],
    "src/components/music/profile/MusicDestinationView.tsx": [/<OptImg src=\{img\}[^>]*priority/, /<OptImg src=\{event\.cover_image_url\}[^>]*priority/],
    "src/components/music/ReleasesSection.tsx": [/<OptImg src=\{release\.cover_image_url\}/],
    "src/components/music/ItemDetailPage.tsx": [/<OptImg src=\{src\}[^>]*priority/],
    "src/components/catalog/ProductDetailView.tsx": [/<OptImg src=\{profile\.avatar_url\}/, /priority=\{i === 0\}/],
    "src/components/shop/ShopDestination.tsx": [/<OptImg src=\{profile\.cover_image_url\}[^>]*priority/, /<OptImg src=\{profile\.avatar_url\}/, /<OptImg src=\{images\[0\]\}/],
    "src/components/restaurant/FeaturedMenuSection.tsx": [/<OptImg\s+src=\{item\.image_urls/],
  };
  for (const [f, res] of Object.entries(need)) for (const re of res) assert.match(raw(f), re, `${f}: ${re}`);
  assert.ok(!/<img src=\{profile\.cover_image_url\}|<img src=\{profile\.avatar_url/.test(raw("src/components/shop/ShopDestination.tsx") + raw("src/components/ProfileView.tsx")), "no raw original on the hero images");
});
await test("new uploads are sized for their use: avatar 512, cover 1280, artwork and products 1200; aspect ratio kept; the general mode is unchanged", () => {
  const D = jiti(path.join(SRC, "lib/imageDownscale.ts"));
  assert.deepEqual({ ...D.UPLOAD_TARGETS.avatar, quality: 0 }, { maxEdge: 512, minBytes: 60 * 1024, quality: 0 });
  assert.equal(D.UPLOAD_TARGETS.cover.maxEdge, 1280);
  assert.equal(D.UPLOAD_TARGETS.art.maxEdge, 1200);
  assert.equal(D.UPLOAD_TARGETS.product.maxEdge, 1200);
  assert.deepEqual(["avatar", "cover", "products", "tracks", "releases", "events", "links", "community", "menu-items", "x", null].map(D.uploadKindForFolder), ["avatar", "cover", "product", "art", "art", "art", null, null, null, null, null], "only the profile photo, cover, artwork and product folders are targeted");
  const big = { type: "image/png", size: 3_000_000 };
  assert.deepEqual(D.planDownscale(big, { width: 1242, height: 2688 }, { maxEdge: 512, minBytes: 60 * 1024, reencode: true }), { width: 237, height: 512 }, "aspect ratio is preserved: no crop");
  assert.deepEqual(D.planDownscale(big, { width: 1000, height: 800 }, { maxEdge: 1200, minBytes: 1, reencode: true }), { width: 1000, height: 800 }, "already small, but heavy: re-encoded at its own size");
  assert.equal(D.planDownscale({ ...big, size: 10_000 }, { width: 4000, height: 3000 }, { maxEdge: 512, minBytes: 60 * 1024 }), null, "a light file is left alone");
  assert.equal(D.planDownscale({ type: "image/gif", size: 3_000_000 }, { width: 4000, height: 3000 }, { maxEdge: 512, minBytes: 1, reencode: true }), null, "an animated GIF is never re-encoded");
  assert.equal(D.planDownscale({ type: "image/svg+xml", size: 3_000_000 }, { width: 4000, height: 3000 }, { maxEdge: 512, minBytes: 1 }), null);
  assert.deepEqual(D.planDownscale({ type: "image/jpeg", size: 2_000_000 }, { width: 4000, height: 3000 }), { width: D.MAX_EDGE, height: 1200 }, "no kind: exactly the old behaviour");
  assert.equal(D.planDownscale({ type: "image/jpeg", size: 2_000_000 }, { width: 1000, height: 800 }), null, "no kind and already small: left alone, as before");
  const src = strip(raw("src/lib/imageDownscale.ts"));
  assert.ok(/hasTransparency\(canvas\) \? "image\/webp" : "image\/jpeg"/.test(src), "transparency is detected: a transparent PNG becomes WebP (kept transparent), an opaque one JPEG");
  assert.ok(/blob\.size >= file\.size\) return file/.test(src) && /catch \{\s*return file;/.test(src), "never larger, never a failed upload");
  const field = strip(raw("src/components/editor/ImageUploadField.tsx"));
  assert.ok(field.includes("downscaleImage(file, optimizeFor ?? uploadKindForFolder(folder))") && field.includes('prepared.name.split(".").pop()'), "the stored extension is the real type");
  assert.ok(strip(raw("src/components/editor/ImageGalleryUploadField.tsx")).includes("downscaleImage(file, uploadKindForFolder(folder))"));
  for (const f of ["src/components/editor/AudioUploadField.tsx", "src/components/editor/ProtectedAudioUploadField.tsx", "src/components/editor/DigitalFileUploadField.tsx"]) assert.ok(!/downscale/.test(raw(f)), `${f} (audio / files) untouched`);
  assert.match(strip(raw("src/components/editor/AvatarCropperField.tsx")), /OUTPUT_SIZE = 512/, "the avatar cropper already exports 512 x 512 and is unchanged");
});

// =============================================================================== PHASE 2: waterfall, branding
await test("owner check: ONE query by username (the profile with its owner and plan embedded) serves the suspension check AND the plan limits; same fail-open rule; still read-only", () => {
  const s = strip(raw("src/lib/publicProfileVisibility.ts"));
  assert.equal((s.match(/\.from\("/g) || []).length, 1, "a single table read");
  assert.match(s, /select\("user_id, users\(status, plans\(max_links, max_products, custom_theme_enabled\)\)"\)/);
  assert.match(s, /owner\?\.status === "suspended"/);
  assert.match(s, /export const isPublicProfileSuspended = memo\(async \(username: string\): Promise<boolean> => \(await getPublicOwnerAccount\(username\)\)\.suspended\);/);
  for (const f of ["src/app/[username]/page.tsx", "src/app/m/[username]/page.tsx", "src/app/[username]/shop/page.tsx"]) assert.ok(strip(raw(f)).includes("(await getPublicOwnerAccount(params.username)).plan"), `${f}: the plan comes from that read`);
  assert.ok(s.includes("return { suspended: false, plan: null };") && s.includes("console.error"), "fails open and logs");
  assert.ok(!/\.(update|insert|delete|upsert)\(/.test(s));
});
await test("public profile: the profile, the suspension check and the visitor are read together; the page view is recorded alongside the other reads, after the gate, never for the owner", () => {
  const s = strip(raw("src/app/[username]/page.tsx"));
  assert.match(s, /const \[\{ data: profile \}, suspended, authResult\] = await Promise\.all\(\[/);
  assert.match(s, /if \(!profile\) return notFound\(\);\s*if \(suspended\) return notFound\(\);/);
  assert.ok(s.indexOf("if (suspended) return notFound();") < s.indexOf('from("click_events").insert'), "the visit is only ever recorded after the gate");
  assert.match(s, /isOwner\s*\?\s*Promise\.resolve\(\{ error: null \}\)/);
  assert.ok(/pixelsEnabled\s*\?\s*sendMetaPageView\(/.test(s), "the Conversions API call is still made, only for an owner whose Pixels are active");
  const meta = strip(raw("src/lib/profileMetadata.ts"));
  assert.match(meta, /Promise\.all\(\[[\s\S]*isPublicProfileSuspended\(username\),\s*\]\)/);
  assert.ok(meta.includes("if (data && suspended) return null;"), "a suspended profile still leaks no head tags");
});
await test("music destination pages: the profile read and the suspension check run together; encrypted Pixel tokens never reach the browser", () => {
  const s = strip(raw("src/lib/music/loadDestination.ts"));
  assert.match(s, /Promise\.all\(\[[\s\S]*isPublicProfileSuspended\(username\),\s*\]\)/);
  assert.match(s, /if \(!profile \|\| !profileHasCategory\(profile, "music_entertainment"\)\) return notFound\(\);\s*if \(suspended\) return notFound\(\);/);
  assert.ok(s.includes("facebook_capi_token_encrypted, tiktok_events_token_encrypted, facebook_test_event_code"));
});
await test("every other public route reads the profile and the owner check together (one stage), and the plan limits come from the same single read", () => {
  const routes = {
    "src/app/[username]/shop/page.tsx": "username",
    "src/app/[username]/item/[id]/page.tsx": "username",
    "src/app/[username]/item/[id]/checkout/page.tsx": "username",
    "src/app/r/[username]/page.tsx": "params.username",
    "src/app/r/[username]/item/[id]/page.tsx": "username",
    "src/app/m/[username]/page.tsx": "params.username",
    "src/app/m/[username]/[type]/[id]/page.tsx": "params.username",
  };
  for (const [f, u] of Object.entries(routes)) {
    const s = strip(raw(f));
    assert.ok(s.includes("const [{ data: profile }, suspended] = await Promise.all(["), `${f}: profile and suspension together`);
    assert.ok(s.includes("isPublicProfileSuspended(" + u + "),"), `${f}: the same suspension helper`);
    assert.ok(/if \(suspended\) return (null|notFound\(\));/.test(s), `${f}: the gate is acted on right after`);
  }
  for (const f of ["src/app/m/[username]/page.tsx", "src/app/[username]/shop/page.tsx"]) {
    const s = strip(raw(f));
    assert.ok(s.includes("(await getPublicOwnerAccount(params.username)).plan") && !/from\("users"\)/.test(s), `${f}: no separate plan query`);
    assert.ok(s.includes("max_products ?? null"), `${f}: the plan limit is applied exactly as before`);
  }
});
await test("branding: a short shared cache of the public platform branding, refreshed immediately when an admin saves; the admin editor always reads fresh", () => {
  const b = strip(raw("src/lib/branding.ts"));
  assert.match(b, /BRANDING_REVALIDATE_SECONDS = 60/);
  assert.match(b, /unstable_cache\(readBrandingRow, \["platform-branding-row"\], \{ revalidate: BRANDING_REVALIDATE_SECONDS, tags: \[BRANDING_CACHE_TAG\] \}\)/);
  assert.match(b, /try \{\s*data = await readBrandingRowCached\(\);\s*\} catch \{\s*data = await readBrandingRow\(\);/, "no cache available (tests, plain Node): read directly, as before");
  assert.ok(/branding_settings"\)\.select\("\*"\)\.limit\(1\)\.maybeSingle\(\)/.test(b));
  const route = strip(raw("src/app/api/admin/branding/route.ts"));
  assert.ok(route.indexOf("assertAdmin()") < route.indexOf("revalidateTag(BRANDING_CACHE_TAG)"), "only an admin can refresh it");
  assert.ok(route.includes("getBrandingSettingsFresh()"));
  assert.ok(raw("src/app/admin/branding/page.tsx").includes("getBrandingSettingsFresh"));
  // what is cached is the platform's public branding row only: no user, session or per-visitor input
  assert.ok(!/cookies\(|headers\(|auth\./.test(b));
});

// =============================================================================== PHASE 4: JavaScript
await test("translations: the two languages are two modules with the same shape; the aggregate still serves server code and tests; the provider ships only French up front", () => {
  const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
  const leaves = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? leaves(v, `${p}${k}.`) : [`${p}${k}${typeof v === "function" ? "()" : ""}`]));
  const en = leaves(translations.en).sort();
  const fr = leaves(translations.fr).sort();
  assert.ok(en.length > 5000, "the whole dictionary is there: " + en.length);
  assert.deepEqual(en.filter((k) => !fr.includes(k)), [], "no English key missing in French");
  assert.deepEqual(fr.filter((k) => !en.includes(k)), [], "no French key missing in English");
  const agg = strip(raw("src/lib/i18n/translations.ts"));
  assert.ok(agg.includes('import { en } from "./translations.en";') && agg.includes('import { fr } from "./translations.fr";') && agg.includes("export const translations = { en, fr }") && agg.includes("export type Translations = typeof en;"));
  assert.ok(raw("src/lib/i18n/translations.fr.ts").includes("export const fr: Translations = {"), "French is checked against the English shape at compile time");
  const p = strip(raw("src/components/LanguageProvider.tsx"));
  assert.ok(p.includes('import { fr } from "@/lib/i18n/translations.fr";'), "French (the default language) is bundled");
  assert.ok(p.includes('import("@/lib/i18n/translations.en")'), "English is a separate chunk, fetched on demand");
  assert.ok(!/from "@\/lib\/i18n\/translations"/.test(p.replace(/import type[^\n]*\n/g, "")), "the provider never imports the aggregate (both languages) as a value");
  assert.ok(p.includes('typeof window === "undefined"') && p.includes('require("@/lib/i18n/translations")'), "server rendering and tests keep both dictionaries");
  assert.ok(p.includes("resolveInitialLocale(saved, navigator.language)") && p.includes("localStorage.setItem(LOCALE_STORAGE_KEY, next)"), "the language choice is saved and restored exactly as before");
  assert.ok(p.includes("document.documentElement.lang = locale"));
});
await test("LanguageProvider: French by default (what the server renders and what hydrates), either language when asked, and the words always match the language", () => {
  const { transform } = require("sucrase");
  const cache = new Map();
  const load = (rel) => {
    const file = path.join(SRC, rel);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    if (!file.endsWith(".tsx")) {
      mod.exports = jiti(file);
      return mod.exports;
    }
    const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
    new Function("require", "module", "exports", code)((id) => (id.startsWith("@/") ? (id.endsWith(".tsx") ? load(id.slice(2) + "") : jiti(path.join(SRC, id.slice(2)))) : require(id)), mod, mod.exports);
    return mod.exports;
  };
  const { LanguageProvider, useLanguage } = load("components/LanguageProvider.tsx");
  const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
  const Probe = () => {
    const { locale, t } = useLanguage();
    return React.createElement("p", null, `${locale}|${t.common ? "" : ""}${t.editor.save}`);
  };
  const html = (props) => renderToStaticMarkup(React.createElement(LanguageProvider, props, React.createElement(Probe)));
  assert.equal(html({}), `<p>fr|${translations.fr.editor.save}</p>`, "no initial language: French");
  assert.equal(html({ initialLocale: "fr" }), `<p>fr|${translations.fr.editor.save}</p>`);
  assert.equal(html({ initialLocale: "en" }), `<p>en|${translations.en.editor.save}</p>`);
  assert.notEqual(translations.fr.editor.save, translations.en.editor.save, "the two languages really differ here");
});
await test("framer-motion on public pages: the components a profile loads use the lightweight `m` + domAnimation (same fades, slides, springs and exits), each wrapped in MotionScope; nothing else changed", () => {
  const scope = strip(raw("src/components/ui/MotionScope.tsx"));
  assert.ok(scope.includes("<LazyMotion features={domAnimation}>") && scope.includes("import { LazyMotion, domAnimation }") && !/features=\{\(\)/.test(scope), "features are bundled, not fetched later: nothing starts hidden and waits");
  for (const f of ["src/components/ShareButton.tsx", "src/components/FanRecognitionHeader.tsx", "src/components/connect/StayConnectedModal.tsx", "src/components/catalog/CatalogSection.tsx", "src/components/ui/MenuBackdrop.tsx"]) {
    const s = strip(raw(f));
    assert.ok(/import \{[^}]*\bm\b[^}]*\} from "framer-motion"/.test(s) && !/\bmotion\./.test(s) && /<MotionScope>/.test(s) && s.includes('import MotionScope from "@/components/ui/MotionScope"'), f);
    assert.ok(!/import \{[^}]*\bmotion\b[^}]*\} from "framer-motion"/.test(s), `${f}: no import of the full motion component`);
  }
  assert.match(strip(raw("src/components/ProfileView.tsx")), /import \{ MotionConfig \} from "framer-motion";/);
  assert.ok(raw("src/components/ProfileView.tsx").includes('<MotionConfig reducedMotion="user">'), "reduced motion is still honoured for the whole profile");
});
await test("the dashboard no longer ships the MP3 encoder or the crop widget up front: they load when the control that needs them is shown", () => {
  const track = strip(raw("src/components/editor/TrackRow.tsx"));
  assert.ok(track.includes('const ProtectedAudioUploadField = dynamic(() => import("./ProtectedAudioUploadField"));') && !/import ProtectedAudioUploadField from/.test(track));
  assert.ok(/<ProtectedAudioUploadField\s+protectedPath=\{track\.protected_audio_path\}/.test(track), "rendered with the same props");
  const crop = strip(raw("src/components/editor/AvatarCropperField.tsx"));
  assert.ok(crop.includes('dynamic(() => import("react-easy-crop"), { ssr: false })') && !/import Cropper/.test(crop));
  assert.match(strip(raw("src/components/editor/ProtectedAudioUploadField.tsx")), /trimToPreviewMp3|MAX_PREVIEW_SECONDS/, "the 10-second preview clip is still cut by the same code");
  assert.match(strip(raw("src/lib/audioTrim.ts")), /export \{ MAX_PREVIEW_SECONDS \}/);
});

// =============================================================================== PHASE 5: caching
await test("caching: the only shared cache is the public platform branding; profiles, owners, suspension, plans, stock, orders, payments and sessions are read live on every request", () => {
  const users = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && /unstable_cache|revalidate\s*[:=]\s*[1-9]|next:\s*\{\s*revalidate|force-cache/.test(fs.readFileSync(f, "utf8"))) users.push(path.relative(REPO, f).replace(/\\/g, "/"));
    }
  };
  walk(SRC);
  assert.deepEqual(users.sort(), ["src/app/sitemap.ts", "src/lib/branding.ts"], "only the branding row (and the pre-existing hourly sitemap) are cached");
  for (const f of ["src/app/[username]/page.tsx", "src/app/m/[username]/page.tsx", "src/app/m/[username]/music/page.tsx", "src/app/m/[username]/merch/page.tsx", "src/app/m/[username]/tickets/page.tsx", "src/app/[username]/shop/page.tsx", "src/app/[username]/item/[id]/page.tsx", "src/app/[username]/item/[id]/checkout/page.tsx"]) {
    assert.ok(raw(f).includes('export const dynamic = "force-dynamic";'), `${f}: still rendered live`);
  }
  assert.ok(!/unstable_cache|cache\(/.test(strip(raw("src/lib/publicProfileVisibility.ts")).replace(/React\)\.cache|\(React as any\)\.cache/g, "")), "the suspension / plan read is never kept in a shared cache (only memoised within ONE request)");
});
await test("brand artwork: the platform's own images and icons are cached for a day (with stale-while-revalidate); the service worker, manifests, pages and the private share links keep their behaviour", async () => {
  const cfg = require(path.join(REPO, "next.config.js"));
  const headers = await cfg.headers();
  const cache = headers.filter((h) => h.headers.some((x) => x.key === "Cache-Control" && /max-age=86400/.test(x.value)));
  assert.equal(cache.length, 2);
  const sources = cache.map((h) => h.source).join(" ");
  assert.ok(sources.includes("/brand/:path*") && /logo\\\.png/.test(sources) && /favicon\\\.ico/.test(sources));
  assert.ok(!/pwa-sw|manifest|webmanifest/.test(sources), "the service worker and the manifests are not on the list");
  const share = headers.find((h) => h.source === "/d/:path*");
  assert.ok(share && share.headers.some((x) => x.key === "Cache-Control" && /no-store/.test(x.value)), "the private share links are still never cached");
  assert.equal(typeof cfg.rewrites, "undefined");
  assert.equal(typeof cfg.redirects, "undefined");
});

// =============================================================================== PHASE 6: mobile
await test("mobile first response: the loader every public page streams first uses the 96 px copy of the logo (3 KB) instead of the 320 px original (55 KB); the same logo, never altered", () => {
  const sharpDims = (f) => fs.statSync(path.join(REPO, f)).size;
  assert.ok(sharpDims("public/brand/ringo-symbol-96.png") < 6000 && sharpDims("public/brand/ringo-symbol.png") > 40000);
  assert.ok(raw("src/app/loading.tsx").includes('<Image src="/brand/ringo-symbol-96.png" alt="" width={30} height={30}'));
  const logo = strip(raw("src/components/BrandLogo.tsx"));
  assert.ok(logo.includes('const SYMBOL_SMALL_SRC = "/brand/ringo-symbol-96.png";') && logo.includes("const SYMBOL_SRC = height <= 32 ? SYMBOL_SMALL_SRC : SYMBOL_FULL_SRC;"), "small symbols use the small copy; anything larger keeps the original");
  assert.ok(logo.includes('const LIGHT_SRC = "/brand/ringo-logo-light.png";') && logo.includes('const DARK_SRC = "/brand/ringo-logo-dark.png";'), "the full logos are untouched");
  const a = fs.readFileSync(path.join(REPO, "public/logo.png"));
  const b = fs.readFileSync(path.join(REPO, "public/brand/ringo-symbol.png"));
  assert.ok(a.equals(b), "the original symbol and logo.png are unchanged and still identical");
});

await test("mobile: the connection to the storage host (where every picture comes from) is opened early; the QR code library loads only when 'Show QR code' is used", () => {
  const layout = strip(raw("src/app/layout.tsx"));
  assert.ok(layout.includes('<link rel="preconnect" href={storageOrigin} />') && layout.includes("new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin"), "an anonymous preconnect to the project's own storage origin (no crossorigin: images are anonymous)");
  assert.ok(!/preconnect[^>]*(googleapis|gstatic|facebook|tiktok)/i.test(layout), "no third-party connection is opened");
  const share = strip(raw("src/components/ShareButton.tsx"));
  assert.ok(share.includes('const loadQr = () => import("@/lib/qrCode");') && !/import \{[^}]*\} from "@\/lib\/qrCode"/.test(share), "no static import of the QR library");
  assert.ok(share.includes("loadQr()") && /drawQrCodeWithLogo\(canvas, getUrl\(\), 512\)/.test(share) && /downloadCanvas\(canvas, `\$\{filename\}-qr`, "png"\)/.test(share), "the QR code is drawn and downloaded exactly as before");
});

// =============================================================================== scope
await test("scope: authentication, payments, Fapshi, Stripe, RLS, inventory, orders, payouts, commissions and the 10-second preview are not touched", () => {
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])].filter((f) => !f.startsWith("scripts/tests/_"));
  assert.deepEqual(changed.filter((f) => !PHASE26_FILES.has(f)), [], "only the registered files changed");
  // Files whose NAME looks sensitive but whose change is a read-only performance edit, listed one by one (never by pattern): the public item checkout PAGE's profile read (the checkout flow itself,
  // the payment calls and the order logic are not in it), the shop page, the supabase proposal files and the admin branding save's cache refresh.
  const ALLOWED = new Set([
    "src/app/[username]/item/[id]/checkout/page.tsx",
    "src/app/api/admin/branding/route.ts",
    "supabase/support/2026-12-16_profile_lookup_indexes.verify.sql",
    "supabase/migrations/2026-12-17_profile_avatar_shape.sql",
    "supabase/support/2026-12-17_profile_avatar_shape.rollback.sql",
    "supabase/support/2026-12-17_profile_avatar_shape.verify.sql",
  ]);
  const forbidden = /(^|\/)(middleware|fapshi|stripe|webhook|payout|commission|inventory|checkout|orders?|billing|protection|useTrackPlayback|previewLimit)|\/api\/|^supabase\//i;
  assert.deepEqual(changed.filter((f) => forbidden.test(f) && !ALLOWED.has(f) && !/phase2[0-9]Files|\.test\.mjs$/.test(f)), [], "no sensitive file is among the changed ones");
  for (const f of changed.filter((x) => /\.(tsx?|mjs|sql)$/.test(x) && !x.startsWith("scripts/tests/") && fs.existsSync(path.join(REPO, x)))) {
    assert.ok(!/GH₵|GHS|console\.log\(|debugger/.test(fs.readFileSync(path.join(REPO, f), "utf8")), `debug code or a foreign currency in ${f}`);
  }
});

console.log(`\nperformance: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
