// Ringo guidance layer (src/lib/profileHealth): Profile Health, category- and plan-aware completion, Next Best
// Action, recommendations, milestones, insights, quick actions, and EN/FR parity of every guidance string.
// Pure logic: no network, no database, no migration.
//   Run:  node scripts/tests/profileHealth.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const H = jiti(path.join(SRC, "lib/profileHealth/index.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split("\n").join("\n    ")}`);
  }
}

const FREE = { max_products: 0, max_links: 5, bookings_feature_enabled: true };
const PAID = { max_products: 20, max_links: null, bookings_feature_enabled: true };
const ids = (items) => items.map((i) => i.id);
const base = { name: "Ama", avatar_url: "x.png", bio: "Hello", whatsapp_number: "+237600000000", social_links: [{}], links: [{}], published: true };

// ------------------------------------------------------------------ universal
test("0% profile (nothing filled, no category)", () => {
  const h = H.computeProfileHealth({ profile: {}, plan: PAID });
  assert.equal(h.percentage, 0);
  assert.equal(h.isComplete, false);
  assert.equal(h.status, "attention");
  assert.deepEqual(ids(h.items).sort(), ["avatar", "bio", "category", "links", "name", "socials", "whatsapp"].sort());
});

test("partially complete profile", () => {
  const h = H.computeProfileHealth({ profile: { name: "Ama", avatar_url: "x", bio: "b" }, plan: PAID });
  assert.equal(h.completedItems.length, 3);
  assert.equal(h.missingItems.length, 4);
  assert.equal(h.percentage, Math.round((3 / 7) * 100));
});

test("fully complete universal profile reaches 100% and is live", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other" }, plan: PAID });
  assert.equal(h.percentage, 100);
  assert.equal(h.isComplete, true);
  assert.equal(h.status, "live");
});

test("completion and publication are separate: unpublished at 100% stays 100% / complete, with published=false", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other", published: false }, plan: PAID });
  assert.equal(h.percentage, 100);
  assert.equal(h.isComplete, true);
  assert.equal(h.missingItems.length, 0);
  assert.equal(h.published, false);
  assert.equal(h.status, "complete", "not 'live' (not published) and not 'attention' (content is complete)");
  const live = H.computeProfileHealth({ profile: { ...base, category: "other", published: true }, plan: PAID });
  assert.equal(live.status, "live");
  assert.equal(live.published, true);
});
test("unpublished does not change the percentage, checklist or status of an incomplete page", () => {
  const a = H.computeProfileHealth({ profile: { name: "A", avatar_url: "a", bio: "b", category: "restaurant_food", published: true }, plan: PAID });
  const b = H.computeProfileHealth({ profile: { name: "A", avatar_url: "a", bio: "b", category: "restaurant_food", published: false }, plan: PAID });
  assert.equal(a.percentage, b.percentage);
  assert.equal(a.status, b.status);
  assert.deepEqual(ids(a.items), ids(b.items));
  assert.equal(b.published, false);
});

test("blank/whitespace strings do not count", () => {
  const h = H.computeProfileHealth({ profile: { name: "  ", bio: "\n" }, plan: PAID });
  assert.equal(h.completedItems.length, 0);
});

// ------------------------------------------------------------------ plan-aware
test("FREE plan: locked catalogue is excluded and a free page can reach 100%", () => {
  const profile = { ...base, category: "beauty_wellness", about_location: "Douala", about_hours: "9-5" };
  const h = H.computeProfileHealth({ profile, plan: FREE });
  assert.ok(!ids(h.items).includes("catalog"), "catalog must not be scored on a plan where it is locked");
  assert.equal(h.percentage, 100);
});

test("paid plan: catalogue counts for service categories", () => {
  const profile = { ...base, category: "beauty_wellness", about_location: "Douala", about_hours: "9-5" };
  const h = H.computeProfileHealth({ profile, plan: PAID });
  assert.ok(ids(h.missingItems).includes("catalog"));
  const done = H.computeProfileHealth({ profile: { ...profile, products: [{ image_url: "a" }] }, plan: PAID });
  assert.equal(done.percentage, 100);
});

test("unknown plan does not penalise (catalogue treated as available)", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "business_ecommerce" }, plan: null });
  assert.ok(ids(h.items).includes("catalog"));
});

test("links locked by plan (max_links = 0) are excluded", () => {
  const h = H.computeProfileHealth({ profile: { category: "other" }, plan: { max_links: 0 } });
  assert.ok(!ids(h.items).includes("links"));
});

