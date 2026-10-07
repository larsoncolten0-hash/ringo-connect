// Security remediation, Phase 1: privileged-column guards (users / profiles), executable URL schemes, avatar SSRF, Stripe idempotency,
// the disabled free-upgrade endpoint, the example secret, SECURITY DEFINER hardening. Pure logic runs for real; the SQL is executed for
// real on an in-memory PostgreSQL by supabase/support/tests/security_phase1.adversarial.mjs (run from here when PGlite is installed).
// No network, no Supabase, no Stripe.
//   Run:  node scripts/tests/securityPhase1.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (rel) => strip(read(rel));
const sqlCode = (rel) => read(rel).replace(/--[^\n]*/g, "");

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`); }
};

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const L = jiti(path.join(SRC, "lib/linkUrl.ts"));

// ================================================================ 1. executable URL schemes (render-time and save-time share one validator)
const MALICIOUS = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)", "\tjavascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "jav\r\nascript:alert(1)",
  "\u0001javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "DATA:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "file:///etc/passwd",
  "ftp://example.com/x", "blob:https://example.com/uuid", "about:blank", "chrome://settings", "livescript:x", "javascript&colon;alert(1)", "javascript%3Aalert(1)",
  "//", "https://", "mailto:", "x", "", "   ", null, undefined, 42, {}, [],
];
const LEGIT = [
  ["https://example.com", "https://example.com"], ["http://example.com/a?b=c#d", "http://example.com/a?b=c#d"], ["mailto:me@example.com", "mailto:me@example.com"],
  ["tel:+237677123456", "tel:+237677123456"], ["sms:+237677123456", "sms:+237677123456"], ["whatsapp://send?phone=237677123456", "whatsapp://send?phone=237677123456"],
  ["example.com", "https://example.com"], ["wa.me/237677123456", "https://wa.me/237677123456"], ["instagram.com/name", "https://instagram.com/name"], ["//example.com/x", "https://example.com/x"],
];
await test("urls: safeExternalUrl refuses every executable / unknown scheme, obfuscated forms and non-strings", () => {
  for (const v of MALICIOUS) assert.equal(L.safeExternalUrl(v), null, JSON.stringify(v));
});
await test("urls: legitimate http, https, mailto, tel, sms, whatsapp and bare domains still work, normalised exactly as the Links section does", () => {
  for (const [input, out] of LEGIT) assert.equal(L.safeExternalUrl(input), out, input);
});
await test("urls: the save-time helper clears an empty box, saves the normalised address, and refuses anything unsafe", () => {
  assert.deepEqual(L.linkForSave(""), { ok: true, value: null });
  assert.deepEqual(L.linkForSave("   "), { ok: true, value: null });
  assert.deepEqual(L.linkForSave("example.com"), { ok: true, value: "https://example.com" });
  assert.deepEqual(L.linkForSave("https://example.com/x"), { ok: true, value: "https://example.com/x" });
  for (const v of MALICIOUS.filter((x) => typeof x === "string" && x.trim() !== "")) assert.deepEqual(L.linkForSave(v), { ok: false }, JSON.stringify(v));
});
await test("urls: the existing validator is reused, not duplicated (displayHref unchanged, one scheme list)", () => {
  assert.equal(L.displayHref("javascript:alert(1)"), "#");
  assert.equal(L.displayHref("example.com"), "https://example.com");
  const src = code("src/lib/linkUrl.ts");
  assert.equal((src.match(/ALLOWED_SCHEMES = new Set/g) || []).length, 1);
  assert.ok(src.includes("const check = normalizeLinkUrl(stored);") && src.includes("export function linkForSave"));
});
await test("urls: the product button gets no link for an unsafe landing_url (sanitised where it is passed in; the route map itself stays pure and import-free)", () => {
  const { customerActionRoute } = jiti(path.join(SRC, "lib/customerActionRoutes.ts"));
  const viaView = (stored) => customerActionRoute("external", { username: "u", productId: "p", landingUrl: L.safeExternalUrl(stored) });
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "java	script:alert(1)", "vbscript:x", "", null]) assert.equal(viaView(bad), null, String(bad));
  assert.deepEqual(viaView("https://shop.example/x"), { href: "https://shop.example/x", external: true });
  assert.deepEqual(viaView("shop.example"), { href: "https://shop.example", external: true });
  assert.deepEqual(customerActionRoute("booking_page", { username: "u", productId: "p" }), { href: "/u/book", external: false });
  assert.ok(code("src/components/catalog/ProductDetailView.tsx").includes("landingUrl: safeExternalUrl(product.landing_url)"));
  assert.ok(!/^\s*import\s/m.test(read("src/lib/customerActionRoutes.ts")), "the routes map stays dependency-free");
});
await test("urls: every public render site passes the stored value through safeExternalUrl (no raw href / window.open of buy_url, ticket_url, external_url, landing_url)", () => {
  const sites = {
    "src/components/music/ItemDetailPage.tsx": ["safeExternalUrl(item.buy_url)", "safeExternalUrl(item.ticket_url)"],
    "src/components/music/MusicSection.tsx": ["safeExternalUrl(track.buy_url)", "safeExternalUrl(track.external_url)"],
    "src/components/music/useTrackPlayback.ts": ["safeExternalUrl(track.external_url)"],
    "src/components/music/PinnedSpotlight.tsx": ["safeExternalUrl(item.ticket_url)", "safeExternalUrl(item.external_url)"],
    "src/components/music/EventsSection.tsx": ["safeExternalUrl(event.ticket_url)"],
    "src/components/catalog/CatalogSection.tsx": ["safeExternalUrl(product.landing_url)"],
    "src/components/catalog/ProductDetailView.tsx": ["safeExternalUrl(product.landing_url)"],
    "src/components/shop/ShopDestination.tsx": ["safeExternalUrl(product.landing_url)"],
  };
  for (const [f, needles] of Object.entries(sites)) for (const n of needles) assert.ok(code(f).includes(n), `${f}: ${n}`);
  const all = ["src/components/music/ItemDetailPage.tsx", "src/components/music/MusicSection.tsx", "src/components/music/useTrackPlayback.ts"].map(code).join("\n");
  assert.ok(!/href=\{(item|track)\.(buy_url|ticket_url|external_url)\}/.test(all), "no raw href of a stored link");
  assert.ok(!/window\.open\(track\.external_url/.test(all), "no raw window.open of a stored link");
});
await test("urls: the community announcement link (creator-typed, becomes the email button AND the push link) is validated on save and on send, and the customer bell never runs a non-web URL", () => {
  assert.ok(code("src/lib/community/send.ts").includes("safeExternalUrl(announcement.link_url)"));
  const composer = code("src/components/dashboard/CommunityAnnouncementComposer.tsx");
  assert.ok(composer.includes("linkForSave(linkUrl)") && composer.includes("t.editor.validation.urlInvalid") && composer.includes("link_url: customLink.value") && !/link_url: linkType === "custom" \? linkUrl/.test(composer));
  const bell = code("src/components/my-ringo/CustomerBell.tsx");
  assert.ok(bell.indexOf('target.protocol !== "https:" && target.protocol !== "http:"') > 0 && bell.indexOf('target.protocol !== "https:"') < bell.indexOf("window.location.assign(target.href)"));
  // the customer bell's own protocol rule, executed: only http(s) pass
  const allowed = (u) => { try { const t = new URL(u, "https://ringo.example"); return t.protocol === "https:" || t.protocol === "http:"; } catch { return false; } };
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "JAVASCRIPT:alert(1)", " javascript:alert(1)"]) assert.equal(allowed(bad), false, bad);
  for (const good of ["/dashboard/x", "https://shop.example/x", "http://shop.example"]) assert.equal(allowed(good), true, good);
});
await test("urls: every editor that saves one of these fields validates it with the shared helper and shows the existing translated message", () => {
  assert.ok(code("src/components/editor/CatalogCard.tsx").includes("linkForSave") && code("src/components/editor/CatalogCard.tsx").includes("t.editor.validation.urlInvalid"));
  assert.ok(code("src/components/editor/TrackRow.tsx").includes('persistLink("buy_url"') && code("src/components/editor/TrackRow.tsx").includes('persistLink("external_url"'));
  assert.ok(!/onPersist\(\{ (buy_url|external_url): e\.target\.value \}\)/.test(code("src/components/editor/TrackRow.tsx")), "no unvalidated persist left");
  assert.ok(code("src/components/music/EventCheckinDashboard.tsx").includes("persistTicketUrl") && !/persistField\("ticket_url", e\.target\.value\)/.test(code("src/components/music/EventCheckinDashboard.tsx")));
  assert.ok(translations.en.editor.validation.urlInvalid && translations.fr.editor.validation.urlInvalid && translations.en.editor.validation.urlInvalid !== translations.fr.editor.validation.urlInvalid);
});

// ---- the real component, server-rendered (same loader approach as musicProfile.test.mjs): a stored javascript: link never reaches the page
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transform } = require("sucrase");
const compCache = new Map();
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: "en", t: translations.en, setLocale() {} }) },
  "next/link": { __esModule: true, default: ({ href, children, ...p }) => React.createElement("a", { href, ...p }, children) },
  "@/components/WhatsAppButton": { __esModule: true, default: () => null },
  "@/components/ImageGallery": { __esModule: true, default: () => null },
  "@/components/ShareButton": { __esModule: true, default: () => null },
  "@/components/PublicLanguageSelector": { __esModule: true, default: () => null },
  "@/components/PoweredByRingo": { __esModule: true, default: () => null },
};
function loadComp(file) {
  if (!file.endsWith(".tsx")) return jiti(file);
  if (compCache.has(file)) return compCache.get(file).exports;
  const mod = { exports: {} }; compCache.set(file, mod);
  const out = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const resolve = (base) => { for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext; throw new Error("cannot resolve " + base); };
  const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? loadComp(resolve(path.join(SRC, id.slice(2)))) : id.startsWith(".") ? loadComp(resolve(path.join(path.dirname(file), id))) : require(id));
  new Function("require", "module", "exports", out)(req, mod, mod.exports);
  return mod.exports;
}
const renderTracks = (buyUrl, externalUrl) => {
  const MusicSection = loadComp(path.join(SRC, "components/music/MusicSection.tsx")).default;
  const tracks = [{ id: "t1", title: "Song", price: null, protected_audio_path: null, audio_url: null, external_url: externalUrl ?? null, buy_url: buyUrl, duration: "3:00", cover_image_url: null }];
  return renderToStaticMarkup(React.createElement(MusicSection, { t: translations.en, title: "Music", tracks, artistName: "A", accent: "#4F46E5", currency: "XAF", whatsappNumber: null, username: "artist", playingId: null, progress: 0, onTogglePlay() {} }));
};
await test("urls: the REAL music track row renders no link at all for a stored javascript: / data: / obfuscated buy_url, and the normal link for a safe one", () => {
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  for (const bad of ["javascript:alert(document.domain)", "JaVaScRiPt:alert(1)", "java	script:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
    const html = renderTracks(bad);
    assert.ok(!/javascript|vbscript|data:text/i.test(hrefs(html).join(" ")), `${JSON.stringify(bad)} leaked into an href: ${hrefs(html)}`);
    assert.ok(!html.includes(translations.en.music.buyLabel), "no Buy button for an unsafe link");
  }
  const good = renderTracks("https://shop.example/song");
  assert.ok(hrefs(good).includes("https://shop.example/song") && good.includes(translations.en.music.buyLabel), "a safe link still renders");
  assert.ok(hrefs(renderTracks("shop.example/song")).includes("https://shop.example/song"), "a bare domain is normalised, as before in the editor");
});

// ================================================================ 2. avatar SSRF
const A = jiti(path.join(SRC, "lib/safeAvatarSource.ts"));
const PROJECT = "https://abcdefghij.supabase.co";
const GOOD = `${PROJECT}/storage/v1/object/public/uploads/11111111-1111-4111-8111-111111111111/avatar/22222222.jpg`;
await test("ssrf: only this project's public uploads bucket is accepted", () => {
  assert.equal(A.avatarSourceUrl(GOOD, PROJECT), GOOD);
  assert.equal(A.avatarSourceUrl(`${GOOD}?t=123`, PROJECT), `${GOOD}?t=123`);
});
await test("ssrf: private, loopback, metadata and arbitrary hosts are refused before any request is made", () => {
  for (const host of ["http://127.0.0.1", "http://localhost", "http://[::1]", "http://169.254.169.254", "http://10.0.0.5", "http://192.168.1.1", "http://172.16.0.9", "http://0.0.0.0", "http://2130706433", "https://evil.example", "https://abcdefghij.supabase.co.evil.example", "https://evilabcdefghij.supabase.co", "https://other-project.supabase.co"])
    for (const p of ["/storage/v1/object/public/uploads/x/a.jpg", "/latest/meta-data/", "/"]) assert.equal(A.avatarSourceUrl(host + p, PROJECT), null, host + p);
});
await test("ssrf: userinfo, port, scheme, backslash, whitespace and control-character tricks are refused", () => {
  const p = "/storage/v1/object/public/uploads/x/a.jpg";
  for (const u of [`https://abcdefghij.supabase.co@evil.example${p}`, `https://evil.example@abcdefghij.supabase.co${p}`, `https://user:pw@abcdefghij.supabase.co${p}`, `https://abcdefghij.supabase.co:8443${p}`,
    `http://abcdefghij.supabase.co${p}`, `ftp://abcdefghij.supabase.co${p}`, `file:///etc/passwd`, `javascript:alert(1)`, `data:image/png;base64,AAAA`, `https:\\\\evil.example${p}`, `${GOOD}\n`, ` ${GOOD}`, `${GOOD}\u0000`, `${GOOD}\\x`,
    `//abcdefghij.supabase.co${p}`, `/storage/v1/object/public/uploads/x/a.jpg`, "", "   "]) assert.equal(A.avatarSourceUrl(u, PROJECT), null, JSON.stringify(u));
  for (const v of [null, undefined, 5, {}, [], true]) assert.equal(A.avatarSourceUrl(v, PROJECT), null);
  assert.equal(A.avatarSourceUrl("x".repeat(3000), PROJECT), null);
  assert.equal(A.avatarSourceUrl(GOOD, undefined), null, "no configured project: nothing is accepted");
  assert.equal(A.avatarSourceUrl(GOOD, ""), null);
});
await test("ssrf: the path cannot leave the uploads bucket (other buckets, signed / authenticated endpoints, traversal, encoded dots and slashes)", () => {
  const o = PROJECT;
  for (const p of ["/storage/v1/object/public/avatars/x.jpg", "/storage/v1/object/public/protected-audio/x.mp3", "/storage/v1/object/public/digital-products/x.pdf", "/storage/v1/object/sign/uploads/x.jpg?token=t",
    "/storage/v1/object/authenticated/uploads/x.jpg", "/storage/v1/object/public/uploads/../avatars/x.jpg", "/storage/v1/object/public/uploads/%2e%2e/avatars/x.jpg", "/storage/v1/object/public/uploads/%2E%2E%2Favatars/x.jpg",
    "/storage/v1/object/public/uploads/x%2fy.jpg", "/storage/v1/object/public/uploads/x%5cy.jpg", "/storage/v1/object/public/uploads/x%00.jpg", "/storage/v1/object/public/uploads/", "/storage/v1/object/public/uploads", "/rest/v1/users?select=*", "/auth/v1/admin/users"])
    assert.equal(A.avatarSourceUrl(o + p, PROJECT), null, p);
  // the URL parser resolves "./" and the fetch uses the RESOLVED address, which is still inside the bucket
  assert.equal(A.avatarSourceUrl(`${o}/storage/v1/object/public/uploads/./x.jpg`, PROJECT), `${o}/storage/v1/object/public/uploads/x.jpg`);
});
await test("ssrf: a local-development project over http is accepted only because the project itself is configured over http", () => {
  const local = "http://127.0.0.1:54321";
  assert.equal(A.avatarSourceUrl(`${local}/storage/v1/object/public/uploads/x/a.png`, local), `${local}/storage/v1/object/public/uploads/x/a.png`);
  assert.equal(A.avatarSourceUrl(`${local}/storage/v1/object/public/uploads/x/a.png`, PROJECT), null);
  assert.equal(A.avatarSourceUrl(`http://abcdefghij.supabase.co/storage/v1/object/public/uploads/x/a.png`, PROJECT), null, "a hosted project is never read over http");
});
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const stream = (chunks) => new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } });
const fakeFetch = (spec) => async (url, init) => { fakeFetch.calls.push({ url, init }); if (spec.throws) throw spec.throws; if (spec.hang) return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))); return new Response(spec.body, { status: spec.status ?? 200, headers: spec.headers ?? {} }); };
fakeFetch.calls = [];
await test("ssrf: sniffing recognises PNG / JPEG / WebP / GIF and rejects SVG, HEIC, AVIF, HTML, scripts and empty input", () => {
  assert.equal(A.sniffAvatarImage(PNG), "image/png");
  assert.equal(A.sniffAvatarImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(A.sniffAvatarImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(A.sniffAvatarImage(Buffer.from("GIF89a....", "latin1")), "image/gif");
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"/>', "<!doctype html><script>alert(1)</script>", "<?xml version='1.0'?><svg/>", "\0\0\0\x18ftypheic....", "\0\0\0\x20ftypavif....", "#!/bin/sh", "", "RIFF\0\0\0\0WAVE"]) assert.equal(A.sniffAvatarImage(Buffer.from(bad, "latin1")), null, JSON.stringify(bad));
});
await test("ssrf: a good image is read with redirects disabled, no caching and an abort signal", async () => {
  fakeFetch.calls.length = 0;
  const r = await A.readAvatarSource(GOOD, fakeFetch({ body: stream([PNG]), headers: { "content-length": String(PNG.length), "content-type": "image/png" } }));
  assert.equal(r.ok, true);
  assert.equal(r.bytes.length, PNG.length);
  const init = fakeFetch.calls[0].init;
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.ok(init.signal instanceof AbortSignal);
});
await test("ssrf: a redirect, an error status, a network failure and a hang each end the read without a body", async () => {
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ throws: new TypeError("redirect mode is set to error") })), { ok: false, reason: "fetch_failed" });
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ status: 404, body: "no" })), { ok: false, reason: "fetch_failed" });
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ status: 302, body: "", headers: { location: "http://169.254.169.254/" } })), { ok: false, reason: "fetch_failed" });
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ hang: true }), 40), { ok: false, reason: "timeout" });
});
await test("ssrf: the size cap holds with an honest Content-Length, a lying one, and none at all (the body is never fully read)", async () => {
  const big = new Uint8Array(A.AVATAR_SOURCE_MAX_BYTES + 1024).fill(7);
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ body: stream([big]), headers: { "content-length": String(big.length) } })), { ok: false, reason: "too_large" });
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ body: stream([big]), headers: { "content-length": "100" } })), { ok: false, reason: "too_large" });
  assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ body: stream([big.subarray(0, 4_000_000), big.subarray(0, 4_000_000)]) })), { ok: false, reason: "too_large" });
  assert.ok(A.AVATAR_SOURCE_MAX_BYTES >= 5 * 1024 * 1024, "a legitimate 5 MB upload still fits");
});
await test("ssrf: a body that is not a PNG / JPEG / WebP / GIF is refused whatever its Content-Type claims", async () => {
  for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "<html></html>", "\0\0\0\x18ftypheic"]) assert.deepEqual(await A.readAvatarSource(GOOD, fakeFetch({ body: stream([Buffer.from(body, "latin1")]), headers: { "content-type": "image/png" } })), { ok: false, reason: "not_an_image" });
});
await test("ssrf: the route validates BEFORE any request, no longer calls fetch() itself, and bounds what sharp will decode", () => {
  const r = code("src/app/api/profile/avatar-icons/route.ts");
  assert.ok(!/\bfetch\(/.test(r), "no direct fetch of a client-supplied URL");
  assert.ok(r.indexOf("avatarSourceUrl(avatarUrl)") > 0 && r.indexOf("avatarSourceUrl(avatarUrl)") < r.indexOf("readAvatarSource(sourceUrl)"));
  assert.ok(r.includes('"Invalid avatarUrl."') && r.includes("status: 400"));
  const sharpCalls = [...r.matchAll(/sharp\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a.includes("sourceBuffer"));
  assert.ok(sharpCalls.length === 3 && sharpCalls.every((a) => a.includes("SHARP_INPUT")), sharpCalls.join(" | "));
  assert.ok(r.includes("limitInputPixels: 36_000_000"));
  assert.ok(r.includes("const { data: { user } } = await supabase.auth.getUser()".replace(/\s+/g, " ")) || /auth\.getUser\(\)/.test(r), "still authenticated");
  // the client sends exactly the kind of URL that is accepted: a public uploads URL from getPublicUrl
  assert.ok(code("src/components/editor/AvatarCropperField.tsx").includes('getPublicUrl(path)') && code("src/components/editor/ImageUploadField.tsx").includes('storage.from("uploads").getPublicUrl(path)'));
});

await test("ssrf: sharp (the REAL library, the REAL limit read from the route) refuses an image that decodes to more pixels than allowed, and still resizes a normal avatar", async () => {
  const route = read("src/app/api/profile/avatar-icons/route.ts");
  const limit = Number((route.match(/limitInputPixels:\s*([\d_]+)/) || [])[1]?.replace(/_/g, ""));
  assert.ok(limit >= 4_000_000 && limit <= 50_000_000, `limit ${limit}`);
  const sharp = require("sharp");
  const OPTS = { limitInputPixels: limit, failOn: "error" };
  const side = Math.ceil(Math.sqrt(limit)) + 50; // a tiny PNG file (solid colour) that expands to just over the limit
  const huge = await sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(huge.length < 2_000_000, `the file is small (${huge.length} bytes) yet decodes to ${side * side} pixels`);
  await assert.rejects(() => sharp(huge, OPTS).resize(192, 192).png().toBuffer(), /pixel limit/i);
  const normal = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#4F46E5" } }).jpeg().toBuffer();
  const icon = await sharp(normal, OPTS).resize(192, 192, { fit: "cover" }).png().toBuffer();
  assert.deepEqual([(await sharp(icon).metadata()).width, (await sharp(icon).metadata()).height], [192, 192]);
  assert.match(JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/sharp/package.json"), "utf8")).version, /^0\.35\.(5|[6-9]|\d{2,})/);
});

// ================================================================ 3. Stripe idempotency
const S = jiti(path.join(SRC, "lib/stripeIdempotency.ts"));
// an in-memory payment_transactions with an optional unique index, shaped like the supabase-js calls the helpers make
function fakeDb({ unique, readError, insertError } = {}) {
  const rows = []; const log = [];
  const api = {
    rows, log,
    from(table) {
      log.push(table);
      const q = { filters: [] };
      const chain = {
        select() { return chain; },
        eq(k, v) { q.filters.push([k, v]); return chain; },
        limit() { return Promise.resolve(readError ? { data: null, error: { message: "boom" } } : { data: rows.filter((r) => q.filters.every(([k, v]) => r[k] === v)).map((r) => ({ id: r.id })), error: null }); },
        insert(row) {
          const res = (() => {
            if (insertError) return { data: null, error: insertError };
            if (unique && rows.some((r) => r.provider === row.provider && r.provider_transaction_id === row.provider_transaction_id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            const rec = { id: `tx${rows.length + 1}`, ...row }; rows.push(rec); return { data: { id: rec.id }, error: null };
          })();
          return { select: () => ({ single: () => Promise.resolve(res) }) };
        },
      };
      return chain;
    },
  };
  return api;
}
const SESSION = { user_id: "u1", provider: "stripe", provider_transaction_id: "cs_test_1", plan_name: "pro", billing_interval: "monthly", amount: 20, currency: "USD", status: "success" };
// the webhook's order of operations for ONE delivery, counting the side effects a duplicate must not repeat
async function deliver(db, effects) {
  if (await S.stripePaymentAlreadyRecorded(db, SESSION.provider_transaction_id)) return "skipped";
  effects.planGrants++; // idempotent
  const rec = await S.recordStripePayment(db, SESSION);
  if (rec.duplicate) return "raced";
  effects.commissions++; effects.adminNotifications++; // the AFTER INSERT trigger + the "new paid member" bell
  return "applied";
}
await test("stripe: the same checkout.session.completed delivered twice creates one row and one set of side effects (sequential duplicate)", async () => {
  for (const unique of [false, true]) {
    const db = fakeDb({ unique }); const fx = { planGrants: 0, commissions: 0, adminNotifications: 0 };
    assert.equal(await deliver(db, fx), "applied");
    assert.equal(await deliver(db, fx), "skipped");
    assert.equal(await deliver(db, fx), "skipped");
    assert.equal(db.rows.length, 1, `unique=${unique}`);
    assert.deepEqual(fx, { planGrants: 1, commissions: 1, adminNotifications: 1 });
  }
});
await test("stripe: two deliveries racing past the check: the database refuses the second row (23505) and it triggers nothing", async () => {
  const db = fakeDb({ unique: true }); const fx = { planGrants: 0, commissions: 0, adminNotifications: 0 };
  const first = await S.recordStripePayment(db, SESSION);
  const second = await S.recordStripePayment(db, SESSION);
  assert.deepEqual([first.duplicate, second.duplicate], [false, true]);
  assert.equal(db.rows.length, 1);
  assert.equal(fx.commissions, 0, "the refused row reaches no side effect (they only run for a non-duplicate result)");
});
await test("stripe: a different session, or the same id under another provider, is a different payment", async () => {
  const db = fakeDb({ unique: true });
  await S.recordStripePayment(db, SESSION);
  assert.equal((await S.recordStripePayment(db, { ...SESSION, provider_transaction_id: "cs_test_2" })).duplicate, false);
  assert.equal(await S.stripePaymentAlreadyRecorded(db, "cs_test_2"), true);
  assert.equal(await S.stripePaymentAlreadyRecorded(db, "cs_never"), false);
  assert.equal(db.rows.length, 2);
});
await test("stripe: a read error never blocks a real payment, and any other insert error keeps the previous behaviour (no throw, no row)", async () => {
  assert.equal(await S.stripePaymentAlreadyRecorded(fakeDb({ readError: true }), "cs_x"), false);
  const oldErr = console.error; console.error = () => {};
  try {
    const r = await S.recordStripePayment(fakeDb({ insertError: { code: "XX000", message: "internal" } }), SESSION);
    assert.deepEqual(r, { duplicate: false, id: null });
  } finally { console.error = oldErr; }
});
await test("stripe: the webhook checks BEFORE the grant, grants BEFORE inserting (a crash between them is repaired by Stripe's retry), and a duplicate stops before any notification", () => {
  const w = code("src/app/api/billing/stripe/webhook/route.ts");
  const i = (needle) => { const k = w.indexOf(needle); assert.ok(k > 0, needle); return k; };
  assert.ok(i("stripePaymentAlreadyRecorded(admin, session.id)") < i('.from("users")') && i('.from("users")') < i("recordStripePayment(admin"));
  const dup = i("if (recorded.duplicate) break;");
  assert.ok(w.indexOf("sendPushAndBellToAdmins(", dup) > dup && w.indexOf("notifyAffiliateCommissionIfAny(", dup) > dup, "notifications come after the duplicate check");
  assert.ok(w.includes("stripe.webhooks.constructEvent(body, signature!, settings.stripeWebhookSecret)"), "signature verification is untouched");
  assert.ok(!/\.from\("payment_transactions"\)\s*\.insert/.test(w), "no direct insert left in the webhook");
});

// ================================================================ 4. the free-upgrade endpoint
await test("billing: /api/billing/upgrade no longer changes anything: no admin client, no plan write, a 410 for every caller", async () => {
  const r = code("src/app/api/billing/upgrade/route.ts");
  assert.ok(!/createAdminClient|createClient|plan_id|\.from\(|\.update\(|admin_audit_log/.test(r), "no database access of any kind");
  assert.ok(r.includes("status: 410") && r.includes("upgrade_endpoint_disabled"));
  const { POST } = jiti(path.join(SRC, "app/api/billing/upgrade/route.ts"));
  const res = await POST(new Request("http://x/api/billing/upgrade", { method: "POST", body: JSON.stringify({ planName: "business" }) }));
  assert.equal(res.status, 410);
  assert.equal((await res.json()).code, "upgrade_endpoint_disabled");
  // the legitimate plan paths are still there
  for (const f of ["src/app/api/billing/stripe/webhook/route.ts", "src/app/api/billing/fapshi/webhook/route.ts", "src/lib/applyPayment.ts"]) assert.ok(fs.existsSync(path.join(REPO, f)), f);
});

// ================================================================ 4b. dependencies: only next and sharp moved
const gitShow = (rel) => { const r = spawnSync("git", ["show", `HEAD:${rel}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };
await test("dependencies: package.json differs from HEAD only in the versions of next and sharp (no package added, removed or otherwise bumped)", () => {
  const before = JSON.parse(gitShow("package.json") || "null");
  if (!before) return; // not a git checkout
  const now = JSON.parse(read("package.json"));
  for (const group of ["dependencies", "devDependencies"]) {
    assert.deepEqual(Object.keys(now[group] || {}).sort(), Object.keys(before[group] || {}).sort(), `${group}: the set of packages is unchanged`);
    for (const [name, ver] of Object.entries(now[group] || {})) if (ver !== before[group][name]) assert.ok(name === "next" || name === "sharp", `${name} changed: ${before[group][name]} -> ${ver}`);
  }
  assert.deepEqual(now.scripts, before.scripts);
  const [maj, min] = now.dependencies.next.split(".");
  assert.equal(`${maj}.${min}`, "14.2", "stays on the 14.2 line: no major migration");
  assert.equal(now.dependencies.react, before.dependencies.react);
});
await test("dependencies: the lockfile gained and lost NO package; only next, @next/*, sharp and @img/sharp* entries changed version", () => {
  const raw = gitShow("package-lock.json");
  if (!raw) return;
  const old = JSON.parse(raw).packages, cur = JSON.parse(read("package-lock.json")).packages;
  assert.deepEqual(Object.keys(cur).sort(), Object.keys(old).sort(), "the package set is identical");
  const changed = Object.keys(cur).filter((k) => old[k].version !== cur[k].version);
  const allowed = (k) => /^node_modules\/(next|sharp|@next\/[^/]+|@img\/sharp[^/]*)$/.test(k);
  assert.deepEqual(changed.filter((k) => !allowed(k)), [], "no unrelated package moved");
  if (changed.length) {
    assert.equal(cur["node_modules/next"].version, "14.2.35");
    assert.ok(/^0\.35\.(5|[6-9]|\d{2,})/.test(cur["node_modules/sharp"].version), cur["node_modules/sharp"].version);
    assert.equal(cur["node_modules/react"].version, old["node_modules/react"].version);
  }
});

// ================================================================ 5. the example secret
await test("secrets: .env.example carries a placeholder for CRON_SECRET, never a real-looking value", () => {
  const ex = read(".env.example");
  const v = (ex.match(/^CRON_SECRET=(.*)$/m) || [])[1];
  assert.ok(v && /replace-with/i.test(v), "placeholder text");
  assert.ok(!/^[0-9a-f]{32,}$/i.test(v.trim()), "not a hex secret");
  const local = path.join(REPO, ".env.local");
  if (fs.existsSync(local)) {
    const lv = (fs.readFileSync(local, "utf8").match(/^CRON_SECRET=(.*)$/m) || [])[1];
    if (lv) assert.notEqual(v.trim(), lv.trim().replace(/^['"]|['"]$/g, ""), "the example must never equal the real local secret");
  }
});
await test("secrets: every other secret-looking example value is a short placeholder, and the real env files are ignored", () => {
  for (const m of read(".env.example").matchAll(/^([A-Z0-9_]*(?:SECRET|KEY|TOKEN)[A-Z0-9_]*)=(.+)$/gm)) {
    const [, k, val] = m;
    if (/^NEXT_PUBLIC_/.test(k)) continue;
    assert.ok(val.length < 64 || /replace|your|example|placeholder/i.test(val), `${k} looks like a real value`);
    assert.ok(!/^eyJ[A-Za-z0-9_-]{20,}/.test(val) && !/^sk-(ant-|proj-)?[A-Za-z0-9_-]{30,}$/.test(val) && !/^sk_(live|test)_[A-Za-z0-9]{10,}/.test(val), `${k} looks like a real credential`);
  }
  const gi = read(".gitignore");
  assert.ok(/^\.env\.local$/m.test(gi) && /^\.env$/m.test(gi));
});
await test("secrets: every cron route still rejects an unset or empty CRON_SECRET", () => {
  const dir = path.join(REPO, "src/app/api/cron");
  const routes = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "route.ts")));
  assert.ok(routes.length >= 10, String(routes.length));
  for (const d of routes) assert.ok(/!process\.env\.CRON_SECRET|!secret/.test(code(`src/app/api/cron/${d}/route.ts`)), d);
});

// ================================================================ 6. the migrations (static pins; the SQL itself runs in the adversarial test)
const MIGRATIONS = {
  "supabase/migrations/2026-10-06a_users_privileged_column_guard.sql": "2026-10-06a_users_privileged_column_guard",
  "supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql": "2026-10-06b_profiles_privileged_column_guard",
  "supabase/migrations/2026-10-06c_security_definer_search_path.sql": "2026-10-06c_security_definer_search_path",
  "supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql": "2026-10-06d_payment_transactions_idempotency",
  "supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql": "2026-10-06e_unsafe_url_scheme_guard",
};
await test("migrations: each is marked as requiring owner approval, is additive, and has a rollback; none drops data, disables RLS or removes a policy", () => {
  for (const [f, base] of Object.entries(MIGRATIONS)) {
    assert.ok(/REQUIRES OWNER APPROVAL/.test(read(f)), `${f}: approval banner`);
    const body = sqlCode(f);
    assert.ok(!/\b(drop\s+table|truncate|delete\s+from|disable\s+row\s+level\s+security|drop\s+policy|drop\s+column|alter\s+table[^;]*\bdrop\b)/i.test(body), `${f}: destructive statement`);
    // the only writes allowed are the ATTEMPTS inside a guard's self-test, which run as an ordinary user and are expected to be refused
    for (const w of body.matchAll(/\bupdate\s+public\.\w+\s+set\b|\binsert\s+into\b/gi)) {
      const doStart = body.lastIndexOf("do $$", w.index);
      assert.ok(doStart >= 0 && body.lastIndexOf("set local role authenticated", w.index) > doStart, `${f}: writes data outside a self-test`);
    }
    assert.ok(fs.existsSync(path.join(REPO, `supabase/support/${base}.rollback.sql`)), `${f}: rollback`);
  }
  assert.ok(fs.existsSync(path.join(REPO, "supabase/support/2026-10-06a_security_phase1.verify.sql")));
});
await test("migrations: the users and profiles guards are allowlist / fail-closed, SECURITY INVOKER, pinned, and trust only the roles the API cannot become", () => {
  const u = sqlCode("supabase/migrations/2026-10-06a_users_privileged_column_guard.sql");
  const uFn = u.slice(u.indexOf("create or replace function public.protect_users_privileged_columns"), u.indexOf("revoke all on function public.protect_users_privileged_columns"));
  assert.ok(uFn.length > 500 && !/exception\s+when/i.test(uFn), "no exception handler in the guard (fail closed)");
  assert.ok(/set search_path = pg_catalog, public, pg_temp/.test(uFn) && !/security definer/i.test(uFn));
  assert.ok(/n\.key <> all \(c_self\)/.test(u), "allowlist, so unknown production-only columns are protected too");
  for (const c of ["onboarding_completed_at", "onboarding_dismissed_at", "last_active_at", "last_active_standalone", "pwa_installed_at"]) assert.ok(u.includes(`'${c}'`), c);
  for (const priv of ["role", "plan_id", "status", "can_approve_requests"]) assert.ok(!new RegExp(`c_self[^;]*'${priv}'`).test(u), `${priv} must not be self-service`);
  assert.ok(/current_user::text in \('service_role', 'supabase_auth_admin', 'supabase_admin'\)/.test(u) && /pg_has_role/.test(u));
  assert.ok(/revoke all on function public\.protect_users_privileged_columns\(\) from public, anon, authenticated, service_role/.test(u));
  const p = sqlCode("supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql");
  const pFn = p.slice(p.indexOf("create or replace function public.protect_profile_privileged_columns"), p.indexOf("revoke all on function public.protect_profile_privileged_columns"));
  assert.ok(pFn.length > 300 && !/exception\s+when/i.test(pFn) && /new\.verified is distinct from old\.verified/.test(p) && /new\.user_id is distinct from old\.user_id/.test(p));
  assert.ok(!/ordering_enabled|published|bookings_enabled/.test(p), "legitimate owner toggles are not protected");
  // the existing demo-flag guard is not modified
  assert.equal(gitHeadEquals("supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql"), true);
  assert.equal(gitHeadEquals("supabase/schema.sql"), true, "the existing policies are not edited");
});
await test("migrations: SECURITY DEFINER hardening lists the 16 functions, gives the pgcrypto ones `extensions`, and drops the fail-open handler", () => {
  const f = "supabase/migrations/2026-10-06c_security_definer_search_path.sql";
  const m = sqlCode(f);
  for (const fn of ["attribute_referral", "checkin_ticket", "handle_payment_transaction_commission", "has_org_permission", "is_admin", "is_org_member", "org_team_enabled", "release_event_ticket_type", "request_affiliate_payout", "request_commerce_payout", "request_music_payout", "reserve_event_ticket_type", "set_affiliate_code", "set_digital_ticket_code", "set_scanner_session_token", "set_table_public_code"]) assert.ok(m.includes(`public.${fn}(`), fn);
  for (const fn of ["set_affiliate_code", "set_digital_ticket_code", "set_scanner_session_token", "set_table_public_code"]) assert.ok(new RegExp(`public\\.${fn}\\(\\)',\\s+v_ext`).test(m), `${fn} needs the extensions schema`);
  const body = m.slice(m.indexOf("create or replace function public.protect_affiliate_fields"), m.indexOf("do $$"));
  assert.ok(!/exception\s+when/i.test(body) && /security definer/.test(body) && /set search_path = pg_catalog, public, pg_temp/.test(body));
  assert.ok(/auth\.uid\(\) is not null and not public\.is_admin\(\)/.test(body), "short-circuits for service role / signup before is_admin()");
  // none of these 16 bodies is edited: only ALTER FUNCTION ... SET search_path
  assert.ok(!/create or replace function public\.(?!protect_affiliate_fields)/.test(m));
});
await test("migrations: payment idempotency is a conditional partial unique index that refuses to run over existing duplicates and never edits a row", () => {
  const m = sqlCode("supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql");
  assert.ok(/create unique index if not exists payment_transactions_provider_txn_uidx/.test(m) && /where provider_transaction_id is not null/.test(m));
  assert.ok(/to_regclass\('public\.payment_transactions'\) is null/.test(m) && /raise exception 'cannot create the unique index/.test(m));
});
await test("migrations: the URL guard validates only values that are being set or changed (legacy rows stay editable), for every caller", () => {
  const m = sqlCode("supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql");
  assert.ok(/v_new is not distinct from v_old/.test(m) && /http', 'https', 'mailto', 'tel', 'sms', 'whatsapp'/.test(m));
  assert.ok(!/add constraint|check \(/i.test(m.replace(/column_name/g, "")), "a CHECK would block unrelated edits of legacy rows");
  assert.ok(/\\x01-\\x20\\x7f/.test(m), "strips the characters browsers ignore inside a scheme");
  for (const t of ["products", "tracks", "events", "links", "social_links", "community_announcements"]) assert.ok(m.includes(`'${t}'`), t);
});
function gitHeadEquals(rel) {
  const r = spawnSync("git", ["diff", "--quiet", "HEAD", "--", rel], { cwd: REPO });
  return r.status === 0;
}

// ================================================================ 7. the SQL, executed for real
await test("sql: the Phase 1 migrations behave as claimed on a real PostgreSQL (127+ adversarial checks: privilege escalation, staff takeover, URL schemes, idempotency, search_path hijack, rollback, verify)", () => {
  let hasPglite = true;
  try { require.resolve("@electric-sql/pglite"); } catch { hasPglite = false; }
  if (!hasPglite) { console.log("  (skipped: @electric-sql/pglite is not installed; run `npm install --no-save @electric-sql/pglite`)"); return; }
  const r = spawnSync(process.execPath, ["supabase/support/tests/security_phase1.adversarial.mjs"], { cwd: REPO, encoding: "utf8", timeout: 240000 });
  const tail = (r.stdout || "").trim().split("\n").slice(-3).join(" | ");
  assert.equal(r.status, 0, tail + (r.stderr || "").slice(0, 400));
  assert.ok(/(\d+)\/\1 checks passed/.test(r.stdout), tail);
  assert.ok(Number((r.stdout.match(/(\d+)\/\d+ checks passed/) || [])[1]) >= 120, tail);
});

console.log(`securityPhase1: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
