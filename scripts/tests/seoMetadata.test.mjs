// Phase 4A/4D: search and social metadata of the public profile and its item / booking / receipt pages.
// No network, no database: the Supabase clients are fakes. Pure helpers (lib/seo.ts) are called directly;
// the route files, which import React components, are checked on their source with comments stripped.
//   Run:  node scripts/tests/seoMetadata.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(REPO, "src", p));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (p) => strip(fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n"));

process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com/";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";

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

const seo = load("lib/seo.ts");
const serverMod = load("lib/supabase/server.ts");
const meta = load("lib/profileMetadata.ts");
const IMG = "https://abcdefgh.supabase.co/storage/v1/object/public/avatars/a.png";
const COVER = "https://abcdefgh.supabase.co/storage/v1/object/public/covers/c.png";
const stub = (profile) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }) }) });
const admin = (status) => ({
  from: (table) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "profiles" ? { user_id: "u1", users: { status } } : { status } }) }) }),
  }),
});
const BASE = { name: "Ada Mbella", username: "ada", avatar_url: IMG, cover_image_url: null, bio: "Photographer and trainer in Douala.", about_position: null, about_company: null, theme_color: "#111111", category: "creative_media", is_demo: false };
async function metaFor(profile, fn = "generateMetadata", status = "active") {
  serverMod.createClient = () => stub(profile);
  serverMod.createAdminClient = () => admin(status);
  return meta[fn]({ params: { username: profile?.username || "x" } }, undefined);
}

// ---------------------------------------------------------------- title, description
await test("title uses the profile's display name, falling back to the username", async () => {
  assert.equal((await metaFor(BASE)).title, "Ada Mbella | Ringo Connect");
  assert.equal((await metaFor({ ...BASE, name: "  " })).title, "ada | Ringo Connect");
  assert.equal((await metaFor({ ...BASE, name: null })).title, "ada | Ringo Connect");
});
await test("description priority 1: a meaningful bio", async () => {
  assert.equal((await metaFor(BASE)).description, "Photographer and trainer in Douala.");
});
await test("description priority 2: the About role / company that the page displays (never contact fields)", async () => {
  const m = await metaFor({ ...BASE, bio: "   ", about_position: "Director", about_company: "Santé Plus", about_email: "secret@x.com", about_phone: "+237600000000", about_location: "Akwa" });
  assert.equal(m.description, "Director — Santé Plus");
  assert.ok(!/secret|237600|Akwa/.test(JSON.stringify(m)));
  assert.equal(seo.realProfileDescription({ bio: "", about_position: "", about_company: "Santé Plus" }), "Santé Plus");
});
await test("description priority 3: a short bilingual Ringo fallback, never an empty or invented description", async () => {
  const m = await metaFor({ ...BASE, bio: null });
  assert.equal(m.description, "Profil Ringo Connect de Ada Mbella · Ada Mbella's Ringo Connect profile.");
  assert.equal(seo.realProfileDescription({ bio: null }), "", "structured data must not get the fallback sentence");
});
await test("a long bio is cut at a word boundary; control and zero-width characters are removed", () => {
  const long = "word ".repeat(100).trim();
  const d = seo.truncateText(long);
  assert.ok(d.length <= 200 && d.endsWith("…") && !d.includes("  "));
  const dirty = `a${String.fromCharCode(0)}b${String.fromCharCode(0x200b)}c${String.fromCharCode(0x2028)}d\n\n e`;
  assert.equal(seo.cleanText(dirty), "a b c d e");
  assert.equal(seo.cleanText(undefined), "");
  assert.equal(seo.cleanText(42), "");
});