// ------------------------------------------------------------------ category-aware
test("restaurant: menu + location + opening hours, no catalogue", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "restaurant_food" }, plan: PAID });
  assert.deepEqual(ids(h.missingItems).sort(), ["hours", "location", "menuItems"]);
  assert.ok(!ids(h.items).includes("catalog"));
  const done = H.computeProfileHealth({
    profile: { ...base, category: "restaurant_food", about_location: "Akwa", menu_items: [{ image_url: "p" }], opening_hours: { mon: { open: "08:00", close: "22:00", closed: false } } },
    plan: PAID,
  });
  assert.equal(done.percentage, 100);
});

test("restaurant: empty opening_hours object ({}) is not 'set'", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "restaurant_food", opening_hours: {} }, plan: PAID });
  assert.ok(ids(h.missingItems).includes("hours"));
});

test("music: a track OR a release satisfies the offering; no location/hours/catalogue", () => {
  const p = { ...base, category: "music_entertainment" };
  const none = H.computeProfileHealth({ profile: p, plan: PAID });
  assert.deepEqual(ids(none.missingItems), ["tracks"]);
  assert.equal(H.computeProfileHealth({ profile: { ...p, music_releases: [{}] }, plan: PAID }).percentage, 100);
  assert.equal(H.computeProfileHealth({ profile: { ...p, tracks: [{}] }, plan: PAID }).percentage, 100);
});

test("events category counts events, not a catalogue", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "events_experiences", about_location: "Yaoundé" }, plan: PAID });
  assert.deepEqual(ids(h.missingItems), ["events"]);
});

test("real estate: only the existing catalogue is scored (as 'Listings'); no invented property criterion", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "real_estate" }, plan: PAID });
  const catalog = h.items.find((i) => i.id === "catalog");
  assert.equal(catalog.catalogLabel.en, "Listings");
  const allowed = new Set(["name", "avatar", "bio", "category", "whatsapp", "socials", "links", "location", "hours", "catalog", "menuItems", "tracks", "events"]);
  for (const id of ids(h.items)) assert.ok(allowed.has(id));
  assert.ok(!ids(h.items).some((id) => /propert|listing|room|course|route/i.test(id)));
});

test("transport / education / agriculture / other only score real features", () => {
  for (const category of ["transport_logistics", "education_training", "agriculture_agribusiness", "other"]) {
    const h = H.computeProfileHealth({ profile: { category }, plan: PAID });
    assert.ok(!ids(h.items).includes("menuItems") && !ids(h.items).includes("tracks") && !ids(h.items).includes("events"), category);
  }
  assert.ok(!ids(H.computeProfileHealth({ profile: { category: "other" }, plan: PAID }).items).includes("catalog"));
});

test("secondary category adds its offering (restaurant + music)", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "restaurant_food", categories: ["restaurant_food", "music_entertainment"] }, plan: PAID });
  assert.ok(ids(h.items).includes("menuItems") && ids(h.items).includes("tracks"));
});

test("every category produces a valid result", () => {
  const { CATEGORY_IDS } = jiti(path.join(SRC, "lib/categories.ts"));
  assert.equal(CATEGORY_IDS.length, 16);
  for (const category of CATEGORY_IDS) {
    for (const plan of [FREE, PAID]) {
      const h = H.computeProfileHealth({ profile: { category }, plan });
      assert.ok(h.percentage >= 0 && h.percentage <= 100);
      assert.equal(h.completedItems.length + h.missingItems.length, h.items.length);
    }
  }
});

// ------------------------------------------------------------------ next best action
test("very incomplete page: headline 'overall' action pointing at the first missing step", () => {
  const h = H.computeProfileHealth({ profile: { category: "other" }, plan: PAID });
  assert.equal(h.nextAction.overall, true);
  assert.equal(h.nextAction.id, "name");
});

test("one missing item: that item, not overall (WhatsApp)", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other", whatsapp_number: "" }, plan: PAID });
  assert.equal(h.nextAction.id, "whatsapp");
  assert.equal(h.nextAction.overall, false);
  assert.equal(h.nextAction.href, "/dashboard?section=whatsapp");
});

test("restaurant with no menu is asked for the menu before location/hours", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "restaurant_food" }, plan: PAID });
  assert.equal(h.nextAction.id, "menuItems");
});

