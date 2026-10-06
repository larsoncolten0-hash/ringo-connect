// Phase 14: the still product rail, the dedicated shop / services page, the preview scroll fix and the locked (upgrade) state of the paid business
// tools for a Free plan. Pure decisions and source-level pins; the visual behaviour was verified in a real browser (320 / 390 / 430 / 1440, EN + FR).
//   Run:  node scripts/tests/phase14.test.mjs
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

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
};

// ---------------------------------------------------------------- 1. the lock decision (pure)
const decisionSrc = code("src/lib/toolkitLock.ts");
test("lock: the module reads only the plan flag and grants nothing", () => {
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(decisionSrc), "no write or rpc");
  assert.match(decisionSrc, /planEnabled !== false\) return OPEN/);
});
let decideToolkitLock;
try {
  ({ decideToolkitLock } = jiti(path.join(SRC, "lib/toolkitLock.ts")));
} catch (e) {
  failures.push("lock: module did not load: " + e.message);
}
if (decideToolkitLock) {
  const owner = (category, extra = {}) => ({ userId: "u1", profile: { id: "p1", user_id: "u1", category, categories: [category], is_demo: false, ...extra } });
  test("lock: a Free owner in an entitled category is locked; Inventory only where stock tracking exists", () => {
    assert.deepEqual(decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: false }), { locked: true, inventoryLocked: true });
    assert.deepEqual(decideToolkitLock({ ...owner("professional_services"), planEnabled: false }), { locked: true, inventoryLocked: false });
  });
  test("lock: a plan WITH the toolkit, or an unreadable plan, is never shown as locked", () => {
    assert.equal(decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: true }).locked, false);
    assert.equal(decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: null }).locked, false);
    assert.equal(decideToolkitLock({ ...owner("business_ecommerce"), planEnabled: undefined }).locked, false);
  });
  test("lock: not the owner, a demo profile, a signed-out visitor or a category without the tools see no locked entry", () => {
    assert.equal(decideToolkitLock({ userId: "u2", profile: owner("business_ecommerce").profile, planEnabled: false }).locked, false);
    assert.equal(decideToolkitLock({ ...owner("business_ecommerce", { is_demo: true }), planEnabled: false }).locked, false);
    assert.equal(decideToolkitLock({ userId: null, profile: owner("business_ecommerce").profile, planEnabled: false }).locked, false);
    for (const c of ["restaurant_food", "music_entertainment", "events_experiences", "other"]) assert.equal(decideToolkitLock({ ...owner(c), planEnabled: false }).locked, false, c);
  });
}

// ---------------------------------------------------------------- 1b. the frontend lock and the backend authorization agree
// The API routes and the database functions decide with decideBookkeepingAccess (and, in SQL, plans.business_toolkit_enabled). The lock screen is
// shown only where that decision's ONLY reason to refuse is the plan: so a locked owner is always refused by the backend, an unlocked paid owner is
// always allowed, and no combination is both "locked" and "allowed".
let decide, CATEGORY_IDS;
try {
  ({ decideBookkeepingAccess: decide } = jiti(path.join(SRC, "lib/bookkeeping/decision.ts")));
  CATEGORY_IDS = jiti(path.join(SRC, "lib/categories.ts")).CATEGORIES.map((c) => c.id);
} catch (e) {
  failures.push("agreement: modules did not load: " + e.message);
}
if (decide && decideToolkitLock) {
  test("agreement: across every category, owner / non-owner / demo and every plan flag, lock <=> the backend refuses for the plan only", () => {
    let combos = 0;
    for (const category of CATEGORY_IDS) {
      for (const who of ["owner", "other", "signedOut"]) {
        for (const demo of [false, true]) {
          for (const planEnabled of [true, false, null, undefined]) {
            const userId = who === "signedOut" ? null : who === "owner" ? "u1" : "u2";
            const profile = { id: "p1", user_id: "u1", category, categories: [category], is_demo: demo };
            const backend = decide({ userId, profile, planEnabled });
            const lock = decideToolkitLock({ userId, profile, planEnabled });
            const reason = backend.ok ? null : backend.reason;
            assert.equal(lock.locked && backend.ok, false, `locked AND allowed: ${category} ${who} demo=${demo} plan=${planEnabled}`);
            if (lock.locked) {
              assert.equal(reason, "plan_not_enabled", `locked but the backend refuses for ${reason}`);
              assert.equal(planEnabled, false);
            }
            // a definite "no plan flag" on an otherwise entitled owner is exactly what locks
            const otherwiseEntitled = decide({ userId, profile, planEnabled: true }).ok;
            assert.equal(lock.locked, otherwiseEntitled && planEnabled === false, `${category} ${who} demo=${demo} plan=${planEnabled}`);
            if (planEnabled === true && otherwiseEntitled) assert.equal(backend.ok, true);
            combos++;
          }
        }
      }
    }
    assert.ok(combos > 300, "the grid is not trivially small: " + combos);
  });
}
test("agreement: the lock only ever renders a screen, so the unchanged API guards and database checks remain the authority", () => {
  let touched;
  try { touched = execFileSync("git", ["show", "--name-only", "--format=", "84bdfea"], { cwd: REPO, encoding: "utf8" }).split(String.fromCharCode(10)).filter(Boolean); } catch { return; }
  for (const f of ["src/lib/bookkeeping/access.ts", "src/lib/bookkeeping/decision.ts", "src/lib/inventory/access.ts", "src/lib/documents/access.ts", "src/lib/reports/access.ts", "src/lib/sales/access.ts", "src/lib/documents/routeKit.ts"]) assert.ok(!touched.includes(f), `${f} must be unchanged`);
  assert.ok(!touched.some((f) => f.startsWith("src/app/api/") || f.startsWith("supabase/")), "no API route or SQL changed");
});

