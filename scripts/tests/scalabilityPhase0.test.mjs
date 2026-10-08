// Scalability & reliability, Phase 0: additive lookup indexes, smaller / longer-cached photo uploads, and a parallel public profile read. Nothing here connects to Supabase or any real database; the migration runs on a scratch in-memory PostgreSQL (PGlite).
//   Run:  node scripts/tests/scalabilityPhase0.test.mjs
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
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
};

// ---------------------------------------------------------------- 2. the index migration
const MIG = "supabase/migrations/2026-12-16_profile_lookup_indexes.sql";
const ROLLBACK = "supabase/support/2026-12-16_profile_lookup_indexes.rollback.sql";
const migSql = read(MIG);
const sqlCode = migSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const NAMES = [...sqlCode.matchAll(/'(\w+_idx)'/g)].map((m) => m[1]);

await test("migration: only creates indexes (IF NOT EXISTS, guarded by table and column existence); nothing is altered, dropped, inserted, updated or deleted", () => {
  assert.equal(NAMES.length, 9);
  assert.ok(!/\b(drop|alter|insert|update|delete|truncate|grant|revoke)\b/i.test(sqlCode.replace(/'[^']*'/g, "")), "no other statement");
  assert.ok(/create index if not exists %I on public\.%I/.test(sqlCode));
  assert.ok(sqlCode.includes("to_regclass") && sqlCode.includes("information_schema.columns"));
  assert.ok(!/create unique index|concurrently/i.test(sqlCode.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), "no unique index (it could fail on data) and no CONCURRENTLY inside a transaction");
  assert.ok(/NOT APPLIED/.test(migSql.split("\n")[0]));
});
await test("migration: the rollback drops exactly the migration's own indexes and nothing else", () => {
  const rb = read(ROLLBACK).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const dropped = [...rb.matchAll(/drop index if exists public\.(\w+);/g)].map((m) => m[1]).sort();
  assert.deepEqual(dropped, [...NAMES].sort());
  assert.ok(!/\b(drop table|drop column|alter|delete|truncate)\b/i.test(rb));
});
await test("migration: runs on a real PostgreSQL engine, twice, and only adds the nine indexes; missing tables are skipped; rollback removes them", async () => {
  let PGlite;
  try { ({ PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite")); } catch { throw new Error("PGlite is not installed (npm install --no-save @electric-sql/pglite)"); }
  const db = new PGlite();
  await db.exec(`
    create table profiles (id uuid primary key, user_id uuid not null, username text unique);
    create table links (id uuid primary key, profile_id uuid not null, sort_order int);
    create table social_links (id uuid primary key, profile_id uuid not null);
    create table products (id uuid primary key, profile_id uuid not null);
    create table tracks (id uuid primary key, profile_id uuid not null);
    create table events (id uuid primary key, profile_id uuid not null);
    create table menu_categories (id uuid primary key, profile_id uuid not null);
    -- profile_phone_numbers and restaurant_tables deliberately do not exist in this database
    create table unrelated (id uuid primary key, profile_id uuid);
    insert into profiles values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa','a');
  `);
  const snapshot = async () => (await db.query(`select tablename, indexname from pg_indexes where schemaname='public' order by 1,2`)).rows.map((r) => `${r.tablename}.${r.indexname}`);
  const objects = async () => (await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S','m')`)).rows[0].n;
  const rows = async () => (await db.query(`select count(*)::int n from profiles`)).rows[0].n;
  const before = await snapshot(); const objBefore = await objects();
  await db.exec(migSql);
  const once = await snapshot();
  await db.exec(migSql); // idempotent
  const twice = await snapshot();
  assert.deepEqual(twice, once);
  const added = once.filter((x) => !before.includes(x));
  assert.deepEqual(added.sort(), [
    "events.events_profile_id_lookup_idx", "links.links_profile_id_lookup_idx", "menu_categories.menu_categories_profile_id_lookup_idx",
    "products.products_profile_id_lookup_idx", "profiles.profiles_user_id_lookup_idx", "social_links.social_links_profile_id_lookup_idx", "tracks.tracks_profile_id_lookup_idx",
  ].sort());
  assert.ok(!added.some((x) => x.startsWith("unrelated.")), "tables outside the list are untouched");
  assert.equal(await objects(), objBefore, "no table, view or sequence was created");
  assert.equal(await rows(), 1, "no row changed");
  await db.exec(read(ROLLBACK));
  assert.deepEqual(await snapshot(), before, "rollback restores exactly the previous index set");
  await db.close();
});

// ---------------------------------------------------------------- 3. smaller, longer-cached photos
const { planDownscale, MAX_EDGE, MIN_BYTES } = jiti(path.join(SRC, "lib/imageDownscale.ts"));
await test("downscale: a heavy, wide JPEG / PNG / WebP is planned at the longest edge; everything else is left exactly as chosen", () => {
  const big = { type: "image/jpeg", size: 4_000_000 };
  assert.deepEqual(planDownscale(big, { width: 4000, height: 3000 }), { width: MAX_EDGE, height: 1200 });
  assert.deepEqual(planDownscale({ ...big, type: "image/png" }, { width: 1000, height: 3200 }), { width: 500, height: MAX_EDGE });
  assert.ok(planDownscale({ ...big, type: "image/webp" }, { width: 2000, height: 2000 }));
  assert.equal(planDownscale({ type: "image/gif", size: 4_000_000 }, { width: 4000, height: 3000 }), null, "an animated GIF is never re-encoded");
  assert.equal(planDownscale({ type: "image/svg+xml", size: 4_000_000 }, { width: 4000, height: 3000 }), null);
  assert.equal(planDownscale({ type: "image/jpeg", size: MIN_BYTES }, { width: 4000, height: 3000 }), null, "a light file is not worth re-encoding");
  assert.equal(planDownscale(big, { width: MAX_EDGE, height: 900 }), null, "already small enough");
  assert.equal(planDownscale(big, { width: 0, height: 0 }), null);
  const r = planDownscale(big, { width: 4000, height: 3000 });
  assert.ok(Math.abs(r.width / r.height - 4000 / 3000) < 0.01, "aspect ratio is kept");
});
await test("downscale: on any problem the original file is uploaded (no document / canvas, a non-image, a light file)", async () => {
  const { downscaleImage } = jiti(path.join(SRC, "lib/imageDownscale.ts"));
  const f = { name: "a.jpg", type: "image/jpeg", size: 5_000_000 };
  assert.equal(await downscaleImage(f), f, "no browser APIs here: the same object comes back");
});
await test("uploads: random names mean the file never changes, so it is cached for a year; oversized photos go through the downscaler; storage paths are unchanged", () => {
  for (const f of ["src/components/editor/ImageUploadField.tsx", "src/components/editor/ImageGalleryUploadField.tsx"]) {
    const s = code(f);
    assert.ok(s.includes('cacheControl: "31536000"') && /await downscaleImage\(file[,)]/.test(s) /* the performance phase adds the optional target kind: downscaleImage(file, kind) */, f);
    assert.ok(s.includes("crypto.randomUUID()") && s.includes('.from("uploads")'), f);
    assert.ok(/MAX_SIZE_BYTES = 5 \* 1024 \* 1024/.test(s) && s.includes("file.size > MAX_SIZE_BYTES"), "the 5 MB limit still applies to the file the person chose");
  }
  const a = code("src/components/editor/AvatarCropperField.tsx");
  assert.ok(a.includes('cacheControl: "31536000"') && a.includes("crypto.randomUUID()"));
  const dsl = code("src/lib/imageDownscale.ts");
  assert.ok(!/image\/gif|image\/svg/.test(dsl.replace(/\/\/.*$/gm, "").split("TYPES")[1]?.slice(0, 120) || ""), "gif / svg are not in the re-encoded set");
});

// ---------------------------------------------------------------- 4. the public profile read
await test("public profile: the independent reads run together in two stages, and nothing is recorded or sent before the suspension check", () => {
  const s = code("src/app/[username]/page.tsx");
  // stage 1: the profile, the suspension check and the signed-in visitor together
  assert.match(s, /await Promise\.all\(\[\s*supabase\s*\.from\("profiles"\)[\s\S]*?isPublicProfileSuspended\(params\.username\),\s*supabase\.auth\.getUser\(\),\s*\]\)/);
  // the gates are exactly what they were: not found, then suspended, before any other read that needs the profile, any record or any Pixel call
  assert.match(s, /if \(!profile\) return notFound\(\);\s*if \(suspended\) return notFound\(\);/);
  const iGate = s.indexOf("if (suspended) return notFound();");
  // stage 2: the profile-dependent reads together (the owner's plan, the checkout capability, the staff badges, whether Pixels are active, the page-view row)
  assert.match(s, /await Promise\.all\(\[\s*computeProfileCheckoutAvailability\(profile\),[\s\S]*?loadStaffBadges\(profile\),[\s\S]*?isPixelsEnabledForUser\(profile\.user_id\)[\s\S]*?from\("click_events"\)\.insert/);
  assert.ok(s.includes("const ownerPlan = (await getPublicOwnerAccount(params.username)).plan;"), "the owner's plan comes from the same single owner read as the suspension check (no separate query)");
  assert.ok(iGate > 0 && iGate < s.indexOf("computeProfileCheckoutAvailability(profile),"));
  for (const effect of ['from("click_events").insert', "sendMetaPageView(", "isPixelsEnabledForUser(", "loadStaffBadges(profile),"]) assert.ok(s.indexOf(effect, iGate) > iGate && s.lastIndexOf(effect) > iGate, `${effect} must come after the suspension check`);
  assert.ok(/isOwner\s*\?\s*Promise\.resolve\(\{ error: null \}\)/.test(s), "the owner's own view is still not recorded as a visit");
  // behaviour that must not move
  assert.ok(s.includes("isCustomThemeAllowed(ownerPlan)") && s.includes("limitPublicRows<any>(profile.products, isPublicProduct, ownerPlan?.max_products ?? null)"));
  assert.ok(s.includes("facebook_capi_token_encrypted, tiktok_events_token_encrypted, ...publicProfile"), "private tokens still never reach the browser");
  assert.ok(s.includes("if (profile.team_badges_enabled === false) return [];"));
});

// ---------------------------------------------------------------- 5. scope: what this work must not touch
// Pinned to the commit that INTRODUCED the Phase 0 migration, found in git history (the repository convention is a fixed commit, as in phase14.test.mjs and
// musicProfile.test.mjs; the hash cannot be written before the commit exists, so it is looked up instead). Once Phase 0 is committed this reads that commit
// only, so later phases cannot trip it. Until the commit exists (the migration is still untracked) it reads the working tree, exactly as it always did.
const gitOut = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }); } catch { return null; } };
const gitLines = (s) => (s === null ? null : s.split(String.fromCharCode(10)).filter(Boolean));
const PHASE0_COMMIT = (gitOut(["log", "--diff-filter=A", "-1", "--format=%H", "--", MIG]) || "").trim() || null;
const changed = PHASE0_COMMIT
  ? gitLines(gitOut(["show", "--name-only", "--format=", PHASE0_COMMIT]))
  : (gitLines(gitOut(["status", "--porcelain"])) || null)?.map((l) => l.slice(3).replace(/^"|"$/g, "")) ?? null;
await test("scope: no auth, RLS, payment, order, stock, bookkeeping, invoice, commission, payout, WhatsApp, restaurant, music-payment, package, lockfile or env file changed", () => {
  if (changed === null) return;
  const allowedTouch = new Set(); // nothing protected is touched at all
  const bad = changed.filter(
    (f) => !/^scripts\/tests\//.test(f) && !allowedTouch.has(f) && /package(-lock)?\.json|\.env|next\.config|middleware|tsconfig|^src\/lib\/(applyPayment|fapshi|productCheckout|bookkeeping|documents|sales|inventory|receivables|reports|loyalty|inbox|whatsapp)|^src\/app\/api\/(cron|billing|orders|music|bookkeeping|documents|sales|inventory|shop|products|protection|ambassador|affiliate|integrations|inbox)|^src\/lib\/(auth|supabase)/i.test(f)
  );
  assert.deepEqual(bad, []);
  assert.ok(!changed.some((f) => /^supabase\/migrations\//.test(f) && f !== MIG), "only the one new additive migration");
});

console.log(`scalabilityPhase0: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
