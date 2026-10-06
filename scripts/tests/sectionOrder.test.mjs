// Phase 3C: category-aware order of the public profile's content sections (lib/sectionOrder.ts) and how
// ProfileView uses it. The helper is pure and tested directly; the wiring is checked on the source with comments
// stripped (there is no React renderer in this repo).
//   Run:  node scripts/tests/sectionOrder.test.mjs
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

const O = jiti(path.join(SRC, "lib/sectionOrder.ts"));
const { CATEGORIES } = jiti(path.join(SRC, "lib/categories.ts"));

const ALL = { about: true, links: true, catalog: true, events: true };
const NONE = { about: false, links: false, catalog: false, events: false };
const order = (category, has = ALL, extra = {}) => O.orderPublicSections({ category, subcategory: null, isMusic: false, isRestaurant: false, ...extra }, has);

// ------------------------------------------------------------------ every canonical category
const EXPECTED_ALL = {
  business_ecommerce: ["catalog", "links", "about", "events"],
  events_experiences: ["events", "catalog", "about", "links"],
  professional_services: ["catalog", "about", "links", "events"],
  beauty_wellness: ["catalog", "about", "links", "events"],
  health_medical: ["catalog", "about", "links", "events"],
  real_estate: ["catalog", "about", "links", "events"],
  transport_logistics: ["catalog", "about", "links", "events"],
  education_training: ["catalog", "about", "links", "events"],
  travel_hospitality: ["catalog", "about", "links", "events"],
  creative_media: ["catalog", "about", "links", "events"],
  freelancers_creators: ["catalog", "about", "links", "events"],
  construction_home_services: ["catalog", "about", "links", "events"],
  agriculture_agribusiness: ["catalog", "about", "links", "events"],
  other: ["about", "links", "catalog", "events"],
};
await test("all 16 canonical categories are covered and each gets its documented order when every section has content", () => {
  assert.equal(CATEGORIES.length, 16);
  for (const c of CATEGORIES) {
    if (c.id === "music_entertainment") {
      assert.deepEqual(order(c.id, ALL, { isMusic: true }), ["music", "releases", "catalog", "events", "links", "about"], c.id);
    } else if (c.id === "restaurant_food") {
      assert.deepEqual(order(c.id, ALL, { isRestaurant: true }), ["about", "links", "catalog", "events"], c.id);
    } else {
      assert.deepEqual(order(c.id), EXPECTED_ALL[c.id], c.id);
    }
  }
  assert.equal(Object.keys(EXPECTED_ALL).length, 14, "the other two are the protected specialised layouts");
});
await test("the offer (products / services / listings / courses / rooms / portfolio) leads for every offering category; links never lead except for creators", () => {
  for (const c of ["business_ecommerce", "professional_services", "beauty_wellness", "health_medical", "real_estate", "transport_logistics", "education_training", "travel_hospitality", "creative_media", "freelancers_creators", "construction_home_services", "agriculture_agribusiness"]) {
    assert.equal(order(c)[0], "catalog", c);
  }
  assert.equal(order("events_experiences")[0], "events");
  assert.equal(order("other")[0], "about", "'other' keeps the long-standing order");
});
await test("business / e-commerce: products, then links, then About, then events", () => {
  assert.deepEqual(order("business_ecommerce"), ["catalog", "links", "about", "events"]);
});
await test("services-style categories: services, then About, then links (Booking is the hero's action, not a section)", () => {
  for (const c of ["professional_services", "beauty_wellness", "health_medical", "transport_logistics", "construction_home_services"]) {
    assert.deepEqual(order(c).slice(0, 3), ["catalog", "about", "links"], c);
  }
});

// ------------------------------------------------------------------ subcategories
await test("subcategory: content creators put their links before what they sell; other creator subcategories and categories are unaffected", () => {
  for (const sub of ["youtuber", "influencer", "blogger", "streamer"]) {
    assert.deepEqual(order("freelancers_creators", ALL, { subcategory: sub }), ["links", "catalog", "about", "events"], sub);
  }
  for (const sub of ["freelancer", "other", null, "unknown"]) {
    assert.deepEqual(order("freelancers_creators", ALL, { subcategory: sub }), ["catalog", "about", "links", "events"], String(sub));
  }
  assert.deepEqual(order("creative_media", ALL, { subcategory: "youtuber" }), ["catalog", "about", "links", "events"], "the rule belongs to freelancers_creators only");
  assert.deepEqual(order("business_ecommerce", ALL, { subcategory: "influencer" }), ["catalog", "links", "about", "events"]);
});
await test("every real subcategory of every category produces a valid, duplicate-free order", () => {
  let n = 0;
  for (const c of CATEGORIES) {
    for (const sub of c.defaults.subcategories || []) {
      const o = order(c.id, ALL, { subcategory: sub.id });
      assert.equal(new Set(o).size, o.length, `${c.id}/${sub.id}`);
      assert.deepEqual([...o].sort(), ["about", "catalog", "events", "links"], `${c.id}/${sub.id}`);
      n++;
    }
  }
  assert.ok(n > 60, "the real subcategory list was exercised (" + n + ")");
});