// ---------------------------------------------------------------- canonical, Open Graph, Twitter
await test("canonical is the profile's own page: absolute through metadataBase, no query, no trailing slash on the origin", async () => {
  const m = await metaFor(BASE);
  assert.equal(m.alternates.canonical, "/ada");
  assert.equal(String(m.metadataBase), "https://ringoconnectltd.com/");
  assert.equal(new URL(m.alternates.canonical, m.metadataBase).href, "https://ringoconnectltd.com/ada");
  assert.ok(!/[?#]/.test(m.alternates.canonical), "no tracking query / fragment");
  assert.equal(seo.profilePath("a b/c?x=1"), "/a%20b%2Fc%3Fx%3D1", "a hostile username cannot add a path or a query");
});
await test("Open Graph: title, description, url, type, site name, image", async () => {
  const og = (await metaFor(BASE)).openGraph;
  assert.equal(og.title, "Ada Mbella | Ringo Connect");
  assert.equal(og.description, "Photographer and trainer in Douala.");
  assert.equal(og.url, "/ada");
  assert.equal(og.type, "profile");
  assert.equal(og.siteName, "Ringo Connect");
  assert.equal(og.images[0].url, IMG);
});
await test("Twitter: summary card for an avatar, title, description, image", async () => {
  const tw = (await metaFor(BASE)).twitter;
  assert.equal(tw.card, "summary");
  assert.equal(tw.title, "Ada Mbella | Ringo Connect");
  assert.equal(tw.description, "Photographer and trainer in Douala.");
  assert.deepEqual(tw.images, [IMG]);
});
await test("image choice: avatar, else cover (large card), else the Ringo brand image (large card)", async () => {
  const cover = await metaFor({ ...BASE, avatar_url: null, cover_image_url: COVER });
  assert.equal(cover.openGraph.images[0].url, COVER);
  assert.equal(cover.twitter.card, "summary_large_image");
  const none = await metaFor({ ...BASE, avatar_url: null });
  assert.equal(none.openGraph.images[0].url, "/brand/ringo-og.png");
  assert.equal(none.openGraph.images[0].width, 1200);
  assert.equal(none.twitter.card, "summary_large_image");
  assert.equal(new URL(none.openGraph.images[0].url, none.metadataBase).href, "https://ringoconnectltd.com/brand/ringo-og.png", "the fallback becomes absolute through metadataBase");
  assert.ok(fs.existsSync(path.join(REPO, "public/brand/ringo-og.png")));
});

// ---------------------------------------------------------------- image safety
await test("only https images on the existing Supabase image host are advertised", () => {
  assert.equal(seo.safePublicImageUrl(IMG), IMG);
  assert.ok(seo.safePublicImageUrl("https://other-project.supabase.co/x.png"));
  for (const bad of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://abcdefgh.supabase.co/1",
    "http://abcdefgh.supabase.co/a.png",
    "https://evil.example.com/a.png",
    "https://abcdefgh.supabase.co.evil.com/a.png",
    "https://user:pw@abcdefgh.supabase.co/a.png",
    "//abcdefgh.supabase.co/a.png",
    "/relative.png",
    "ftp://abcdefgh.supabase.co/a.png",
    "https://abcdefgh.supabase.co/a b.png",
    "not a url",
    "",
    "   ",
    null,
    undefined,
    42,
    "https://abcdefgh.supabase.co/" + "a".repeat(3000),
  ])
    assert.equal(seo.safePublicImageUrl(bad), null, String(bad).slice(0, 50));
});
await test("an unsafe avatar never reaches Open Graph or Twitter: the Ringo image is used instead", async () => {
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "https://evil.example.com/a.png"]) {
    const m = await metaFor({ ...BASE, avatar_url: bad });
    assert.equal(m.openGraph.images[0].url, "/brand/ringo-og.png");
    assert.ok(!JSON.stringify(m.twitter).includes("evil") && !JSON.stringify(m.openGraph).includes("javascript"));
  }
});

