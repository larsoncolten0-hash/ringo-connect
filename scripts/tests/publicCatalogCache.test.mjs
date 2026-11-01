// Focused checks for the public plans / add-ons display cache (src/lib/publicCatalog.ts): one shared cache, refreshed by the admin saves, never used by a payment path, and the per-page views match the
// queries they replaced.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const raw = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const ts = require("typescript");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message}`);
  }
}

// Arrays built inside the vm context have another realm's prototype; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Load the real module with next/cache and supabase-js stubbed: a cache that remembers results by key until a tag is revalidated, and a client fed from a fake database.
function loadCatalog(db) {
  const store = new Map();
  const calls = { plans: 0, addons: 0 };
  const stubs = {
    "next/cache": {
      unstable_cache: (fn, keys, opts) => async () => {
        const k = keys.join("|");
        if (!store.has(k)) store.set(k, await fn());
        return store.get(k);
      },
      revalidateTag: () => store.clear(),
    },
    "@supabase/supabase-js": {
      createClient: () => ({
        from: (table) => {
          const q = { table, filters: [] };
          const chain = {
            select: () => chain,
            eq: (c, v) => (q.filters.push([c, v]), chain),
            order: () => chain,
            then: (res, rej) => {
              calls[table]++;
              if (db.fail) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
              const rows = db[table].filter((r) => q.filters.every(([c, v]) => r[c] === v));
              return Promise.resolve({ data: rows, error: null }).then(res, rej);
            },
          };
          return chain;
        },
      }),
    },
  };
  const js = ts.transpileModule(raw("src/lib/publicCatalog.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (n) => stubs[n], process: { env: {} }, Promise, Error, Number }, {});
  return { api: mod.exports, calls, bust: stubs["next/cache"].revalidateTag };
}

const PLANS = [
  { name: "free", association_enabled: false, max_association_members: null },
  { name: "pro", association_enabled: false, max_association_members: null },
  { name: "association_big", association_enabled: true, max_association_members: null },
  { name: "association_small", association_enabled: true, max_association_members: 50 },
  { name: "association_mid", association_enabled: true, max_association_members: 200 },
];
const ADDONS = [
  { id: "a", name: "Card", active: true, grants_plan_name: "pro", grants_plan_duration_days: 365, price_xaf: 1, price_usd: 1, bundle_features: [], show_on_affiliate_page: true },
  { id: "b", name: "Extra", active: true, grants_plan_name: null, show_on_affiliate_page: false },
  { id: "c", name: "Off", active: false, grants_plan_name: "pro", show_on_affiliate_page: true },
];

await test("one shared cache: both reads are cached under one tag for 5 minutes, and a second read does not touch the database", async () => {
  const { api, calls } = loadCatalog({ plans: PLANS, addons: ADDONS });
  assert.equal(api.CATALOG_REVALIDATE_SECONDS, 300);
  await api.getPublicPlans();
  await api.getPublicPlans();
  await api.getPublicActiveAddons();
  await api.getPublicActiveAddons();
  assert.deepEqual(calls, { plans: 1, addons: 1 });
  assert.equal((await api.getPublicActiveAddons()).length, 2, "only active add-ons");
});

await test("an admin save (revalidateTag) makes the next read go back to the database", async () => {
  const db = { plans: [...PLANS], addons: [...ADDONS] };
  const { api, calls, bust } = loadCatalog(db);
  await api.getPublicPlans();
  db.plans = [{ name: "pro" }];
  assert.equal((await api.getPublicPlans()).length, 5, "still the cached copy before the refresh");
  bust(api.PUBLIC_CATALOG_TAG);
  assert.equal((await api.getPublicPlans()).length, 1);
  assert.equal(calls.plans, 2);
});

await test("a failed read is never cached as an empty catalogue: the page gets [] now and the real rows on the next read", async () => {
  const db = { plans: PLANS, addons: ADDONS, fail: true };
  const { api } = loadCatalog(db);
  assert.deepEqual(plain(await api.getPublicPlans()), []);
  db.fail = false;
  assert.equal((await api.getPublicPlans()).length, 5);
});

await test("each page's view matches the query it replaced", async () => {
  const { api } = loadCatalog({ plans: PLANS, addons: ADDONS });
  const plans = await api.getPublicPlans();
  const addons = await api.getPublicActiveAddons();
  assert.deepEqual(api.paidPlansFrom(plans).map((p) => p.name), ["pro", "association_big", "association_small", "association_mid"], "affiliate: everything but free");
  assert.deepEqual(api.associationPlansFrom(plans).map((p) => p.name), ["association_small", "association_mid", "association_big"], "association: smallest cap first, unlimited last");
  assert.deepEqual(api.affiliateAddonsFrom(addons).map((a) => a.id), ["a"], "affiliate add-ons: active AND shown on the affiliate page");
  assert.deepEqual(plain(api.bundleAddonsFrom(addons)), [{ id: "a", name: "Card", price_xaf: 1, price_usd: 1, grants_plan_duration_days: 365, bundle_features: [] }], "landing bundles: active, grants a plan, only the columns the section uses");
});

await test("the five public pages read the shared cache and no longer query plans / addons themselves", () => {
  for (const f of ["src/app/page.tsx", "src/app/get-started/page.tsx", "src/app/get-started-cards/page.tsx", "src/app/get-started-affiliate/page.tsx", "src/app/get-started-association/page.tsx"]) {
    const s = raw(f);
    assert.ok(s.includes('@/lib/publicCatalog"'), `${f} uses the shared cache`);
    assert.ok(!/from\(\s*["'](plans|addons)["']/.test(s), `${f} has no private plans/addons query`);
    assert.ok(s.includes('export const dynamic = "force-dynamic"'), `${f} is still rendered per request (session, country, settings)`);
  }
});

await test("the three admin save routes refresh the cache only after a successful write, and keep their admin check", () => {
  for (const f of ["src/app/api/admin/plans/[id]/route.ts", "src/app/api/admin/addons/route.ts", "src/app/api/admin/addons/[id]/route.ts"]) {
    const s = raw(f);
    assert.ok(s.includes("assertAdmin()") && s.includes("Forbidden"), `${f} still checks admin`);
    const err = s.indexOf("if (error) return NextResponse.json");
    const bust = s.indexOf("revalidateTag(PUBLIC_CATALOG_TAG)");
    assert.ok(err > 0 && bust > err, `${f}: refresh comes after the failed-write return`);
    assert.ok(/try \{\s*revalidateTag\(PUBLIC_CATALOG_TAG\);\s*\} catch/.test(s), `${f}: a refresh problem can never fail the save`);
  }
});

await test("payment-critical code never uses the display cache and still reads live rows", () => {
  const critical = [
    "src/lib/signupPayment.ts", "src/lib/applyPayment.ts", "src/lib/cardBundle.ts", "src/lib/pricing.ts", "src/app/api/billing/fapshi/initiate/route.ts", "src/app/api/billing/fapshi/status/[transId]/route.ts",
    "src/app/api/billing/stripe/webhook/route.ts", "src/app/api/billing/stripe/create-checkout-session/route.ts", "src/app/api/billing/cancel/route.ts", "src/app/api/association/billing/fapshi/initiate/route.ts",
    "src/app/api/ringo-cards/bundle/initiate/route.ts", "src/app/api/signup-requests/route.ts", "src/app/api/admin/requests/[id]/charge/route.ts", "src/app/api/admin/requests/[id]/approve/route.ts",
    "src/app/api/cron/downgrade-expired/route.ts", "src/app/api/cron/reconcile-signup-payments/route.ts", "src/lib/fapshi.ts",
  ];
  for (const f of critical) {
    if (!fs.existsSync(path.join(REPO, f))) continue;
    assert.ok(!/publicCatalog/.test(raw(f)), `${f} must not import the display cache`);
  }
  const users = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && /publicCatalog/.test(fs.readFileSync(f, "utf8"))) users.push(path.relative(REPO, f).replace(/\\/g, "/"));
    }
  };
  walk(path.join(REPO, "src"));
  assert.deepEqual(users.sort(), [
    "src/app/api/admin/addons/[id]/route.ts", "src/app/api/admin/addons/route.ts", "src/app/api/admin/plans/[id]/route.ts",
    "src/app/get-started-affiliate/page.tsx", "src/app/get-started-association/page.tsx", "src/app/get-started-cards/page.tsx", "src/app/get-started/page.tsx", "src/app/page.tsx",
  ].sort(), "the cache is imported only by the display pages and the admin refresh");
});

await test("the cache module is public-data only: anon key, no cookies, no service role", () => {
  const s = raw("src/lib/publicCatalog.ts").replace(/\/\/.*$/gm, "");
  assert.ok(s.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") && !/SERVICE_ROLE|createAdminClient|cookies\(|next\/headers/.test(s));
});

console.log(`\npublicCatalogCache: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
