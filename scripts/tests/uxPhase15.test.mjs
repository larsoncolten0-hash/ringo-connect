// UX / reliability phase: Music profile, Restaurant polish and routing, restaurant dashboard, rounded default buttons, Ringo Home landing, visible-but-locked
// features, Ringo AI limits, plan buttons, deep links, notifications and category-aware button wording. Pure decisions run for real; the rest are source-level
// pins. The visual behaviour was checked in a real browser (320 / 360 / 390 / 430 / 1440, EN and FR), see the phase report.
//   Run:  node scripts/tests/uxPhase15.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (rel) => strip(read(rel));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const { CATEGORIES } = jiti(path.join(SRC, "lib/categories.ts"));

const gitOut = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }); } catch { return null; } };
const gitLines = (s) => (s === null ? null : s.split(String.fromCharCode(10)).filter(Boolean));
const PHASE_COMMIT = (gitOut(["log", "--diff-filter=A", "-1", "--format=%H", "--", "src/components/ui/PlanCta.tsx"]) || "").trim() || null;
const changed = PHASE_COMMIT
  ? gitLines(gitOut(["show", "--name-only", "--format=", PHASE_COMMIT]))
  : (gitLines(gitOut(["status", "--porcelain"])) || null)?.map((l) => l.slice(3).replace(/^"|"$/g, "")) ?? null;