// ------------------------------------------------------------------ empty and meaningful sections
await test("a section with nothing to show is not in the order", () => {
  assert.deepEqual(order("business_ecommerce", { ...ALL, catalog: false }), ["links", "about", "events"]);
  assert.deepEqual(order("professional_services", { ...ALL, links: false, events: false }), ["catalog", "about"]);
  assert.deepEqual(order("events_experiences", { ...ALL, events: false }), ["catalog", "about", "links"]);
  assert.deepEqual(order("real_estate", { about: true, links: false, catalog: false, events: false }), ["about"]);
});
await test("an empty About keeps its note but always LAST, so it never sits above real content", () => {
  for (const c of ["business_ecommerce", "professional_services", "freelancers_creators", "other", "events_experiences", "real_estate"]) {
    const o = order(c, { ...ALL, about: false });
    assert.equal(o[o.length - 1], "about", c);
    assert.equal(count(o.join(","), /about/g), 1, c);
  }
  assert.deepEqual(order("other", { ...NONE }), ["about"], "nothing at all: only the note");
  assert.deepEqual(order("professional_services", { ...NONE }), ["about"]);
});
await test("meaningful content decides: the same category orders differently as sections gain and lose content", () => {
  assert.deepEqual(order("professional_services", { about: true, links: true, catalog: false, events: false }), ["about", "links"]);
  assert.deepEqual(order("professional_services", { about: true, links: true, catalog: true, events: false }), ["catalog", "about", "links"]);
  assert.deepEqual(order("other", { about: false, links: true, catalog: true, events: false }), ["links", "catalog", "about"]);
});
await test("booking and product availability: booking is not a section, so it cannot change the order; catalogue availability can", () => {
  const inputs = O.orderPublicSections.toString();
  assert.doesNotMatch(inputs, /booking/i, "the helper knows nothing about booking");
  const h = src("lib/sectionOrder.ts");
  assert.doesNotMatch(h, /bookings?_enabled/);
  for (const c of ["professional_services", "beauty_wellness", "real_estate", "business_ecommerce"]) {
    assert.deepEqual(order(c, ALL), order(c, ALL), "deterministic");
  }
  assert.equal(order("business_ecommerce", { ...ALL, catalog: false })[0], "links");
  assert.equal(order("business_ecommerce", ALL)[0], "catalog");
});

// ------------------------------------------------------------------ the specialised layouts are protected
await test("Music has its own curated order (music, releases and store, merch, events, links, contact card last) whatever the category, subcategory or content", () => {
  const legacy = ["music", "releases", "catalog", "events", "links", "about"];
  for (const c of [...CATEGORIES.map((x) => x.id), null, "", "nope"]) {
    for (const sub of [null, "youtuber", "influencer"]) {
      for (const has of [ALL, NONE, { ...ALL, about: false }, { about: true, links: false, catalog: false, events: false }]) {
        assert.deepEqual(order(c, has, { isMusic: true, subcategory: sub }), legacy, `${c}/${sub}`);
      }
    }
  }
});
await test("Restaurant keeps its exact long-standing order whatever the content; Music wins if a profile has both", () => {
  const legacy = ["about", "links", "catalog", "events"];
  for (const c of [...CATEGORIES.map((x) => x.id), null]) {
    for (const has of [ALL, NONE, { ...ALL, about: false }]) assert.deepEqual(order(c, has, { isRestaurant: true }), legacy, String(c));
  }
  assert.deepEqual(order("restaurant_food", ALL, { isRestaurant: true, isMusic: true }), ["music", "releases", "catalog", "events", "links", "about"]);
});
await test("unknown or missing category falls back to the long-standing generic order", () => {
  for (const c of [null, undefined, "", "not_a_category"]) assert.deepEqual(order(c), ["about", "links", "catalog", "events"]);
});