test("next action changes when state changes", () => {
  const p = { ...base, category: "restaurant_food" };
  const before = H.computeProfileHealth({ profile: p, plan: PAID }).nextAction.id;
  const after = H.computeProfileHealth({ profile: { ...p, menu_items: [{ image_url: "x" }] }, plan: PAID }).nextAction.id;
  assert.notEqual(before, after);
  assert.equal(after, "location");
});

test("complete page: growth action; share first when zero visits; analytics only with real traffic", () => {
  const p = { ...base, category: "other" };
  assert.equal(H.computeProfileHealth({ profile: p, plan: PAID, activity: { totalPageViews: 0 } }).nextAction.id, "shareProfile");
  const none = H.computeProfileHealth({ profile: p, plan: PAID });
  assert.ok(!ids(none.recommendations).includes("reviewAnalytics"));
  const few = H.computeProfileHealth({ profile: p, plan: PAID, activity: { totalPageViews: H.ANALYTICS_REVIEW_MIN_VIEWS - 1 } });
  assert.ok(!ids(few.recommendations).includes("reviewAnalytics"));
  const busy = H.computeProfileHealth({ profile: p, plan: PAID, activity: { totalPageViews: H.ANALYTICS_REVIEW_MIN_VIEWS } });
  assert.ok(ids(busy.recommendations).includes("reviewAnalytics"));
});

test("share action is a 'share' action, not a route", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other" }, plan: PAID, activity: { totalPageViews: 0 } });
  assert.equal(h.nextAction.action, "share");
});

test("never recommends something already complete", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "restaurant_food", menu_items: [{ image_url: "x" }], about_location: "a", opening_hours: { mon: {} } }, plan: PAID });
  const completed = new Set(ids(h.completedItems));
  for (const r of h.recommendations.filter((x) => x.kind === "complete")) assert.ok(!completed.has(r.id));
  assert.ok(!ids(h.recommendations).includes("menuPhotos") || h.recommendations.find((r) => r.id === "menuPhotos").kind === "grow");
});

test("dismissed ids are skipped; all dismissed = null", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other", whatsapp_number: "" }, plan: PAID });
  const next = H.pickNextAction(h.recommendations, { dismissed: ["whatsapp"], missingCount: 1 });
  assert.notEqual(next?.id, "whatsapp");
  assert.equal(H.pickNextAction(h.recommendations, { dismissed: h.recommendations.map((r) => r.id) }), null);
});


test("a specific valuable step is named, not the generic headline (restaurant with only the menu step on top)", () => {
  // basics done, but 5 items missing: the menu is the most valuable thing to add
  const h = H.computeProfileHealth({ profile: { name: "Ama", avatar_url: "a", bio: "b", category: "restaurant_food" }, plan: PAID });
  assert.ok(h.missingItems.length >= H.VERY_INCOMPLETE_MISSING);
  assert.equal(h.nextAction.id, "menuItems");
  assert.equal(h.nextAction.overall, false, "must say 'Add your menu', not 'Complete your profile'");
});
test("music with no tracks is asked for music; a professional/beauty page is asked for its catalogue (Services) before polish", () => {
  const m = H.computeProfileHealth({ profile: { name: "A", avatar_url: "a", bio: "b", category: "music_entertainment" }, plan: PAID });
  assert.equal(m.nextAction.id, "tracks");
  const p = H.computeProfileHealth({ profile: { name: "A", avatar_url: "a", bio: "b", category: "professional_services" }, plan: PAID });
  assert.equal(p.nextAction.id, "catalog");
  assert.equal(p.nextAction.catalogLabel.en, "Services");
});

// ------------------------------------------------------------------ recommendations
test("recommendation disappears when its condition is resolved", () => {
  const p = { ...base, category: "restaurant_food", about_location: "a", opening_hours: { mon: {} } };
  const withoutPhoto = H.computeProfileHealth({ profile: { ...p, menu_items: [{ image_url: null }] }, plan: PAID });
  assert.ok(ids(withoutPhoto.recommendations).includes("menuPhotos"));
  const withPhoto = H.computeProfileHealth({ profile: { ...p, menu_items: [{ image_url: "pic.png" }] }, plan: PAID });
  assert.ok(!ids(withPhoto.recommendations).includes("menuPhotos"));
});