function gitFile(rel) { return changed ? changed.includes(rel) : false; }

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
};
const shape = (v) => (typeof v === "function" ? "fn" : Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
const sameShape = (a, b, label) => assert.deepEqual(shape(b), shape(a), label);

// ================================================================ 1. theme: rounded by default, a saved pill is respected
await test("theme: the recommended Music and Restaurant looks default to ROUNDED buttons; no category defaults to pill", () => {
  for (const c of CATEGORIES) {
    const r = c.defaults.recommendedTheme?.buttonRadius;
    if (r) assert.notEqual(r, "pill", `${c.id} must not default to a pill`);
  }
  assert.equal(CATEGORIES.find((c) => c.id === "music_entertainment").defaults.recommendedTheme.buttonRadius, "rounded");
  assert.equal(CATEGORIES.find((c) => c.id === "restaurant_food").defaults.recommendedTheme.buttonRadius, "rounded");
});
await test("theme: an explicitly saved pill still renders as a pill, rounded is the default, square stays square", () => {
  const { getRadiusClass } = jiti(path.join(SRC, "lib/theme.ts"));
  assert.equal(getRadiusClass("pill"), "rounded-full");
  assert.equal(getRadiusClass("rounded"), "rounded-card");
  assert.equal(getRadiusClass("square"), "rounded-md");
  assert.equal(getRadiusClass(undefined), "rounded-card");
  assert.ok(code("src/components/editor/ThemeCard.tsx").includes('buttonRadius: "rounded" as ButtonRadius'), "the editor's own default is rounded");
  assert.ok(code("src/components/editor/ThemeCard.tsx").includes('["square", "rounded", "pill"]'), "pill remains a choice");
});
await test("theme: the music and restaurant hero actions and the pinned feature follow the artist's button shape instead of a fixed pill", () => {
  for (const f of ["src/components/music/MusicHeroButtons.tsx", "src/components/restaurant/RestaurantHeroButtons.tsx"]) {
    const s = code(f);
    assert.ok(s.includes("radiusClass") && /\$\{radiusClass\}/.test(s), f);
    assert.ok(!/py-3 rounded-full text-sm/.test(s), `${f}: the primary actions are no longer hard-coded pills`);
  }
  const pv = code("src/components/ProfileView.tsx");
  assert.ok(pv.includes("radiusClass={radiusClass}"));
});

// ================================================================ 2. Ringo Home is where everyone lands
const O = jiti(path.join(SRC, "lib/auth/oauthLogin.ts"));
await test("landing: every category's owner (and an unknown role) lands on Ringo Home after signing in; admins go to /admin", () => {
  assert.equal(O.DASHBOARD_HOME, "/dashboard/home");
  for (const c of CATEGORIES) assert.equal(O.resolveDestination({ role: "creator" }), "/dashboard/home", c.id);
  assert.equal(O.resolveDestination({ role: undefined }), "/dashboard/home");
  assert.equal(O.resolveDestination({ role: null }), "/dashboard/home");
  assert.equal(O.resolveDestination({ role: "admin" }), "/admin");
});
await test("landing: a team invitation and a safe next path still win; an unsafe next falls back to Home; nothing can leave the site", () => {
  const token = "abcDEF0123456789_-abcDEF0123456789_-abc";
  assert.equal(O.resolveDestination({ role: "creator", invite: token }), `/team/invite/${token}`);
  assert.equal(O.resolveDestination({ role: "creator", next: "/dashboard/shop" }), "/dashboard/shop");
  assert.equal(O.resolveDestination({ role: "creator", next: "/dashboard/restaurant/orders?x=1" }), "/dashboard/restaurant/orders?x=1");
  for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/auth/callback?x=1"]) assert.equal(O.resolveDestination({ role: "creator", next }), "/dashboard/home", next);
});
await test("landing: the password login uses the same destination rule, the sign-out bounce remembers where the person was going, the PWA opens on Home", () => {
  const login = code("src/app/auth/login/page.tsx");
  assert.ok(login.includes("resolveDestination({ role: data.role, invite, next: searchParams.get(\"next\") })"));
  assert.ok(!login.includes('"/dashboard");'), "the old hard-coded editor landing is gone");
  const mw = code("src/middleware.ts");
  assert.ok(mw.includes('url.searchParams.set("next", requested)') && mw.includes("`${path}${request.nextUrl.search}`"));
  assert.ok(code("src/app/dashboard/manifest.webmanifest/route.ts").includes('start_url: "/dashboard/home"'));
  // required onboarding is untouched: a new account still goes to the plan page first
  assert.ok(code("src/app/auth/confirmed/page.tsx").includes("/dashboard/subscription?onboarding=true"));
  // the editor stays one tap away
  assert.ok(code("src/components/dashboard/DashboardShell.tsx").includes('{ href: "/dashboard", label: t.nav.editor'));
});

// ================================================================ 3. restaurant: menu is the menu, shop is the shop
await test("restaurant routing: the shop page never redirects a restaurant to its menu; music and events keep their storefront", () => {
  const shop = code("src/app/[username]/shop/page.tsx");
  assert.ok(!shop.includes("redirect(`/r/${params.username}`)"));
  assert.ok(shop.includes("redirect(`/m/${params.username}`)"));
  assert.ok(shop.includes('profileHasCategory(profile, "restaurant_food") && profile.ordering_enabled !== false'), "restaurant shop cards resolve like the profile's cards");
  const section = code("src/components/catalog/CatalogSection.tsx");
  assert.ok(section.includes("isMusic ? `/m/${username}` : `/${username}/shop`"), "the catalogue's view-all is the shop page, never /r");
});
await test("restaurant routing: the menu section opens the menu, each dish opens its own page, the menu button says View menu (EN) / Voir le menu (FR)", () => {
  const f = code("src/components/restaurant/FeaturedMenuSection.tsx");
  assert.ok(f.includes("href={`/r/${username}`}") && f.includes("href={`/r/${username}/item/${item.id}`}"));
  assert.ok(f.includes("{t.restaurant.viewAllMenu}"));
  assert.equal(translations.en.restaurant.viewAllMenu, "View menu");
  assert.equal(translations.fr.restaurant.viewAllMenu, "Voir le menu");
  assert.ok(fs.existsSync(path.join(SRC, "app/r/[username]/item/[id]/page.tsx")), "the dish route exists");
  assert.ok(fs.existsSync(path.join(SRC, "app/[username]/shop/page.tsx")), "the shop route exists");
});
await test("restaurant hero: Order now is the filled primary and View menu the bordered secondary, both 44px, both to the menu page (no duplicate fills)", () => {
  const s = code("src/components/restaurant/RestaurantHeroButtons.tsx");
  assert.equal((s.match(/min-h-\[44px\]/g) || []).length >= 2, true);
  assert.ok(/backgroundColor: hexToRgba\(accent, 0\.08\), color: "inherit"/.test(s), "View menu is the quiet secondary");
  assert.ok(/backgroundColor: accent, color: readableOn\(accent\)/.test(s), "Order now is the filled primary");
  assert.equal((s.match(/href=\{menuHref\}/g) || []).length, 2);
});

// ================================================================ 4. category-aware default button wording
const cta = jiti(path.join(SRC, "lib/cta.ts"));
await test("cta defaults: every category names its item truthfully; unknown categories fall back to a neutral 'item'", () => {
  const expected = {
    business_ecommerce: "product", agriculture_agribusiness: "product", music_entertainment: "product", restaurant_food: "item", real_estate: "property",
    education_training: "course", events_experiences: "event", travel_hospitality: "offer", beauty_wellness: "service", health_medical: "service",
    professional_services: "service", transport_logistics: "service", construction_home_services: "service", creative_media: "service", freelancers_creators: "service",
  };
  for (const [c, noun] of Object.entries(expected)) assert.equal(cta.defaultCtaNoun(c), noun, c);
  for (const c of [null, undefined, "", "other", "not_a_category"]) assert.equal(cta.defaultCtaNoun(c), "item");
  for (const c of CATEGORIES) assert.ok(["product", "service", "property", "course", "event", "offer", "item"].includes(cta.defaultCtaNoun(c.id)), c.id);
});
await test("cta defaults: the creator's own wording always wins; a music link says Buy now; the default never promises Buy now or Book now", () => {
  const labels = { presets: translations.en.cta.labels, buyNow: "Buy Now", shopMerch: "Shop Merch", viewDetails: "View" };
  const nouns = translations.en.cta.nouns;
  const none = { label: null, destination: "none" };
  assert.equal(cta.resolveDisplayCtaLabel({ label: { kind: "custom", text: "Hire me" }, destination: "none" }, false, labels, { category: "creative_media", nouns }), "Hire me");
  assert.equal(cta.resolveDisplayCtaLabel({ label: { kind: "preset", id: "book_now" }, destination: "booking_page" }, false, labels, { category: "beauty_wellness", nouns }), "Book now");
  assert.equal(cta.resolveDisplayCtaLabel({ label: null, destination: "external" }, true, labels, { category: "music_entertainment", nouns }), "Buy Now", "music with the artist's own link");
  assert.equal(cta.resolveDisplayCtaLabel({ label: null, destination: "music_storefront" }, true, labels, { category: "music_entertainment", nouns }), "Shop Merch");
  for (const c of CATEGORIES) {
    const l = cta.resolveDisplayCtaLabel(none, false, labels, { category: c.id, nouns });
    assert.ok(!/buy now|book now|order now|get tickets/i.test(l), `${c.id}: '${l}' must not promise an action the destination does not offer`);
    assert.ok(/^View /.test(l), `${c.id}: ${l}`);
  }
  assert.equal(cta.resolveDisplayCtaLabel(none, false, labels), "View", "without defaults every existing caller keeps its original wording");
});
await test("cta defaults: the section button says Shop now where the catalogue is things you buy, otherwise it keeps the category's own name", () => {
  for (const c of ["business_ecommerce", "agriculture_agribusiness", "music_entertainment", "restaurant_food"]) assert.equal(cta.sectionCtaKind(c), "shop", c);
  for (const c of ["beauty_wellness", "real_estate", "education_training", "professional_services", "events_experiences", "travel_hospitality"]) assert.equal(cta.sectionCtaKind(c), "browse", c);
  assert.equal(cta.sectionCtaKind("anything", true), "shop", "a music profile");
  assert.ok(code("src/components/catalog/CatalogSection.tsx").includes('sectionCtaKind(category, isMusic) === "shop" ? t.cta.shopNow'));
});
await test("cta defaults: card, item page and shop page all use the same resolver call, and the new strings exist in both languages", () => {
  for (const f of ["src/components/catalog/CatalogSection.tsx", "src/components/catalog/ProductDetailView.tsx", "src/components/shop/ShopDestination.tsx"]) assert.ok(code(f).includes("nouns: t.cta.nouns"), f);
  sameShape(translations.en.cta.nouns, translations.fr.cta.nouns, "cta.nouns");
  for (const l of ["en", "fr"]) {
    assert.ok(translations[l].cta.shopNow);
    for (const v of Object.values(translations[l].cta.nouns)) assert.ok(v && v.length > 3);
  }
  assert.notEqual(translations.fr.cta.nouns.service, translations.en.cta.nouns.service);
});

// ================================================================ 5. visible-but-locked, and the backend stays the authority
const lockMod = jiti(path.join(SRC, "lib/toolkitLock.ts"));
const dec = jiti(path.join(SRC, "lib/bookkeeping/decision.ts")).decideBookkeepingAccess;
const owner = (category, extra = {}) => ({ userId: "u1", profile: { id: "p1", user_id: "u1", category, categories: [category], is_demo: false, ...extra } });
await test("locked tools: Free in an entitled category is locked (upgrade); a paid plan sees no lock; stock tracking is shops only", () => {
  const free = lockMod.decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: false });
  assert.deepEqual(free, { locked: true, inventoryLocked: true, unavailable: null, inventoryUnavailable: false });
  const freeServices = lockMod.decideToolkitLock({ ...owner("professional_services"), planEnabled: false });
  assert.deepEqual(freeServices, { locked: true, inventoryLocked: false, unavailable: null, inventoryUnavailable: true });
  const paid = lockMod.decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: true });
  assert.deepEqual(paid, { locked: false, inventoryLocked: false, unavailable: null, inventoryUnavailable: false });
  assert.equal(lockMod.decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: null }).locked, false, "an unreadable plan is never shown as locked");
});
await test("locked tools: restaurant, music, events and Other see the tools as 'not available for your business type', never as an upgrade", () => {
  const kinds = { restaurant_food: "restaurant", music_entertainment: "music", events_experiences: "events", other: "other" };
  for (const [category, kind] of Object.entries(kinds)) {
    for (const planEnabled of [false, true, null]) {
      const r = lockMod.decideToolkitLock({ ...owner(category), planEnabled });
      assert.equal(r.unavailable, kind, `${category}/${planEnabled}`);
      assert.equal(r.locked, false, "an upgrade would not unlock it, so it is never offered");
      assert.equal(r.inventoryUnavailable, true);
    }
  }
});
await test("locked tools: a visitor, a non-owner and a demo account see no tool menu at all", () => {
  for (const f of [{ userId: null, profile: owner("business_ecommerce").profile }, { userId: "u2", profile: owner("business_ecommerce").profile }, owner("business_ecommerce", { is_demo: true }), owner("restaurant_food", { is_demo: true })]) {
    assert.deepEqual(lockMod.decideToolkitLock({ ...f, planEnabled: false }), { locked: false, inventoryLocked: false, unavailable: null, inventoryUnavailable: false });
  }
});
await test("locked tools: the frontend lock agrees with the backend refusal for every category, owner, demo and plan flag (no combination is locked AND allowed)", () => {
  let combos = 0;
  for (const c of CATEGORIES) {
    for (const who of ["owner", "other", "signedOut"]) {
      for (const demo of [false, true]) {
        for (const planEnabled of [true, false, null, undefined]) {
          const userId = who === "signedOut" ? null : who === "owner" ? "u1" : "u2";
          const profile = { id: "p1", user_id: "u1", category: c.id, categories: [c.id], is_demo: demo };
          const backend = dec({ userId, profile, planEnabled });
          const lock = lockMod.decideToolkitLock({ userId, profile, planEnabled });
          assert.equal((lock.locked || !!lock.unavailable) && backend.ok, false, `locked/unavailable AND allowed: ${c.id} ${who} demo=${demo} plan=${planEnabled}`);
          if (lock.locked) assert.equal(backend.ok ? null : backend.reason, "plan_not_enabled");
          if (lock.unavailable) assert.equal(backend.ok ? null : backend.reason, "category_not_enabled");
          combos++;
        }
      }
    }
  }
  assert.ok(combos > 300, String(combos));
});
await test("locked tools: each tool's layout shows the right screen first and still runs its unchanged guard; the locked screens render no tool data", () => {
  for (const [dir, tool] of [["bookkeeping", "bookkeeping"], ["documents", "documents"], ["reports", "reports"], ["sales", "sales"]]) {
    const s = code(`src/app/dashboard/${dir}/layout.tsx`);
    assert.ok(s.includes(`<ToolkitLocked tool="${tool}" />`) && s.includes(`<ToolkitLocked tool="${tool}" unavailable={lock.unavailable} />`), dir);
    assert.ok(s.indexOf("lock.unavailable") < s.indexOf("await require"), `${dir}: the lock check is first`);
  }
  const inv = code("src/app/dashboard/inventory/layout.tsx");
  assert.ok(inv.includes('unavailable={lock.unavailable ?? "inventory"}') && inv.includes("lock.inventoryLocked"));
  const screen = code("src/components/subscription/ToolkitLocked.tsx");
  assert.ok(!/fetch\(|supabase|useEffect/.test(screen));
  assert.equal((screen.match(/sm:shrink-0 sm:whitespace-nowrap/g) || []).length, 2, "the button never shares its row so tightly that its label wraps");
  // the 'unavailable' branch is the one with no upgrade button
  const unavailableBranch = screen.slice(screen.indexOf("{unavailable ? ("), screen.indexOf(") : ("));
  assert.ok(unavailableBranch.includes("NEXT_HREF[unavailable]") && !unavailableBranch.includes("toolkitLock.cta"));
  for (const k of ["restaurant", "music", "events", "other", "inventory"]) assert.ok(fs.existsSync(path.join(SRC, "app/dashboard", { restaurant: "restaurant", music: "music", events: "tickets", other: "", inventory: "home" }[k], "page.tsx")), `next step for ${k} exists`);
  sameShape(translations.en.toolkitLock.unavailable, translations.fr.toolkitLock.unavailable, "toolkitLock.unavailable");
});
await test("locked tools: the menu keeps the five tools visible and marks them locked with the right spoken wording; staff never get the entries", () => {
  const s = code("src/components/dashboard/DashboardShell.tsx");
  assert.ok((s.match(/locked: true/g) || []).length === 5);
  assert.ok((s.match(/\((lockedToolkit \|\| unavailableToolkit)\) && !organization\?\.isStaff/g) || []).length === 3);
  assert.ok(s.includes("(lockedInventory || unavailableInventory) && !organization?.isStaff"));
  assert.ok(s.includes("category ? t.toolkitLock.unavailableLabel : t.toolkitLock.lockedLabel"));
  assert.ok(code("src/components/dashboard/MobileMoreMenu.tsx").includes("category ? t.toolkitLock.unavailableLabel : t.toolkitLock.lockedLabel"));
  assert.equal(translations.en.toolkitLock.unavailableLabel === translations.en.toolkitLock.lockedLabel, false);
});

// ================================================================ 6. Ringo AI: limits and the locked state
await test("ringo ai: no remaining-count text anywhere; the limit state is two clear choices; the strings exist in EN and FR", () => {
  const all = ["src/components/ai/RingoAiPanel.tsx", "src/components/ai/RingoAiLauncher.tsx", "src/components/ai/AiLimitCard.tsx"].map(code).join("\n");
  assert.ok(!/ringoAi\.remaining|messages left today|messages restants/.test(all));
  assert.equal("remaining" in translations.en.ringoAi, false);
  assert.equal("remaining" in translations.fr.ringoAi, false);
  sameShape(translations.en.ringoAi.limit, translations.fr.ringoAi.limit, "ringoAi.limit");
  sameShape(translations.en.ringoAi.locked, translations.fr.ringoAi.locked, "ringoAi.locked");
  assert.equal(translations.en.ringoAi.limit.dailyTitle, "Today's Ringo AI limit has been reached.");
  const card = code("src/components/ai/AiLimitCard.tsx");
  assert.equal((card.match(/min-h-\[44px\]/g) || []).length, 2, "both choices are 44px buttons");
  assert.ok(card.includes("L.increase") && card.includes("L.waitDaily") && card.includes("L.waitMonthly") && card.includes("L.waitingDaily"));
});
await test("ringo ai: the panel shows the limit card only for a real daily or monthly limit (a platform budget error keeps its plain message); image limits arrive as an event", () => {
  const panel = code("src/components/ai/RingoAiPanel.tsx");
  assert.ok(panel.includes('status.limitReason === "daily_limit" || status.limitReason === "monthly_limit"'));
  assert.ok(panel.includes("<AiLimitCard kind=\"chat\"") && panel.includes("<AiLimitCard kind=\"image\""));
  assert.ok(panel.includes('event.type === "limit" && event.kind === "image"'));
  assert.ok(panel.includes("onIncrease={talkToTeam}"), "Increase limit uses the existing Ringo team handoff");
  const orch = code("src/lib/ai/orchestrator.ts");
  assert.ok(orch.includes('{ type: "limit"; kind: "image"; reason: "daily_limit" | "monthly_limit" }'));
  assert.ok(orch.includes('call.name !== "generate_image"') && orch.includes('parsed.reason === "daily_limit" || parsed.reason === "monthly_limit"'));
});
await test("ringo ai: there is no paid top-up: nothing in the limit UI touches billing, payment, pricing or credits", () => {
  const ui = ["src/components/ai/AiLimitCard.tsx", "src/components/ai/AiLockedPanel.tsx"].map(code).join("\n");
  assert.ok(!/fetch\(|stripe|fapshi|payment|checkout|price|credit|billing/i.test(ui));
});
await test("ringo ai: a plan without Ringo AI sees it locked (discoverable); every other denial keeps it hidden; the chat API is untouched", () => {
  const status = code("src/app/api/ai/status/route.ts");
  assert.ok(status.includes('access.reason === "plan_not_eligible" ? { available: false, locked: "plan" } : { available: false }'));
  const launcher = code("src/components/ai/RingoAiLauncher.tsx");
  assert.ok(launcher.includes('data?.locked === "plan"') && launcher.includes("<AiLockedPanel"));
  const panelSrc = code("src/components/ai/AiLockedPanel.tsx");
  assert.ok(panelSrc.includes("useModalA11y") && panelSrc.includes("<PlanCta"));
  assert.ok(!code("src/app/api/ai/chat/route.ts").includes("locked"), "the chat route does not know about the locked state: it still refuses");
});

// ================================================================ 7. plan buttons are buttons
await test("plan buttons: one shared component, always bordered, 44px, with a focus ring; the old underlined / plain-text plan links are gone", () => {
  const c = code("src/components/ui/PlanCta.tsx");
  assert.ok(c.includes("min-h-[44px]") && c.includes("rounded-card border") && c.includes("focus-visible:ring-2"));
  for (const v of ["primary", "secondary", "onDark"]) assert.ok(c.includes(`${v}:`));
  assert.ok(c.includes('ringo-tactile') && c.includes("ringo-cta"));
  for (const f of ["src/components/editor/CatalogCard.tsx", "src/components/editor/LinksCard.tsx", "src/components/editor/PixelsCard.tsx", "src/components/editor/ThemeCard.tsx", "src/components/subscription/ToolkitLocked.tsx", "src/components/ai/AiLockedPanel.tsx"]) assert.ok(code(f).includes("<PlanCta"), f);
  // no link to the plan page is styled as bare text any more
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.tsx$/.test(e.name)) out.push(p); } return out; };
  for (const f of walk(path.join(SRC, "components"))) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/<(?:Link|NextLink)[^>]*href="\/dashboard\/subscription"[^>]*className="([^"]*)"/g)) assert.ok(!/\bunderline\b/.test(m[1]) && !/^text-xs font-medium text-ringo-indigo$/.test(m[1]), `${path.relative(REPO, f)}: ${m[1]}`);
  }
});
await test("plan buttons: the renew banners and the upgrade card use bordered chips; the banner text is translated (EN/FR)", () => {
  const s = code("src/components/dashboard/DashboardShell.tsx");
  assert.ok(!/underline underline-offset-2[^<]*>(Renew|Resubscribe to Pro|\{t\.sidebar\.upgradePlan\})/.test(s));
  assert.equal((s.match(/rounded-card border border-current/g) || []).length, 2);
  assert.ok(s.includes("rounded-card border border-white/80"));
  assert.ok(s.includes("t.subscriptionBanner.expired(") && s.includes("t.subscriptionBanner.hidden(") && s.includes("t.subscriptionBanner.renew"));
  assert.ok(!/Your subscription (has expired|expires)/.test(s), "no English-only banner text is left in the shell");
  sameShape(translations.en.subscriptionBanner, translations.fr.subscriptionBanner, "subscriptionBanner");
  assert.equal(translations.en.subscriptionBanner.expired(1), "Your subscription has expired. Renew within 1 day to keep your access.");
  assert.equal(translations.fr.subscriptionBanner.hidden(1, 2), "1 lien et 2 produits sont masqués de votre profil public à cause de votre forfait actuel. Vos données sont en sécurité et rien n'a été supprimé.");
});