// ------------------------------------------------------------------ invariants over every combination
await test("always: no duplicates, About exactly once, only sections that have content (plus the empty About note), deterministic", () => {
  const keys = ["about", "links", "catalog", "events"];
  let combos = 0;
  const cats = [...CATEGORIES.map((c) => c.id), null, "unknown"];
  for (const c of cats) {
    for (const flags of [{}, { isMusic: true }, { isRestaurant: true }]) {
      for (let mask = 0; mask < 16; mask++) {
        const has = Object.fromEntries(keys.map((k, i) => [k, !!(mask & (1 << i))]));
        const a = order(c, has, flags);
        const b = order(c, has, flags);
        assert.deepEqual(a, b);
        assert.equal(new Set(a).size, a.length, `dup ${c} ${mask}`);
        assert.equal(count(a.join(","), /about/g), 1);
        if (!flags.isMusic && !flags.isRestaurant) {
          for (const k of a) assert.ok(k === "about" || has[k], `${c} ${mask}: ${k} listed but empty`);
          for (const k of ["links", "catalog", "events"]) assert.equal(a.includes(k), has[k], `${c} ${mask}: ${k}`);
        }
        combos++;
      }
    }
  }
  assert.equal(combos, (CATEGORIES.length + 2) * 3 * 16);
});
await test("the helper is pure: no React, browser, network, storage or database", () => {
  const h = src("lib/sectionOrder.ts");
  assert.doesNotMatch(h, /"use client"|window|document\.|navigator|fetch\(|supabase|localStorage|useState|useEffect|async |await |Promise|import /);
  const input = { category: "business_ecommerce", subcategory: null, isMusic: false, isRestaurant: false };
  const has = { ...ALL };
  const before = JSON.stringify([input, has]);
  O.orderPublicSections(input, has);
  assert.equal(JSON.stringify([input, has]), before, "inputs untouched");
});

// ------------------------------------------------------------------ ProfileView wiring and public / preview parity
await test("ProfileView builds each content section once and places them with the helper (no second ordering system)", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /import \{ orderPublicSections, type PublicSection \} from "@\/lib\/sectionOrder";/);
  assert.equal(count(v, /orderPublicSections\(/g), 1);
  assert.match(v, /const sections: Record<PublicSection, ReactNode> = \{\s*about: /);
  for (const k of ["music", "releases", "links", "catalog", "events"]) assert.match(v, new RegExp(`\\n    ${k}: `), k);
  assert.match(v, /\{sectionOrder\.map\(\(key\) => \(\s*<Fragment key=\{key\}>\{sections\[key\]\}<\/Fragment>/);
  assert.equal(count(v, /sectionOrder\.map/g), 1, "rendered once");
  for (const c of ["<MusicSection", "<ReleasesSection", "<CatalogSection", "<EventsSection"]) assert.equal(count(v, new RegExp(c, "g")), 1, c + " appears once (no duplicate section)");
  assert.match(v, /isMusic, isRestaurant \}/, "Music / Restaurant flags are passed through");
  // the availability handed to the helper is the real, meaningful content (Phase 3A filtered), nothing faked
  assert.match(v, /\{ about: aboutHasContent, links: publicLinks\.length > 0, catalog: catalogProducts\.length > 0, events: hasTicketing && musicEvents\.length > 0 \}/);
});
await test("the sections stay where they were relative to the rest of the page: after Restaurant's menu / hours, before Support and Add to Home Screen", () => {
  const v = src("components/ProfileView.tsx");
  const at = (s) => v.indexOf(s);
  const map = at("{sectionOrder.map");
  assert.ok(at("<FeaturedMenuSection") > 0 && at("<FeaturedMenuSection") < map);
  assert.ok(at("<OpeningHoursRow") > 0 && at("<OpeningHoursRow") < map);
  assert.ok(at("<PinnedSpotlight") > 0 && at("<PinnedSpotlight") < map);
  assert.ok(at("<ConnectButton") > 0 && at("<ConnectButton") < at("<PinnedSpotlight"), "Connect is still first in the content");
  assert.ok(map < at("{supportEnabled &&"));
  assert.ok(at("{supportEnabled &&") < at("<AddToHomeScreen"));
});
await test("public page and editor preview share ONE ordering: both render ProfileView and nothing else orders sections", () => {
  assert.match(src("app/[username]/page.tsx"), /<ProfileView/);
  assert.match(src("components/editor/LivePreviewPanel.tsx"), /<ProfileView profile=\{preview\.profile\} preview \/>/);
  const hits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f.name) && /orderPublicSections|sectionOrder/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(SRC, p).replace(/\\/g, "/"));
    }
  };
  walk(SRC);
  assert.deepEqual(hits.sort(), ["components/ProfileView.tsx", "lib/sectionOrder.ts"]);
});
await test("the specialised heroes and branch order are untouched by this change", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /\{isRestaurant \? \(\s*<RestaurantHeroButtons[\s\S]*?\) : isMusic \? \(\s*<MusicHeroButtons[\s\S]*?\) : \(\s*genericHero && \(\s*<GenericHeroActions/);
  assert.match(v, /\{isRestaurant && \(\s*<FeaturedMenuSection/);
  assert.match(v, /\{isRestaurant && \(\s*<OpeningHoursRow/);
});
await test("ProfileView keeps the About note behaviour: the card is the same component output, with its empty note only when it has nothing", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /const isEmpty = !hasRoleCard && contactRows\.length === 0;\s*aboutHasContent = !isEmpty;/);
  assert.match(v, /t\.profilePage\.noAboutInfo/);
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