// ---------------------------------------------------------------- 2. the tool pages
for (const [dir, guard] of [["inventory", "requireInventoryOwner"], ["bookkeeping", "requireReportsOwner"], ["sales", "requireSalesOwner"], ["reports", "requireReportsOwner"], ["documents", "requireDocumentsOwner"]]) {
  test(`${dir}: a locked owner gets the upgrade screen and the tool is never rendered; the existing guard still runs for everyone else`, () => {
    const s = code(`src/app/dashboard/${dir}/layout.tsx`);
    assert.ok(s.includes(`<ToolkitLocked tool="${dir}" />`));
    assert.ok(s.indexOf("ToolkitLocked tool") < s.indexOf(`await ${guard}()`), "lock check comes first");
    assert.ok(s.includes(`await ${guard}()`) && s.includes("{children}"), "the unchanged guard and children remain");
    const lockLine = s.split("\n").find((l) => l.includes("ToolkitLocked tool"));
    assert.ok(!lockLine.includes("children"), "children are not rendered on the locked branch");
  });
}
test("locked screen: one upgrade call to action to the existing subscription page, no data, translated, 44px", () => {
  const s = code("src/components/subscription/ToolkitLocked.tsx");
  assert.ok(s.includes('href="/dashboard/subscription"'));
  assert.ok(!/fetch\(|supabase|useEffect/.test(s));
  assert.ok(s.includes("min-h-[44px]"));
  assert.ok(s.includes("t.toolkitLock.cta"));
});
test("menu: the five tools stay in the menu for a Free owner, marked locked and named for assistive technology; never added for staff", () => {
  const s = code("src/components/dashboard/DashboardShell.tsx");
  assert.equal((s.match(/locked: true/g) || []).length, 5);
  assert.ok((s.match(/locked(Toolkit|Inventory) && !organization\?\.isStaff/g) || []).length >= 4);
  assert.ok(s.includes("t.toolkitLock.lockedLabel"));
});

// ---------------------------------------------------------------- 3. translations: both languages, same shape
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const shape = (v) => (typeof v === "function" ? "fn" : Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
for (const group of ["shopPage", "toolkitLock"]) {
  test(`i18n: ${group} exists in English and French with the same keys and no empty text`, () => {
    assert.deepEqual(shape(translations.fr[group]), shape(translations.en[group]));
    const walk = (v) => (typeof v === "string" ? assert.ok(v.trim() !== "") : v && typeof v === "object" && Object.values(v).forEach(walk));
    walk(translations.en[group]);
    walk(translations.fr[group]);
  });
}
test("i18n: every locked tool has a headline, a body and three points in both languages, and French differs from English", () => {
  for (const tool of ["sales", "inventory", "documents", "bookkeeping", "reports"]) {
    for (const l of ["en", "fr"]) {
      const c = translations[l].toolkitLock.tools[tool];
      assert.ok(c.headline && c.body && c.points.length === 3, `${l}.${tool}`);
    }
    assert.notEqual(translations.fr.toolkitLock.tools[tool].headline, translations.en.toolkitLock.tools[tool].headline);
  }
});

// ---------------------------------------------------------------- 4. the rail holds still
test("rail: native scrolling only: no snap, no transform, no scroll-linked motion in the rail or its cards", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf(".ringo-rail {"), css.indexOf(".ringo-rail-wrap {"));
  assert.ok(!/scroll-snap/.test(block), "no scroll snapping");
  assert.ok(block.includes("touch-action: pan-x pan-y pinch-zoom"));
  assert.match(block, /\.ringo-rail \.ringo-lift:active[\s\S]*transform: none/);
  const rail = code("src/components/ui/Rail.tsx");
  assert.ok(!/scale|rotate|perspective|parallax|useScroll|useTransform|zoom/i.test(rail), "Rail has no transform logic");
  assert.ok(rail.includes("requestAnimationFrame"));
});
test("rail: cards in a rail do not fade up on entry, zoom their photo or lift their button", () => {
  const s = read("src/components/catalog/CatalogSection.tsx");
  assert.ok(s.includes("reduceMotion || inRail"));
  assert.ok(s.includes('inRail ? "" : "transition-transform duration-700'));
  assert.ok(s.includes('inRail ? "" : "transition-transform duration-300'));
});
test('profile: the section no longer expands in place; "view all" is a link to the dedicated page (music keeps its storefront)', () => {
  const s = code("src/components/catalog/CatalogSection.tsx");
  assert.ok(!/setExpanded|expanded|setShown|showMoreItems/.test(s));
  assert.ok(s.includes("isMusic ? `/m/${username}` : `/${username}/shop`"));
  assert.ok(s.includes("slice(0, 8)"), "the preview is the first eight");
});