// ================================================================ 8. deep links
await test("deep links: upgrading from a locked screen returns the person to it, validated; a signed-out link is remembered; nothing can leave the dashboard", () => {
  const cta2 = code("src/components/ui/PlanCta.tsx");
  assert.ok(cta2.includes("?from=${encodeURIComponent(pathname)}") && cta2.includes("!pathname.startsWith(PLAN_HREF)"));
  const page = code("src/app/dashboard/subscription/page.tsx");
  assert.ok(page.includes("safeNextPath(searchParams.from)") && page.includes('from.startsWith("/dashboard")') && page.includes('!from.startsWith("/dashboard/subscription")'));
  const view = code("src/components/subscription/SubscriptionView.tsx");
  assert.ok(view.includes("router.push(returnTo)") && view.includes("t.subscription.backToWork"));
  const accept = (from) => { const f = O.safeNextPath(from); return f && f.startsWith("/dashboard") && !f.startsWith("/dashboard/subscription") ? f : null; };
  assert.equal(accept("/dashboard/inventory"), "/dashboard/inventory");
  for (const bad of ["//evil.com", "https://evil.com", "/admin", "/dashboard/subscription", "/\\x", undefined, ""]) assert.equal(accept(bad), null, String(bad));
  sameShape({ a: translations.en.subscription.backToWork }, { a: translations.fr.subscription.backToWork }, "backToWork");
});
await test("deep links: the music profile opens the store's own sections (View events goes to Tickets); every notification link in the code resolves to a real page", () => {
  assert.ok(code("src/components/music/EventsSection.tsx").includes("href={`/m/${username}#tickets`}"));
  const store = code("src/components/music/MusicStorePage.tsx");
  assert.ok(store.includes('id="tickets"') && store.includes('id="merch"'));
  // every in-app / push link literal written by the code maps to a page route (route groups like (app) are not part of the URL)
  const pages = [];
  const walkPages = (dir, rel = "") => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walkPages(path.join(dir, e.name), `${rel}/${e.name}`); else if (e.name === "page.tsx") pages.push(rel || "/"); } };
  walkPages(path.join(SRC, "app"));
  const toRe = (p) => new RegExp("^/" + p.split("/").filter((s) => s && !/^\(.*\)$/.test(s)).map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "$");
  const res = pages.map(toRe);
  const lits = new Set();
  const walkSrc = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkSrc(p); else if (/\.(ts|tsx)$/.test(e.name) && !p.includes("translations")) { const s = fs.readFileSync(p, "utf8"); for (const m of s.matchAll(/(?:link|url)\s*:\s*[`"'](\/[^`"']*)[`"']/g)) lits.add(m[1]); for (const m of s.matchAll(/withArrivalRef\(\s*`([^`]*)`/g)) lits.add(m[1]); } } };
  walkSrc(SRC);
  const dead = [...lits].map((l) => l.replace(/\$\{[^}]*\}/g, "X").split("?")[0].split("#")[0].replace(/\/$/, "") || "/").filter((p) => !/\.(png|jpg|svg|ico)$/.test(p) && !res.some((r) => r.test(p)));
  assert.deepEqual(dead, [], "links with no page: " + dead.join(", "));
  assert.ok(lits.size > 30);
});

// ================================================================ 9. notifications
const push = jiti(path.join(SRC, "lib/push/subscribeClient.ts"));
const fakeStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), raw: m }; };
await test("push: a replacement notification still alerts (renotify with its tag), and only when there is a tag", () => {
  const sw = read("public/pwa-sw.js");
  assert.ok(sw.includes("...(payload.category ? { renotify: true } : {})"));
  assert.ok(sw.includes("tag: payload.category"));
  assert.ok(sw.indexOf("renotify") > sw.indexOf("tag: payload.category"));
});
await test("push: signing out removes this device's subscription from the account and remembers it, so the next person does not receive it", () => {
  const out = code("src/app/auth/logout/page.tsx");
  assert.ok(out.includes('unsubscribeFromPush("/api/push/unsubscribe")') && out.includes("rememberPushResume(user.id)"));
  assert.ok(out.indexOf("unsubscribeFromPush(") < out.indexOf("await supabase.auth.signOut()"), "before the session ends");
  assert.ok(/\} catch \{\s*\}\s*await supabase\.auth\.signOut\(\)/.test(out), "a failure never blocks signing out");
});
await test("push: the SAME account turns push back on silently when it signs in again; another account, a device that is already subscribed, or a withdrawn permission never does", async () => {
  const mk = (stored, status, calls) => ({ storage: fakeStore(stored ? { [push.PUSH_RESUME_KEY]: stored } : {}), getStatus: async () => status, subscribe: async (o) => { calls.push(o); return { ok: true }; } });
  const granted = { supported: true, permission: "granted", subscribed: false };
  let calls = [];
  let deps = mk("u1", granted, calls);
  assert.equal(await push.resumePushIfRemembered("u1", "/api/push/subscribe", deps), true);
  assert.equal(calls.length, 1);
  assert.equal(deps.storage.getItem(push.PUSH_RESUME_KEY), null, "the memory is spent");
  calls = []; deps = mk("u1", granted, calls);
  assert.equal(await push.resumePushIfRemembered("u2", "/api/push/subscribe", deps), false, "a different account");
  assert.equal(calls.length, 0);
  assert.equal(deps.storage.getItem(push.PUSH_RESUME_KEY), "u1", "and it does not erase the other account's memory");
  calls = []; deps = mk("u1", { ...granted, subscribed: true }, calls);
  assert.equal(await push.resumePushIfRemembered("u1", "/api/push/subscribe", deps), false, "already subscribed (to whoever enabled it)");
  assert.equal(calls.length, 0);
  calls = []; deps = mk("u1", { supported: true, permission: "denied", subscribed: false }, calls);
  assert.equal(await push.resumePushIfRemembered("u1", "/api/push/subscribe", deps), false, "permission withdrawn");
  assert.equal(calls.length, 0);
  calls = []; deps = mk(null, granted, calls);
  assert.equal(await push.resumePushIfRemembered("u1", "/api/push/subscribe", deps), false, "nothing was remembered");
  deps = { storage: { getItem() { throw new Error("blocked"); }, removeItem() {} }, getStatus: async () => granted, subscribe: async () => ({ ok: true }) };
  assert.equal(await push.resumePushIfRemembered("u1", "/api/push/subscribe", deps), false, "blocked storage never throws");
  for (const shell of ["src/components/dashboard/DashboardShell.tsx", "src/components/admin/AdminShell.tsx"]) assert.ok(code(shell).includes('<PushResume subscribeUrl="/api/push/subscribe" />'), shell);
});
await test("bell: Mark all read clears every unread row of the audience (not just the loaded 30); hidden tabs do not poll; every string of the bell's OWN interface is translated (not the stored notification text, see the locale audit below); 44px targets", () => {
  const bell = code("src/components/NotificationBell.tsx");
  const markAll = bell.slice(bell.indexOf("const markAllRead = async"), bell.indexOf("// No account to key"));
  assert.ok(markAll.includes('.update({ read_at: now }).is("read_at", null)') && !markAll.includes(".in(\"id\""), "audience-wide, not by loaded ids");
  assert.ok(markAll.includes('eq("audience", "admin")') && markAll.includes('eq("user_id", userId as string)'), "scoped to this audience / this person");
  assert.equal((bell.match(/document\.visibilityState !== "hidden"/g) || []).length, 2);
  assert.ok(bell.includes('addEventListener("visibilitychange"'));
  assert.ok(!/>\s*(Mark all read|Notifications|No notifications yet|All|Unread)\s*</.test(bell) && !bell.includes('"You\'re all caught up."'));
  assert.ok(bell.includes("t.notificationCenter.bellLabel(unreadCount)") && bell.includes("relativeTime(n.created_at, t.notificationCenter)"));
  assert.ok((bell.match(/min-h-\[44px\]/g) || []).length >= 3 && bell.includes("relative w-11 h-11"), "the bell trigger, Mark all read and the filter chips are 44px");
  sameShape(translations.en.notificationCenter, translations.fr.notificationCenter, "notificationCenter");
  assert.equal(translations.fr.notificationCenter.bellLabel(3), "Notifications, 3 non lues");
  assert.equal(translations.en.notificationCenter.bellLabel(120), "Notifications, 99+ unread");
});
await test("notifications: recipients stay isolated (a person only reads their own rows), duplicates are still prevented, deleted-endpoint cleanup and one-endpoint-one-owner remain", () => {
  const bell = code("src/components/NotificationBell.tsx");
  assert.ok(bell.includes('query.eq("audience", "user").eq("user_id", userId as string)'));
  assert.ok(code("src/lib/applyPayment.ts").includes("adminBell: !wasOnFreePlan"), "one payment is one admin notification");
  assert.ok(code("src/lib/push/send.ts").includes('.from("push_subscriptions").delete().in("id", goneIds)'));
  assert.ok(code("src/app/api/push/subscribe/route.ts").includes('{ onConflict: "endpoint" }'));
  assert.ok(code("src/app/api/orders/route.ts").includes('getOrgNotificationAudience(profile.id, ["orders.view", "kitchen.view"])'), "new-order recipients are the owner and permitted staff");
});