test("unsupported features are never recommended", () => {
  const music = H.computeProfileHealth({ profile: { ...base, category: "music_entertainment", tracks: [{}], menu_items: [{}] }, plan: PAID });
  assert.ok(!ids(music.recommendations).includes("menuPhotos"));
  // free plan: no product photos suggestion (catalogue locked)
  const free = H.computeProfileHealth({ profile: { ...base, category: "business_ecommerce", products: [{ image_url: null }] }, plan: FREE });
  assert.ok(!ids(free.recommendations).includes("productPhotos"));
  // bookings turned off by the plan
  const noBooking = H.computeProfileHealth({ profile: { ...base, category: "beauty_wellness", bookings_enabled: false }, plan: { ...PAID, bookings_feature_enabled: false } });
  assert.ok(!ids(noBooking.recommendations).includes("enableBooking"));
  // category with no booking form
  const other = H.computeProfileHealth({ profile: { ...base, category: "other" }, plan: PAID });
  assert.ok(!ids(other.recommendations).includes("enableBooking"));
  // already enabled
  const enabled = H.computeProfileHealth({ profile: { ...base, category: "beauty_wellness", bookings_enabled: true }, plan: PAID });
  assert.ok(!ids(enabled.recommendations).includes("enableBooking"));
  const available = H.computeProfileHealth({ profile: { ...base, category: "beauty_wellness", bookings_enabled: false }, plan: PAID });
  assert.ok(ids(available.recommendations).includes("enableBooking"));
});

test("music: add-release only when tracks exist and releases do not; music gets event suggestion, events category does not", () => {
  const a = H.computeProfileHealth({ profile: { ...base, category: "music_entertainment", tracks: [{}] }, plan: PAID });
  assert.ok(ids(a.recommendations).includes("addRelease"));
  assert.ok(ids(a.recommendations).includes("addEvent"));
  const b = H.computeProfileHealth({ profile: { ...base, category: "music_entertainment", tracks: [{}], music_releases: [{}] }, plan: PAID });
  assert.ok(!ids(b.recommendations).includes("addRelease"));
  const ev = H.computeProfileHealth({ profile: { ...base, category: "events_experiences" }, plan: PAID });
  assert.ok(!ids(ev.recommendations).includes("addEvent"));
});

test("unpublished page is not asked to be shared", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other", published: false }, plan: PAID });
  assert.ok(!ids(h.recommendations).includes("shareProfile"));
});

test("recommendations are sorted by priority", () => {
  const h = H.computeProfileHealth({ profile: { category: "restaurant_food" }, plan: PAID });
  const pr = h.recommendations.map((r) => r.priority);
  assert.deepEqual(pr, [...pr].sort((a, b) => a - b));
});

// ------------------------------------------------------------------ milestones / insights / quick actions
test("milestones are detected from facts and unknowns are omitted", () => {
  const m = H.detectMilestones({ published: true, isComplete: false, totalPageViews: 0, offeringCount: 0 });
  const get = (id) => m.find((x) => x.id === id);
  assert.equal(get("live").achieved, true);
  assert.equal(get("complete").achieved, false);
  assert.equal(get("firstVisit").achieved, false);
  assert.equal(get("firstOrder"), undefined, "unknown orders count must not produce a milestone");
  assert.equal(get("firstCommunityMember"), undefined);
  const m2 = H.detectMilestones({ published: true, isComplete: true, totalPageViews: 37, offeringCount: 2, paidOrders: 1, communityMembers: 3 });
  assert.equal(m2.find((x) => x.id === "visits100").achieved, false);
  assert.deepEqual(m2.find((x) => x.id === "visits100").progress, { current: 37, target: 100 });
  assert.equal(H.detectMilestones({ published: true, isComplete: true, totalPageViews: 100 }).find((x) => x.id === "visits100").achieved, true);
  const { achieved, next } = H.milestoneHighlights(m2);
  assert.ok(achieved.length >= 4);
  assert.equal(next.id, "visits100");
});

test("insights: trend directions and missing data", () => {
  assert.equal(H.compareTrend(0, 0).direction, "none");
  assert.equal(H.compareTrend(5, 0).direction, "new");
  assert.deepEqual(H.compareTrend(150, 100), { direction: "up", changePct: 50 });
  assert.deepEqual(H.compareTrend(50, 100), { direction: "down", changePct: -50 });
  assert.equal(H.compareTrend(102, 100).direction, "flat");
  assert.equal(H.visitsTrend(undefined), null);
  assert.equal(H.visitsTrend({ pageViews7d: 4 }), null, "no comparison without both windows");
  assert.equal(H.visitsTrend({ pageViews7d: 10, pageViewsPrev7d: 5 }).direction, "up");
});