// ---------------------------------------------------------------- 5. the shop page
test("shop route: read only, same visibility and plan limit as the profile, other storefronts keep their own page", () => {
  const s = code("src/app/[username]/shop/page.tsx");
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(s));
  assert.ok(s.includes('eq("published", true)'));
  assert.ok(s.includes("isPublicProfileSuspended"));
  assert.match(s, /limitPublicRows<any>\(profile\.products, isPublicProduct, .*max_products/);
  assert.ok(s.includes("redirect(`/m/${params.username}`)"));
  assert.ok(s.includes("redirect(`/r/${params.username}`)"));
  assert.ok(!/facebook_capi_token|tiktok_events_token/.test(s), "no private column is passed to the client");
});
test("shop page: only existing item actions (the same CTA resolver and item page), words from the category, no data access", () => {
  const s = code("src/components/shop/ShopDestination.tsx");
  assert.ok(s.includes("resolveProductCta"));
  assert.ok(s.includes("productHref(username, product.id, false)"));
  assert.ok(s.includes("catalogLabel"));
  assert.ok(!/fetch\(|supabase|\/api\//.test(s));
  const small = [...s.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => n < 44 && n !== 160 && n !== 146);
  assert.deepEqual(small, []);
});

// ---------------------------------------------------------------- 5b. reduced motion (shared stylesheet, not one-off patches)
test("reduced motion: the shared stylesheet stills entrance animation and hover / press movement, in one place", () => {
  const css = read("src/app/globals.css");
  const reduced = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join(" ");
  assert.ok(/\.animate-fade-up/.test(reduced) && /animation: none !important/.test(reduced));
  assert.ok(reduced.includes('[class*="hover:-translate-"]:hover') && reduced.includes('[class*="active:scale-"]:active') && reduced.includes('[class*="group-hover:scale-"]'));
  assert.ok(/\.transition-transform \{\s*transition: none !important;/.test(reduced));
  assert.ok(!/infinite/.test(read("src/components/shop/ShopDestination.tsx") + read("src/components/subscription/ToolkitLocked.tsx") + read("src/components/ui/Rail.tsx")), "no looping animation on the new surfaces");
});

// ---------------------------------------------------------------- 6. the preview scroll
test("preview sheet: the clipped profile wrapper cannot be squeezed by the flex column (shrink-0)", () => {
  assert.ok(read("src/components/editor/LivePreviewPanel.tsx").includes("w-full max-w-sm shrink-0 rounded-2xl overflow-hidden"));
});

// ---------------------------------------------------------------- 7. scope
// Pinned to the Phase 14 COMMIT, not the working tree, so later phases do not trip it (same convention as the other finished phases).
const PHASE14_COMMIT = "84bdfea";
const changed = (() => {
  try {
    return execFileSync("git", ["show", "--name-only", "--format=", PHASE14_COMMIT], { cwd: REPO, encoding: "utf8" }).split(String.fromCharCode(10)).filter(Boolean);
  } catch {
    return null; // commit not present (a shallow clone): nothing to compare
  }
})();
test("scope: no package, lockfile, env, migration, Supabase, API route, payment, auth, WhatsApp, booking, order, NFC or QR file changed", () => {
  if (changed === null) return;
  const bad = changed.filter(
    (f) => !/^scripts\/tests\//.test(f) && /package(-lock)?\.json|\.env|next\.config|middleware|tsconfig|^supabase\/|^src\/app\/api\/|fapshi|stripe|checkout|payment|payout|commission|\/auth\/|whatsapp|inbox|booking|nfc|qr/i.test(f)
  );
  assert.deepEqual(bad, []);
});

console.log(`phase14: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