// ---- notification audit: what is and is NOT localized (pinned, so "the bell is fully EN/FR" can never be claimed by accident)
await test("notification locale audit: rows persist FINAL text with no locale column; only two writers pick the language, every other writer is English-only", () => {
  const sql = read("supabase/migrations/2026-09-12_notifications.sql");
  const table = sql.slice(sql.indexOf("create table if not exists notifications"), sql.indexOf("create index"));
  assert.ok(/title text not null/.test(table) && !/locale|language/i.test(table), "the table stores final title/body text and no locale");
  assert.ok(!/locale/.test(code("src/lib/notifications.ts")) && !/locale/.test(code("src/lib/push/withBell.ts")), "neither writer helper knows a language");
  // the only writers that choose a language: the content calendar (its plan's locale) and invoice reminders (the document's locale)
  assert.ok(code("src/app/api/cron/content-calendar-reminders/route.ts").includes("translations[locale].ringoAi.calendar"));
  assert.ok(code("src/lib/receivables/cron.ts").includes("overdueAlertText("));
  // a representative English-only writer: the subscription lifecycle text is a literal in the cron
  assert.ok(code("src/app/api/cron/downgrade-expired/route.ts").includes('title: "Your subscription is expiring soon"'));
  // the bell shows the stored text as written; it does not translate it
  assert.ok(code("src/components/NotificationBell.tsx").includes("{n.title}"));
});
await test("notification locale audit: no per-user language exists server-side (language is browser storage only), so a recipient's language cannot be derived at write time", () => {
  assert.ok(code("src/lib/i18n/locales.ts").includes("localStorage key the whole app already uses") || read("src/lib/i18n/locales.ts").includes("localStorage key the whole app already uses"));
  for (const f of fs.readdirSync(path.join(REPO, "supabase/migrations"))) {
    if (!/\.sql$/.test(f)) continue;
    const t = read(`supabase/migrations/${f}`).replace(/--.*$/gm, "");
    assert.ok(!/(alter table (public\.)?(users|profiles)[^;]*add column[^;]*(locale|language|preferred_lang)\w*)/i.test(t), `${f}: a per-user language column would change this finding`);
  }
});
await test("push click: opens the payload's page; focuses the tab already on it, else reuses an open tab, else opens a window; resolved against the site origin", () => {
  const sw = read("public/pwa-sw.js");
  const click = sw.slice(sw.indexOf('addEventListener("notificationclick"'));
  assert.ok(click.includes("event.notification.close()") && click.includes('new URL(event.notification.data?.url || "/", self.location.origin).href'));
  assert.ok(click.indexOf("client.url === url") < click.indexOf("existing.navigate(url)") && click.indexOf("existing.navigate(url)") < click.indexOf("self.clients.openWindow(url)"));
  assert.ok(sw.includes("data: { url:") || /data:\s*\{[^}]*url/.test(sw), "the payload URL is carried in the notification data");
});
await test("notification links: every builder in notificationLinks.ts produces a root-relative dashboard / site path (no absolute or external URL)", () => {
  const src = code("src/lib/notificationLinks.ts");
  const paths = [...src.matchAll(/withArrivalRef\(\s*`([^`]*)`/g)].map((m) => m[1]).concat([...src.matchAll(/return\s+`(\/[^`]*)`/g)].map((m) => m[1]));
  assert.ok(paths.length >= 5, String(paths.length));
  for (const p of paths) assert.ok(p.startsWith("/") && !p.startsWith("//"), p);
});

