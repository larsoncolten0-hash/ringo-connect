// Phase 4C: JSON-LD on the public profile. Pure functions (lib/seo.ts) plus a source check of how the page
// emits them. No network, no database.
//   Run:  node scripts/tests/seoStructuredData.test.mjs
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

process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com";
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
const IMG = "https://abcdefgh.supabase.co/storage/v1/object/public/avatars/a.png";
const BASE = {
  name: "Ada Mbella",
  username: "ada",
  bio: "Photographer and trainer in Douala.",
  avatar_url: IMG,
  category: "freelancers_creators",
  social_links: [{ platform: "instagram", url: "https://instagram.com/ada" }],
  is_demo: false,
};
const ld = (over = {}) => seo.buildProfileJsonLd({ ...BASE, ...over });

await test("a profile gets a ProfilePage whose mainEntity carries only name, url, image, description and sameAs", () => {
  const j = ld();
  assert.equal(j["@context"], "https://schema.org");
  assert.equal(j["@type"], "ProfilePage");
  assert.equal(j.url, "https://ringoconnectltd.com/ada");
  assert.equal(j.name, "Ada Mbella");
  assert.deepEqual(j.mainEntity, {
    "@type": "Person",
    name: "Ada Mbella",
    url: "https://ringoconnectltd.com/ada",
    image: IMG,
    description: "Photographer and trainer in Douala.",
    sameAs: ["https://instagram.com/ada"],
  });
});
await test("Person vs Organization is decided by the profile's own data, and left out when the data does not say", () => {
  assert.equal(seo.entityType({ category: "freelancers_creators" }), "Person");
  assert.equal(seo.entityType({ category: "restaurant_food" }), "Organization");
  assert.equal(seo.entityType({ category: "business_ecommerce" }), "Organization");
  assert.equal(seo.entityType({ category: "restaurant_food", about_position: "Chef" }), "Person", "a role on the About card is a person");
  assert.equal(seo.entityType({ category: "other", about_company: "Santé Plus" }), "Organization");
  assert.equal(seo.entityType({ category: "beauty_wellness" }), null, "a barber or a salon: not guessed");
  assert.equal(seo.entityType({ category: "music_entertainment" }), null, "an artist or a band: not guessed");
  assert.equal(seo.entityType({ category: "other" }), null);
  const untyped = ld({ category: "music_entertainment" });
  assert.equal(untyped["@type"], "ProfilePage");
  assert.equal(untyped.mainEntity, undefined);
  assert.equal(ld({ category: "restaurant_food" }).mainEntity["@type"], "Organization");
});
await test("nothing is invented: no description, image or sameAs when the profile has none", () => {
  const j = ld({ bio: null, avatar_url: null, cover_image_url: null, social_links: [] });
  assert.deepEqual(j.mainEntity, { "@type": "Person", name: "Ada Mbella", url: "https://ringoconnectltd.com/ada" });
  assert.ok(!JSON.stringify(j).includes("Ringo Connect profile"), "the bilingual metadata fallback sentence is not structured data");
});
await test("About role / company stand in for a missing bio, exactly as the page displays them", () => {
  assert.equal(ld({ bio: "", about_position: "Director", about_company: "Santé Plus" }).mainEntity.description, "Director — Santé Plus");
});
await test("image: a real avatar, else a real cover, else none; unsafe URLs are dropped", () => {
  assert.equal(ld({ avatar_url: null, cover_image_url: IMG }).mainEntity.image, IMG);
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AA", "https://evil.example.com/a.png", "http://abcdefgh.supabase.co/a.png"])
    assert.equal(ld({ avatar_url: bad }).mainEntity.image, undefined, bad);
});
await test("sameAs: only public http(s) social links, normalized and de-duplicated; no mailto, tel, javascript or junk", () => {
  const links = [
    { url: "https://instagram.com/ada" },
    { url: "instagram.com/ada" }, // bare address: normalized to https, a different string from the first
    { url: "https://instagram.com/ada" }, // duplicate
    { url: "mailto:ada@x.com" },
    { url: "tel:+237600000000" },
    { url: "whatsapp://send?phone=1" },
    { url: "javascript:alert(1)" },
    { url: "https://" },
    { url: "" },
    { url: null },
    null,
    "not-an-object",
  ];
  assert.deepEqual(seo.publicSameAs(links), ["https://instagram.com/ada", "https://instagram.com/ada"].filter((v, i, a) => a.indexOf(v) === i));
  assert.deepEqual(seo.publicSameAs(undefined), []);
  assert.deepEqual(seo.publicSameAs("x"), []);
  assert.ok(!JSON.stringify(ld({ social_links: links })).match(/mailto|tel:|whatsapp|javascript/));
});
await test("no private or commerce field can reach the JSON-LD, even if the profile object carries them", () => {
  const dirty = {
    ...BASE,
    about_email: "secret@x.com",
    about_phone: "+237600000000",
    about_location: "Akwa, Douala",
    about_hours: "Mon-Fri 9-5",
    whatsapp_number: "+237611111111",
    user_id: "owner-uuid-1234",
    id: "profile-uuid-5678",
    facebook_pixel_id: "999",
    theme_color: "#123456",
    currency: "XAF",
    profile_phone_numbers: [{ phone_number: "+237622222222" }],
    products: [{ name: "Thing", price: 5000 }],
    reviews: [{ rating: 5 }],
  };
  const text = JSON.stringify(seo.buildProfileJsonLd(dirty));
  for (const secret of ["secret@x.com", "237600", "237611", "237622", "Akwa", "Mon-Fri", "owner-uuid", "profile-uuid", "999", "123456", "XAF", "Thing", "5000"])
    assert.ok(!text.includes(secret), secret);
  const keys = Object.keys(seo.buildProfileJsonLd(dirty).mainEntity).sort();
  assert.deepEqual(keys, ["@type", "description", "image", "name", "sameAs", "url"]);
  for (const forbidden of ["address", "telephone", "email", "openingHours", "priceRange", "aggregateRating", "review", "geo", "makesOffer"]) assert.ok(!text.includes(`"${forbidden}"`), forbidden);
});
await test("a demo profile, and a profile with no name or username, carry no structured data", () => {
  assert.equal(ld({ is_demo: true }), null);
  assert.equal(seo.buildProfileJsonLd({ ...BASE, name: "", username: "" }), null);
});
await test("serializeJsonLd: profile-controlled text cannot terminate the script element or open a comment", () => {
  const j = ld({ name: "</script><script>alert(1)</script>", bio: "<!-- x --> & <b>bold</b>" });
  const out = seo.serializeJsonLd(j);
  assert.ok(!out.includes("<") && !out.includes(">") && !out.includes("&"), out);
  assert.ok(!/<\/script/i.test(out));
  const parsed = JSON.parse(out);
  assert.equal(parsed.name, "</script><script>alert(1)</script>", "the data round-trips unchanged");
  const sep = `x${String.fromCharCode(0x2028)}y${String.fromCharCode(0x2029)}z`;
  const out2 = seo.serializeJsonLd({ a: sep });
  assert.ok(!out2.includes(String.fromCharCode(0x2028)) && !out2.includes(String.fromCharCode(0x2029)));
  assert.equal(JSON.parse(out2).a, sep);
});
await test("hostile values never throw", () => {
  assert.doesNotThrow(() => ld({ name: 42, bio: {}, social_links: "x", about_position: [], category: null }));
  assert.doesNotThrow(() => seo.buildProfileJsonLd({ username: "u", name: null, social_links: [{ url: { toString() { throw new Error("x"); } } }] }));
});
await test("the public page emits exactly one JSON-LD script, built from the same public profile object, serialized safely", () => {
  const s = src("src/app/[username]/page.tsx");
  assert.equal((s.match(/application\/ld\+json/g) || []).length, 1);
  assert.match(s, /buildProfileJsonLd\(publicProfile as any\)/);
  assert.match(s, /__html: serializeJsonLd\(jsonLd\)/);
  // the secret-bearing columns are removed from `publicProfile` before it reaches the builder
  assert.match(s, /const \{ facebook_capi_token_encrypted, tiktok_events_token_encrypted, \.\.\.publicProfile \} = profile/);
  assert.ok(s.indexOf("const { facebook_capi_token_encrypted") < s.indexOf("buildProfileJsonLd(publicProfile"));
  // no other component or layout adds a second one
  for (const f of ["src/components/ProfileView.tsx", "src/app/layout.tsx", "src/lib/profileMetadata.ts"]) assert.ok(!/ld\+json/.test(src(f)), f);
});

console.log(`\nseoStructuredData: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