// ---------------------------------------------------------------- gates and existing behaviour
await test("demo profile keeps noindex, nofollow", async () => {
  assert.deepEqual((await metaFor({ ...BASE, is_demo: true })).robots, { index: false, follow: false });
  assert.equal((await metaFor(BASE)).robots, undefined, "a normal profile has no robots restriction");
});
await test("unpublished / missing profile: no metadata at all", async () => {
  serverMod.createClient = () => stub(null);
  serverMod.createAdminClient = () => admin("active");
  assert.deepEqual(await meta.generateMetadata({ params: { username: "nobody" } }, undefined), {});
});
await test("suspended owner: no metadata at all (no title, description, canonical, Open Graph, image)", async () => {
  assert.deepEqual(await metaFor(BASE, "generateMetadata", "suspended"), {});
});
await test("manifest, Apple web app and Apple icon behaviour are unchanged", async () => {
  const m = await metaFor(BASE);
  assert.equal(m.manifest, "/ada/manifest.webmanifest");
  assert.deepEqual(m.appleWebApp, { capable: true, title: "Ada Mbella", statusBarStyle: "default" });
  assert.equal(m.icons.apple, IMG);
  assert.equal((await metaFor({ ...BASE, avatar_url: null })).icons.apple, "/apple-touch-icon.png");
});
await test("Apple icon: a valid allowed avatar is used; any hostile avatar value falls back to the stock icon", async () => {
  assert.equal((await metaFor(BASE)).icons.apple, IMG);
  for (const bad of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://abcdefgh.supabase.co/1",
    "http://abcdefgh.supabase.co/a.png",
    "https://user:pw@abcdefgh.supabase.co/a.png",
    "/relative.png",
    "https://evil.example.com/a.png",
    "https://abcdefgh.supabase.co.evil.com/a.png",
    "not a url",
  ]) {
    const m = await metaFor({ ...BASE, avatar_url: bad });
    assert.equal(m.icons.apple, "/apple-touch-icon.png", bad);
    assert.ok(!JSON.stringify(m.icons).includes("javascript"), bad);
  }
  assert.equal((await metaFor({ ...BASE, is_demo: true, avatar_url: "javascript:alert(1)" }, "generateNoIndexMetadata")).icons.apple, "/apple-touch-icon.png");
});
await test("hostile profile values are only data: no markup is interpreted, nothing throws", async () => {
  const m = await metaFor({ ...BASE, name: "<script>alert(1)</script>", bio: "\"><img src=x onerror=alert(1)>" });
  assert.equal(m.title, "<script>alert(1)</script> | Ringo Connect"); // a plain string; Next.js escapes it in <head>
  assert.equal(typeof m.description, "string");
});

// ---------------------------------------------------------------- receipts and ticket passes
await test("receipts and ticket passes: noindex, nofollow, and no description / canonical / Open Graph / Twitter", async () => {
  const m = await metaFor(BASE, "generateNoIndexMetadata");
  assert.deepEqual(m.robots, { index: false, follow: false });
  for (const k of ["description", "alternates", "openGraph", "twitter"]) assert.equal(m[k], undefined, k);
  assert.equal(m.title, "Ada Mbella | Ringo Connect");
  const suspended = await metaFor(BASE, "generateNoIndexMetadata", "suspended");
  assert.deepEqual(suspended, { robots: { index: false, follow: false } });
});
await test("the receipt and ticket-pass routes use the noindex metadata; access logic untouched", () => {
  for (const f of ["src/app/m/[username]/receipt/[id]/page.tsx", "src/app/m/[username]/ticket-pass/[code]/page.tsx"]) {
    const s = src(f);
    assert.match(s, /export \{ generateNoIndexMetadata as generateMetadata, generateViewport \} from "@\/lib\/profileMetadata"/, f);
  }
  assert.match(src("src/app/m/[username]/receipt/[id]/page.tsx"), /data\.artistUsername !== params\.username\) return notFound\(\)/);
});