// ================================================================ 10. the Music profile
const { pickLatestRelease } = jiti(path.join(SRC, "lib/latestRelease.ts"));
await test("music: the latest release is the newest REAL release or single; tracks inside an EP, unavailable items and nothing at all never produce a card", () => {
  const rel = (id, at, extra = {}) => ({ id, created_at: at, title: id, release_type: "ep", ...extra });
  const trk = (id, at, extra = {}) => ({ id, created_at: at, title: id, ...extra });
  assert.equal(pickLatestRelease([], []), null);
  assert.equal(pickLatestRelease(null, undefined), null);
  const a = pickLatestRelease([rel("r-old", "2026-01-01"), rel("r-new", "2026-05-01")], [trk("t-mid", "2026-03-01")]);
  assert.deepEqual([a.kind, a.item.id], ["release", "r-new"]);
  const b = pickLatestRelease([rel("r-old", "2026-01-01")], [trk("t-new", "2026-06-01")]);
  assert.deepEqual([b.kind, b.item.id], ["track", "t-new"], "a newer single leads");
  const c = pickLatestRelease([rel("r1", "2026-01-01")], [trk("in-ep", "2026-09-01", { release_id: "r1" })]);
  assert.equal(c.item.id, "r1", "a track that belongs to an EP is not a candidate on its own");
  assert.equal(pickLatestRelease([rel("hidden", "2026-09-01", { available: false })], [trk("gone", "2026-09-02", { available: false })]), null);
  const d = pickLatestRelease([rel("x", undefined, { sort_order: 2 }), rel("y", undefined, { sort_order: 1 })], []);
  assert.equal(d.item.id, "y", "no dates: the creator's own order decides");
});
await test("music: the page leads with the artist's pin when there is one, otherwise the latest release; the emoji is replaced by a role label; the order is curated", () => {
  const pv = code("src/components/ProfileView.tsx");
  assert.ok(pv.includes("isMusic && !pinnedItem && !showPinnedSupport ? pickLatestRelease(releases, musicTracks) : null"));
  assert.ok(pv.includes("{latestRelease && stage.player && (") && pv.includes("<LatestReleaseFeature"));
  assert.ok(!pv.includes("🎵") && pv.includes("getMusicRole(profile.music_role)!.label[locale]"));
  const { orderPublicSections } = jiti(path.join(SRC, "lib/sectionOrder.ts"));
  const ALL = { about: true, links: true, catalog: true, events: true };
  assert.deepEqual(orderPublicSections({ category: "music_entertainment", isMusic: true, isRestaurant: false }, ALL), ["music", "releases", "catalog", "events", "links", "about"]);
  assert.deepEqual(orderPublicSections({ category: "restaurant_food", isMusic: false, isRestaurant: true }, ALL), ["about", "links", "catalog", "events"], "restaurant keeps its order");
  const stage = jiti(path.join(SRC, "lib/profileStage.ts")).getProfileStage("music_entertainment");
  assert.deepEqual([stage.cover, stage.name, stage.headings], ["tall", "natural", "editorial"]);
  assert.ok(stage.panel && stage.player && stage.avatar === "ring", "the existing Paper panel, Ink player and Ring stay");
});
await test("music: the feature is made of existing parts: Buy now goes to the release's own page, the preview toggle is the page's, colors are the stage's tokens, nothing loops", () => {
  const f = code("src/components/music/LatestReleaseFeature.tsx");
  assert.ok(f.includes("`/m/${username}/release/${item.id}`") && f.includes("`/m/${username}/track/${item.id}`"));
  assert.ok(f.includes("onTogglePlay(item)") && f.includes("item.protected_audio_path ? item.preview_audio_url : item.audio_url"));
  assert.ok(f.includes("player.background") && f.includes("t.music.buyNowLabel") && f.includes("t.music.viewRelease"));
  assert.ok(!/infinite|animate-(pulse|bounce|spin|ping)|useScroll|useTransform|scale-\[|perspective/.test(f), "no looping or scroll-linked motion");
  assert.ok(f.includes("min-h-[44px]") && f.includes("h-11 w-11"));
  const s = code("src/components/music/MusicStoreEntry.tsx");
  assert.ok(s.includes("`/m/${username}`") && s.includes("min-h-[44px]") && s.includes("if (parts.length === 0) return null;"));
  sameShape(Object.fromEntries(["latestRelease", "typeSingle", "typeEp", "typeAlbum", "viewRelease", "storeTitle", "storeBody", "storeCta", "storeCountSongs", "storeCountReleases", "storeCountMerch", "storeCountEvents"].map((k) => [k, translations.en.music[k]])),
    Object.fromEntries(["latestRelease", "typeSingle", "typeEp", "typeAlbum", "viewRelease", "storeTitle", "storeBody", "storeCta", "storeCountSongs", "storeCountReleases", "storeCountMerch", "storeCountEvents"].map((k) => [k, translations.fr.music[k]])), "music feature strings");
  assert.equal(translations.fr.music.storeCountSongs(2), "2 titres");
  assert.equal(translations.en.music.storeCountSongs(1), "1 song");
  assert.notEqual(translations.en.music.latestRelease, translations.en.music.spotlightBadge, "the new label is distinct from the artist's pinned 'Featured' badge");
});
await test("music: the rail stays still (no snap, no transforms) and the commerce destinations keep their routes", () => {
  const css = read("src/app/globals.css");
  const rail = css.slice(css.indexOf(".ringo-rail {"), css.indexOf(".ringo-rail-wrap {"));
  assert.ok(!/scroll-snap/.test(rail) && /touch-action: pan-x pan-y pinch-zoom/.test(rail));
  assert.ok(code("src/components/music/ReleasesSection.tsx").includes("`/m/${username}/release/${release.id}`"));
  for (const d of ["m/[username]/page.tsx", "m/[username]/[type]/[id]/page.tsx", "m/[username]/receipt", "m/[username]/ticket-pass"]) assert.ok(fs.existsSync(path.join(SRC, "app", d)), d);
});

// ================================================================ 11. restaurant dashboard
await test("restaurant dashboard: the overview reads in parallel, in the restaurant's own day, and its top-selling lookup can no longer overflow a request URL; a failed read is said, not shown as zero", () => {
  const p = code("src/app/dashboard/restaurant/page.tsx");
  assert.ok(/await Promise\.all\(\[\s*supabase\s*\.from\("orders"\)/.test(p), "the three independent reads run together");
  assert.ok(p.includes("todayKeyOf(new Date())") && p.includes("T00:00:00+01:00"), "the restaurant's day (Africa/Douala)");
  assert.ok(p.includes("const CHUNK = 100") && p.includes("TOP_SELLING_ORDER_CAP = 1000") && p.includes("ids.slice(i, i + CHUNK)"));
  assert.ok(!/\.in\(\s*"order_id",\s*recentOrderIds/.test(p), "the single giant in() is gone");
  assert.ok(p.includes("loadFailed={!!(todays.error || recent.error || recentIds.error || topFailed)}"));
  const v = code("src/components/restaurant/RestaurantOverview.tsx");
  assert.ok(v.includes("t.restaurant.overviewLoadFailed") && v.includes("t.restaurant.orderStatus[o.status] ?? o.status") && v.includes("menuHref={menuHref}") === false);
  assert.ok(v.includes("href={menuHref}") && v.includes("min-h-[44px]"));
});
await test("restaurant dashboard: a status change survives the poll, a refused change is restored with a notice, hidden tabs do not poll, filters are 44px and translated", () => {
  const o = code("src/components/restaurant/RestaurantOrdersView.tsx");
  assert.ok(o.includes("const pending = useRef(new Map<string, string>())") && o.includes("pending.current.has(o.id) ? { ...o, status: pending.current.get(o.id) } : o"));
  assert.ok(o.includes("if (!res.ok) throw new Error(") && o.includes("setError(t.restaurant.orderUpdateFailed)") && o.includes("status: previous"));
  assert.ok(o.includes('document.visibilityState === "hidden") return') && o.includes('addEventListener("visibilitychange"'));
  assert.ok(o.includes("min-h-[44px]") && o.includes("aria-pressed={filter === f}") && o.includes("t.restaurant.orderStatus[f]"));
  assert.ok(!/\{order\.status\}/.test(o), "no raw English status");
  assert.ok(code("src/components/restaurant/KitchenView.tsx").includes('document.visibilityState === "hidden") return'));
  sameShape(translations.en.restaurant.orderStatus, translations.fr.restaurant.orderStatus, "orderStatus");
  for (const k of ["noOrdersHint", "viewMyMenu", "overviewLoadFailed", "orderUpdateFailed", "allOrders"]) assert.ok(translations.en.restaurant[k] && translations.fr.restaurant[k] && translations.fr.restaurant[k] !== translations.en.restaurant[k], k);
  // the customer-facing ordering flow and its API are not part of this change
  for (const f of ["src/components/restaurant/RestaurantOrderPage.tsx", "src/app/api/orders/route.ts", "src/app/api/orders/[id]/status/route.ts"]) assert.equal(gitFile(f), false, `${f} must be unchanged`);
});

// ================================================================ 12. scope

await test("scope: no payment, Fapshi, Stripe, webhook, commission, payout, RLS, migration, package, env or cron file changed; the customer ordering and music purchase code is untouched", () => {
  if (changed === null) return;
  const bad = changed.filter(
    (f) => !/^scripts\/tests\//.test(f) && /package(-lock)?\.json|\.env|next\.config|vercel\.json|^supabase\/|^src\/app\/api\/(billing|cron|webhook|integrations|orders|music|bookings|loyalty|inbox|products|shop|protection|ambassador|affiliate|payments)|^src\/lib\/(applyPayment|fapshi|productCheckout|bookkeeping|documents|sales|inventory|receivables|reports|loyalty|inbox|whatsapp|protection|music)|checkout|payout|commission/i.test(f)
  );
  assert.deepEqual(bad, []);
});

console.log(`uxPhase15: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
