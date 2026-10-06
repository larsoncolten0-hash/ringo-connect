// Scalability & reliability, Phases 1-5: parallel dashboard reads, per-request memoised public loaders, a root error boundary, safe failure logging on a
// route that returned a bare 500, lazy-loaded below-the-fold images and long caching of immutable audio previews. Source-level pins plus one pure test of the
// memo helper; the behaviour of the page itself was checked by the typecheck, the production build and the existing suspension / public-profile pins.
//   Run:  node scripts/tests/scalabilityPhase1to5.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (rel) => strip(read(rel));

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

// ---------------------------------------------------------------- 1. the dashboard layout reads together
await test("dashboard layout: every independent read is started first and awaited once; no menu read is awaited on its own any more", () => {
  const s = code("src/app/dashboard/layout.tsx");
  for (const call of ["getAssociationNavAccess", "shopIsVisibleFor", "documentsNavVisible", "inventoryNavVisible", "reportsNavVisible", "customersNavVisible", "inboxNavVisible", "staffInboxNavVisible", "salesNavVisible", "toolkitLockForNav", "getAffiliateSettings"]) {
    assert.ok(!new RegExp(`await ${call}\\(`).test(s), `${call} must not be awaited by itself`);
    assert.ok(s.includes(`${call}(`), `${call} is still used`);
  }
  assert.ok(!/await supabase\.from\("ambassador_(profiles|teams)"\)/.test(s));
  assert.equal((s.match(/await Promise\.all\(\[\s*canManageAssociationP/g) || []).length, 1, "one combined await");
  for (const name of ["canManageAssociation", "hasShop", "hasDocuments", "hasInventory", "hasReports", "hasCustomers", "hasInbox", "hasStaffInbox", "hasSales", "toolkitLock", "affiliateSettings"]) assert.ok(s.includes(name), name);
});
await test("dashboard layout: each read keeps its exact condition and fallback (owner only, never staff, entitled category), so the menu cannot change", () => {
  const s = code("src/app/dashboard/layout.tsx");
  const cond = "!isActingAsStaff && ownProfile ?";
  for (const [p, call] of [["hasShopP", "shopIsVisibleFor(supabase, ownProfile)"], ["hasDocumentsP", "documentsNavVisible({ userId: user.id, profile: ownProfile })"], ["hasInventoryP", "inventoryNavVisible({ userId: user.id, profile: ownProfile })"], ["hasReportsP", "reportsNavVisible({ userId: user.id, profile: ownProfile })"], ["hasCustomersP", "customersNavVisible({ userId: user.id, profile: ownProfile })"], ["hasInboxP", "inboxNavVisible({ supabase, profileId: ownProfile.id })"], ["hasSalesP", "salesNavVisible({ userId: user.id, profile: ownProfile })"], ["toolkitLockP", "toolkitLockForNav({ userId: user.id, profile: ownProfile })"]]) {
    const line = s.split("\n").find((l) => l.includes(`const ${p}`));
    assert.ok(line && line.includes(cond) && line.includes(call) && line.includes("Promise.resolve("), `${p}: ${line}`);
  }
  assert.ok(s.includes("ASSOCIATION_PUBLIC && ownProfile ? getAssociationNavAccess(user.id, ownProfile.id) : Promise.resolve(false)"));
  assert.ok(s.includes("orgs.some((o) => !o.isOwner && o.teamEnabled) ? staffInboxNavVisible(user.id) : Promise.resolve(false)"));
  assert.ok(s.includes("Promise.resolve({ locked: false, inventoryLocked: false, unavailable: null, inventoryUnavailable: false }"));
  // a failed affiliate-settings read still just hides the referral banner
  assert.ok(s.includes("getAffiliateSettings().then((v) => v, () => null)") && s.includes("if (affiliateSettings) {"));
  assert.ok(s.includes("isTeamLeader = !!ambassadorTeam") && s.includes("isAmbassador = !!ambassadorProfile"));
});

// ---------------------------------------------------------------- 2. per-request memo of duplicated public reads
// Evaluate the real helper with a stand-in React, so both branches are exercised against the actual source (not a copy of its logic).
const { transform } = require("sucrase");
const loadMemo = (fakeReact) => {
  const out = transform(read("src/lib/requestMemo.ts"), { transforms: ["typescript", "imports"] }).code;
  const mod = { exports: {} };
  new Function("exports", "module", "require", out)(mod.exports, mod, (id) => { assert.equal(id, "react"); return fakeReact; });
  return mod.exports.memoPerRequest;
};
await test("memoPerRequest: identical to the original function where React.cache does not exist, and delegates to it where it does", () => {
  const f = (a) => a + 1;
  assert.equal(loadMemo({})(f), f, "no cache(): the very same function, so behaviour is unchanged");
  let seen = 0;
  const fakeCache = (fn) => { const store = new Map(); return (...args) => { seen++; const k = JSON.stringify(args); if (!store.has(k)) store.set(k, fn(...args)); return store.get(k); }; };
  const memo = loadMemo({ cache: fakeCache });
  let calls = 0;
  const g = memo((x) => { calls++; return x * 2; });
  assert.equal(g(2), 4); assert.equal(g(2), 4); assert.equal(g(3), 6);
  assert.equal(calls, 2, "the second identical call is served from the cache; a different argument is not");
  assert.ok(seen >= 3);
});
await test("memoised loaders: the three public loaders and the metadata helper are wrapped, their bodies and the suspension gate are untouched", () => {
  const item = code("src/app/[username]/item/[id]/page.tsx");
  assert.ok(item.includes("const getItem = memoPerRequest(async function getItem(") && /if \(!profile\) return null;\s*if \(await isPublicProfileSuspended\(username\)\) return null;/.test(item));
  assert.ok(item.includes("eq(\"published\", true)") && item.includes("p.available !== false"), "same visibility rules");
  const rest = code("src/app/r/[username]/item/[id]/page.tsx");
  assert.ok(rest.includes("const getItem = memoPerRequest(async function getItem(") && /restaurant_food"\)\) return null;\s*if \(await isPublicProfileSuspended\(username\)\) return null;/.test(rest));
  const shop = code("src/app/[username]/shop/page.tsx");
  assert.ok(shop.includes("const load = memoPerRequest(async function load(") && shop.includes("if (await isPublicProfileSuspended(username)) return null;"));
  const meta = code("src/lib/profileMetadata.ts");
  assert.ok(meta.includes("const getProfileForMetadata = memoPerRequest(async function getProfileForMetadata(") && meta.includes("if (data && (await isPublicProfileSuspended(username))) return null;"));
  const memo = code("src/lib/requestMemo.ts");
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(|supabase/.test(memo), "the helper does no data access of its own");
});
await test("memoised loaders are read-only: they only select, and the memoised result is never mutated by its callers", () => {
  for (const f of ["src/app/[username]/item/[id]/page.tsx", "src/app/r/[username]/item/[id]/page.tsx", "src/app/[username]/shop/page.tsx", "src/lib/profileMetadata.ts"]) {
    const s = code(f);
    assert.ok(!/\.(insert|update|upsert|delete)\(/.test(s), f);
  }
  for (const f of ["src/app/[username]/item/[id]/page.tsx", "src/app/r/[username]/item/[id]/page.tsx", "src/app/[username]/shop/page.tsx"]) {
    const s = code(f);
    assert.ok(!/\b(profile|product|found)\.[a-zA-Z_]+\s*=[^=]/.test(s), `${f} assigns to a memoised object`);
  }
});

// ---------------------------------------------------------------- 3. error visibility
await test("restaurant storefront error boundary: /r gets the profile's screen, no site-wide boundary is added, the protected music storefront is untouched, no error text is shown, EN / FR strings already exist", () => {
  assert.ok(!fs.existsSync(path.join(SRC, "app/m/[username]/error.tsx")), "src/app/m/** is protected by shopReceiptPdf.test.mjs: no file is added there");
  for (const f of ["src/app/r/[username]/error.tsx"]) {
    const s = code(f);
    assert.ok(s.startsWith('"use client";'), f);
    assert.ok(s.includes('import PublicProfileError from "../../[username]/error"') && s.includes("<PublicProfileError"), f);
    assert.ok(s.includes("console.error(error)"), f);
    assert.ok(!/\{error\.(message|stack|digest)\}|error\.message|error\.stack/.test(s), `${f}: nothing about the failure is rendered`);
  }
  assert.ok(!fs.existsSync(path.join(SRC, "app/error.tsx")), "premiumPolish.test.mjs pins: no site-wide boundary");
  const inner = code("src/app/[username]/error.tsx");
  assert.ok(!/error\.message|error\.stack/.test(inner));
  const { translations } = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false })(path.join(SRC, "lib/i18n/translations.ts"));
  for (const l of ["en", "fr"]) for (const k of ["errorTitle", "errorBody", "errorRetry", "notFoundCta"]) assert.ok(translations[l].profilePage[k], `${l}.${k}`);
  assert.ok(fs.existsSync(path.join(SRC, "app/dashboard/error.tsx")) && fs.existsSync(path.join(SRC, "app/[username]/error.tsx")), "the existing boundaries are untouched");
});
await test("association roster route: both failure paths now log, with the error CODE only (database text can echo members' names and numbers)", () => {
  const s = code("src/app/api/associations/[associationId]/members/route.ts");
  assert.ok(s.includes('scope: "association_members", step: "roster", code: error.code ?? "unknown"'));
  assert.ok(s.includes('scope: "association_members", step: "terms", error: (err as Error)?.name ?? "unknown"'));
  assert.ok(!/error\.message|err\.message|\$\{err\}/.test(s));
  assert.equal((s.match(/status: 500/g) || []).length, 2, "same two 500 responses as before");
  assert.ok(s.includes("requireAssociationPermission(params.associationId, \"memberships.view\")"), "authorisation unchanged");
});

// ---------------------------------------------------------------- 4. media
await test("images: below-the-fold public images load lazily; the avatar, the cover and the first gallery photo stay eager", () => {
  const lazy = ['loading="lazy"', 'decoding="async"'];
  for (const f of ["src/components/restaurant/FeaturedMenuSection.tsx", "src/components/music/EventsSection.tsx", "src/components/music/MusicStorePage.tsx"]) for (const a of lazy) assert.ok(read(f).includes(a), `${f} ${a}`);
  const rel = read("src/components/music/ReleasesSection.tsx");
  assert.ok(rel.includes('loading={leadFirst && index === 0 ? undefined : "lazy"}') && rel.includes('decoding="async"'), "the large lead release cover stays eager; the rest wait");
  const pv = read("src/components/ProfileView.tsx");
  assert.ok(pv.includes('<img src={link.image_url} alt="" loading="lazy" decoding="async"'));
  assert.ok(pv.includes('<img src={profile.cover_image_url} alt="" className="w-full h-full object-cover" />'), "the cover is not lazy");
  const g = read("src/components/ImageGallery.tsx");
  assert.ok(g.includes('loading={i === 0 ? undefined : "lazy"}'), "only photos after the first wait");
  assert.ok(g.includes("return <img src={urls[0]} alt={alt}") && !/urls\[0\][^\n]*loading=/.test(g), "a single photo stays eager");
});
await test("audio previews: the public preview clips are cached for a year because every upload gets a fresh random name; nothing else about the upload changed", () => {
  for (const f of ["src/components/editor/AudioUploadField.tsx", "src/components/editor/ProtectedAudioUploadField.tsx"]) {
    const s = code(f);
    assert.ok(s.includes('cacheControl: "31536000"') && s.includes("crypto.randomUUID()"), f);
    assert.ok(s.includes('.from("uploads")'), f);
  }
  const p = code("src/components/editor/ProtectedAudioUploadField.tsx");
  assert.ok(p.includes('.from("protected-audio").upload(path, file, { upsert: true })'), "the private full track upload is exactly as before");
  assert.ok(!/preload=/.test(read("src/components/music/MusicSection.tsx")), "no audio is preloaded on the public page");
});

// ---------------------------------------------------------------- 5. scope: what this pass must not touch
const gitOut = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }); } catch { return null; } };
const gitLines = (s) => (s === null ? null : s.split(String.fromCharCode(10)).filter(Boolean));
// Pinned like the Phase 0 guard: to the commit that INTRODUCED src/lib/requestMemo.ts once it exists, otherwise the working tree.
const PASS_COMMIT = (gitOut(["log", "--diff-filter=A", "-1", "--format=%H", "--", "src/lib/requestMemo.ts"]) || "").trim() || null;
const changed = PASS_COMMIT
  ? gitLines(gitOut(["show", "--name-only", "--format=", PASS_COMMIT]))
  : (gitLines(gitOut(["status", "--porcelain"])) || null)?.map((l) => l.slice(3).replace(/^"|"$/g, "")) ?? null;
await test("scope: no auth, RLS, payment, order, stock, bookkeeping, invoice, commission, payout, WhatsApp-logic, restaurant-order, music-payment, cron, package, lockfile, env or SQL file changed", () => {
  if (changed === null) return;
  const bad = changed.filter(
    (f) => !/^scripts\/tests\//.test(f) && /package(-lock)?\.json|\.env|next\.config|vercel\.json|middleware|tsconfig|^supabase\/|^src\/lib\/(applyPayment|fapshi|productCheckout|bookkeeping|documents|sales|inventory|receivables|reports|loyalty|inbox|whatsapp|auth|supabase|toolkitLock)|^src\/app\/api\/(cron|billing|orders|music|bookkeeping|documents|sales|inventory|shop|products|protection|ambassador|affiliate|integrations|inbox|auth|bookings|loyalty|team)/i.test(f)
  );
  assert.deepEqual(bad, []);
});

console.log(`scalabilityPhase1to5: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