test("quick actions only include what the profile can use", () => {
  const free = H.computeProfileHealth({ profile: { category: "beauty_wellness" }, plan: FREE });
  assert.ok(!H.quickActions(free).some((a) => a.id === "addCatalog"), "locked catalogue: no 'add product' shortcut");
  const paid = H.computeProfileHealth({ profile: { category: "beauty_wellness" }, plan: PAID });
  assert.ok(H.quickActions(paid).some((a) => a.id === "addCatalog"));
  const rest = H.computeProfileHealth({ profile: { category: "restaurant_food" }, plan: PAID });
  assert.ok(H.quickActions(rest).some((a) => a.id === "editMenu") && !H.quickActions(rest).some((a) => a.id === "addMusic"));
  for (const a of H.quickActions(paid)) assert.ok(["link", "external", "share"].includes(a.kind));
});


// ------------------------------------------------------------------ dismissals (localStorage) robustness
const D = jiti(path.join(SRC, "lib/profileHealth/dismissals.ts"));
function withStorage(impl, fn) {
  const prev = globalThis.window;
  globalThis.window = { localStorage: impl };
  try { fn(); } finally { globalThis.window = prev; }
}
test("dismissals: malformed / wrong-type / hostile stored values never throw and are ignored", () => {
  for (const raw of ["{not json", "null", "42", "\"str\"", "{\"a\":1}", "[1,null,{},\"ok\"]"]) {
    withStorage({ getItem: () => raw, setItem() {} }, () => {
      const out = D.readDismissed("p1");
      assert.ok(Array.isArray(out));
      assert.ok(out.every((x) => typeof x === "string"));
    });
  }
  withStorage({ getItem: () => "[1,null,{},\"ok\"]", setItem() {} }, () => assert.deepEqual(D.readDismissed("p1"), ["ok"]));
});
test("dismissals: blocked storage (getItem/setItem throw) is safe", () => {
  withStorage({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }, () => {
    assert.deepEqual(D.readDismissed("p1"), []);
    D.writeDismissed("p1", ["x"]);
  });
});
test("dismissals: stale ids for removed recommendations do not break next-action selection; per-profile keys; de-duplicated", () => {
  const h = H.computeProfileHealth({ profile: { ...base, category: "other", whatsapp_number: "" }, plan: PAID });
  assert.equal(H.pickNextAction(h.recommendations, { dismissed: ["gone-forever", "also-gone"], missingCount: 1 }).id, "whatsapp");
  const store = {};
  withStorage({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, () => {
    D.writeDismissed("a", ["x", "x", "y"]);
    D.writeDismissed("b", ["z"]);
    assert.deepEqual(D.readDismissed("a"), ["x", "y"]);
    assert.deepEqual(D.readDismissed("b"), ["z"]);
  });
});
test("dismissing does not change the score or the checklist", () => {
  const input = { profile: { ...base, category: "other", whatsapp_number: "" }, plan: PAID };
  const before = H.computeProfileHealth(input);
  H.pickNextAction(before.recommendations, { dismissed: ["whatsapp"], missingCount: 1 });
  const after = H.computeProfileHealth(input);
  assert.equal(after.percentage, before.percentage);
  assert.deepEqual(ids(after.missingItems), ids(before.missingItems));
});

// ------------------------------------------------------------------ i18n (EN + FR)
function shape(v, p = "") {
  if (typeof v === "function") return [`${p}:fn${v.length}`];
  if (v && typeof v === "object") return Object.keys(v).sort().flatMap((k) => shape(v[k], `${p}.${k}`));
  return [`${p}:str`];
}
test("guidance strings: identical key/function shape in EN and FR", () => {
  assert.deepEqual(shape(translations.fr.guidance), shape(translations.en.guidance));
});
test("guidance strings: no empty strings in either language", () => {
  const walk = (v, p, out) => {
    if (typeof v === "string") (v.trim() ? 0 : out.push(p));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`, out);
  };
  const empty = [];
  walk(translations.en.guidance, "en", empty);
  walk(translations.fr.guidance, "fr", empty);
  assert.deepEqual(empty, []);
});
test("French differs from English for visible text (not copy-pasted)", () => {
  assert.notEqual(translations.fr.guidance.presenceTitle, translations.en.guidance.presenceTitle);
  assert.notEqual(translations.fr.guidance.rec.whatsapp.title, translations.en.guidance.rec.whatsapp.title);
  assert.notEqual(translations.fr.nav.home, translations.en.nav.home);
});
test("every recommendation, checklist and milestone id has wording", () => {
  const allRec = ["name", "avatar", "bio", "category", "whatsapp", "socials", "links", "location", "hours", "catalog", "menuItems", "tracks", "events", "menuPhotos", "productPhotos", "addRelease", "enableBooking", "addEvent", "shareProfile", "reviewAnalytics"];
  for (const loc of ["en", "fr"]) {
    const g = translations[loc].guidance;
    for (const id of allRec) {
      const r = g.rec[id];
      assert.ok(r && r.cta && r.reason && r.benefit && r.title, `${loc} rec ${id}`);
    }
    for (const id of allRec.slice(0, 13)) assert.ok(g.done[id], `${loc} done ${id}`);
    for (const id of ["live", "complete", "firstVisit", "visits100", "firstOffering", "firstOrder", "firstCommunityMember"]) assert.ok(g.milestone[id].title && g.milestone[id].body, `${loc} milestone ${id}`);
  }
  // every id the logic can emit has wording
  const { CATEGORY_IDS } = jiti(path.join(SRC, "lib/categories.ts"));
  const emitted = new Set();
  for (const category of CATEGORY_IDS) {
    const h = H.computeProfileHealth({ profile: { category, products: [{}], menu_items: [{}], tracks: [{}], published: true }, plan: PAID, activity: { totalPageViews: 99 } });
    h.recommendations.forEach((r) => emitted.add(r.id));
    h.items.forEach((i) => emitted.add(i.id));
  }
  for (const id of emitted) assert.ok(allRec.includes(id), `unknown id emitted: ${id}`);
});
test("catalogue wording uses the category's own bilingual label", () => {
  assert.match(translations.en.guidance.rec.catalog.title("Services"), /Services/);
  assert.match(translations.fr.guidance.rec.catalog.title("Services"), /Services/);
  assert.match(translations.en.guidance.rec.catalog.title(undefined), /product/i);
});

// ------------------------------------------------------------------ wiring: the UI actually uses the logic; nothing sensitive touched
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
test("completion card and Home use the shared logic (no scoring in the UI)", () => {
  assert.match(read("src/components/editor/ProfileCompletionCard.tsx"), /computeProfileHealth/);
  assert.match(read("src/app/dashboard/home/page.tsx"), /computeProfileHealth/);
  assert.match(read("src/components/guidance/NextActionCard.tsx"), /pickNextAction/);
  assert.match(read("src/components/Editor.tsx"), /ProfileCompletionCard plan=\{plan\}/);
  assert.doesNotMatch(read("src/components/editor/ProfileCompletionCard.tsx"), /profileHasCategory|metCount/);
});
test("pure layer has no I/O (no supabase, fetch, window, localStorage outside dismissals.ts)", () => {
  for (const f of fs.readdirSync(path.join(SRC, "lib/profileHealth"))) {
    if (f === "dismissals.ts" || f === "i18nParity.ts") continue;
    const s = read(`src/lib/profileHealth/${f}`).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(s, /supabase|fetch\(|window\.|localStorage|process\.env/, f);
  }
});
test("owner self-views: the page-view row is skipped only for the signed-in owner; clicks untouched", () => {
  const page = read("src/app/[username]/page.tsx").replace(/\/\/.*$/gm, "");
  assert.match(page, /const isOwner = user\?\.id === profile\.user_id/);
  assert.match(page, /isOwner\s*\?\s*Promise\.resolve\(\{ error: null \}\)\s*:\s*supabase\.from\("click_events"\)\.insert\(\{[\s\S]{0,120}target_type: "page"/);
  // the Meta page-view send and the click-tracking route are not part of this change
  assert.match(page, /pixelsEnabled\s*\?\s*sendMetaPageView/);
  assert.doesNotMatch(read("src/app/api/track/route.ts"), /isOwner/);
});
test("completion rows are at least 44px tall", () => {
  assert.match(read("src/components/editor/ProfileCompletionCard.tsx"), /rowClass = "[^"]*min-h-\[44px\]/);
});
test("Home is read-only: no insert/update/delete/rpc in the page", () => {
  assert.doesNotMatch(read("src/app/dashboard/home/page.tsx").replace(/\/\/.*$/gm, ""), /\.(insert|update|upsert|delete|rpc)\(/);
});
if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