// ---------------------------------------------------------------- item pages and booking
await test("withItemSeo: canonical to the item itself, its own title / description / image, Open Graph and Twitter in step", async () => {
  const base = await metaFor(BASE);
  const m = seo.withItemSeo(base, { path: "/ada/item/abc", title: "Studio session — Ada", description: "Two hours.", image: COVER });
  assert.equal(m.alternates.canonical, "/ada/item/abc");
  assert.equal(m.title, "Studio session — Ada");
  assert.equal(m.description, "Two hours.");
  assert.equal(m.openGraph.url, "/ada/item/abc");
  assert.equal(m.openGraph.title, "Studio session — Ada");
  assert.equal(m.openGraph.images[0].url, COVER);
  assert.equal(m.twitter.card, "summary_large_image");
  assert.deepEqual(m.twitter.images, [COVER]);
  assert.equal(m.manifest, base.manifest, "the profile's manifest / icons are kept");
});
await test("withItemSeo: an unsafe or missing item image falls back to the profile's image; no description falls back to the profile's", async () => {
  const base = await metaFor(BASE);
  const m = seo.withItemSeo(base, { path: "/ada/item/abc", title: "X", description: "  ", image: "javascript:alert(1)" });
  assert.equal(m.openGraph.images[0].url, IMG);
  assert.equal(m.description, base.description);
  assert.ok(!JSON.stringify(m).includes("javascript"));
});
await test("booking: a shared service previews as that service but the canonical stays the profile (no ?service)", async () => {
  const base = await metaFor(BASE);
  const m = seo.withTitle(base, "Haircut — Ada");
  assert.equal(m.title, "Haircut — Ada");
  assert.equal(m.openGraph.title, "Haircut — Ada");
  assert.equal(m.twitter.title, "Haircut — Ada");
  assert.equal(m.alternates.canonical, "/ada");
  assert.equal(seo.withTitle(base, "   "), base);
});
await test("item routes advertise nothing for an item their page would 404 (unavailable, draft, unknown, suspended)", () => {
  const product = src("src/app/[username]/item/[id]/page.tsx");
  assert.match(product, /if \(!found\) return \{ robots: NOINDEX \}/);
  assert.match(product, /withItemSeo\(base, \{/);
  assert.match(product, /p\.id === id && p\.available !== false/, "the page's own viewability rule is unchanged");
  const dish = src("src/app/r/[username]/item/[id]/page.tsx");
  assert.match(dish, /if \(!found\?\.item\) return \{ robots: NOINDEX \}/);
  const music = src("src/app/m/[username]/[type]/[id]/page.tsx");
  assert.match(music, /isPublicProfileSuspended\(params\.username\)\) return \{ robots: NOINDEX \}/);
  assert.match(music, /profileHasTicketing\(profile as any\)\) return \{ robots: NOINDEX \}/);
  assert.match(music, /x\.status === "draft"/);
  const book = src("src/app/[username]/book/page.tsx");
  assert.match(book, /return withTitle\(base, title\)/);
});
await test("/r and /m profile pages share the profile metadata, so their canonical is /{username}", async () => {
  for (const f of ["src/app/r/[username]/page.tsx", "src/app/m/[username]/page.tsx", "src/app/[username]/page.tsx"]) {
    assert.match(src(f), /export \{ generateMetadata, generateViewport \} from "@\/lib\/profileMetadata"/, f);
  }
  assert.equal((await metaFor(BASE)).alternates.canonical, "/ada");
});

// ---------------------------------------------------------------- homepage
await test("homepage: metadataBase from the configured site URL, canonical, Open Graph and Twitter, existing share image", () => {
  const s = src("src/app/page.tsx");
  assert.match(s, /metadataBase: new URL\(seoSiteUrl\(\)\)/);
  assert.match(s, /alternates: \{ canonical: "\/" \}/);
  assert.match(s, /twitter: \{\s*card: "summary_large_image"/);
  assert.match(s, /images: \[\{ url: "\/brand\/ringo-og\.png", width: 1200, height: 630/);
  assert.equal(seo.seoSiteUrl(), "https://ringoconnectltd.com", "uses the existing siteBase mechanism, trailing slash removed");
  const deep = load("lib/deepLinks.ts");
  assert.equal(seo.seoSiteUrl(), deep.siteBase(), "the same function the rest of the app uses");
});

console.log(`\nseoMetadata: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
