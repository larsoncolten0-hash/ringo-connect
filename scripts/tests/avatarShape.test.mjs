// Profile picture shape (round or square), chosen by the profile's owner. Run: node scripts/tests/avatarShape.test.mjs
// The rendered checks for the public profile, the Music profile and the Music pages live in musicProfile.test.mjs (it owns that harness); this file proves the helper, the editor choice,
// the product and shop surfaces, the exclusions, the un-applied additive migration, EN/FR parity and the scope.
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PHASE25_FILES } from "./phase25Files.mjs";
import { PHASE26_FILES } from "./phase26Files.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const git = (a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
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

const { normalizeAvatarShape, avatarRadius } = jiti(path.join(REPO, "src/lib/avatarShape.ts"));
const { translations } = jiti(path.join(REPO, "src/lib/i18n/translations.ts"));

test("helper: only 'square' is square; anything else (missing column, null, typo, wrong case, a number) is round", () => {
  assert.equal(normalizeAvatarShape("square"), "square");
  for (const v of ["round", "", null, undefined, "SQUARE", "Square", "circle", "box", 3, {}, []]) assert.equal(normalizeAvatarShape(v), "round", String(v));
});
test("helper: round is always rounded-full; square is a soft Ringo-token radius at every size, never sharp", () => {
  for (const size of ["hero", "large", "medium", "small"]) {
    assert.equal(avatarRadius("round", size), "rounded-full");
    assert.match(avatarRadius("square", size), /^rounded-ringo-(sm|md|lg)$/, size);
  }
  assert.ok(avatarRadius("square", "hero") === "rounded-ringo-lg" && avatarRadius("square", "small") === "rounded-ringo-sm", "softer the bigger the picture");
});
test("editor: Round / Square with a live preview of each, in the profile card, saved by its one Save button, and sent only when changed", () => {
  const c = raw("src/components/editor/ProfileHeaderCard.tsx");
  assert.match(c, /aria-pressed=\{avatarShape === shape\}/);
  assert.match(c, /updateDraft\(\{ avatar_shape: shape \}\)/, "the live preview follows the choice");
  assert.match(c, /\.\.\.\(avatarShape !== savedShape \? \{ avatar_shape: avatarShape \} : \{\}\)/, "a save that never touches the shape never mentions the new column");
  assert.match(c, /avatarRadius\(shape, "small"\)/, "each option previews its own shape");
  assert.equal((c.match(/\{t\.editor\.save\}/g) || []).length, 1, "still exactly one Save button");
  assert.match(raw("src/components/Editor.tsx"), /initialAvatarShape=\{profile\.avatar_shape\}/);
});
test("product / item pages and the shop page follow the choice; the shop page's whitelist carries it", () => {
  const p = strip(raw("src/components/catalog/ProductDetailView.tsx"));
  assert.equal((p.match(/avatarRadius\(normalizeAvatarShape\(profile\.avatar_shape\), "small"\)/g) || []).length, 2, "the picture and its initial-letter fallback");
  assert.match(strip(raw("src/components/shop/ShopDestination.tsx")), /avatarRadius\(normalizeAvatarShape\(profile\.avatar_shape\), "medium"\)/);
  assert.match(strip(raw("src/app/[username]/shop/page.tsx")), /avatar_shape: profile\.avatar_shape \?\? null/);
  const shopAvatar = (raw("src/components/shop/ShopDestination.tsx").match(/<span className=\{`flex h-\[72px\][^\n]*/) || [""])[0];
  assert.ok(shopAvatar && !/rounded-full/.test(shopAvatar), "no hard-coded circle left on the shop avatar");
});
test("exclusions: the About portrait, Pinned Spotlight, staff / organisation avatars, customer avatars and PWA icons are not touched", () => {
  for (const f of ["src/components/music/profile/MusicSections.tsx", "src/components/music/PinnedSpotlight.tsx", "src/components/my-ringo/CustomerAvatar.tsx", "src/app/[username]/manifest.webmanifest/route.ts", "src/app/api/profile/avatar-icons/route.ts", "src/components/editor/AvatarCropperField.tsx"]) {
    assert.ok(!/avatar_shape|avatarShape/.test(raw(f)), f);
  }
  assert.match(raw("src/components/ProfileView.tsx"), /orgAvatarUrl \|\| "\/default-avatar\.png"/, "staff badges untouched");
  assert.match(raw("src/components/music/profile/MusicArtistView.tsx"), /h-5 w-5 rounded-full object-cover/, "staff badge avatars stay round");
});
test("the choice is only READ on public pages; the only writer is the editor card", () => {
  for (const f of ["src/components/ProfileView.tsx", "src/components/music/profile/MusicArtistView.tsx", "src/components/music/profile/MusicDestinationView.tsx", "src/components/catalog/ProductDetailView.tsx", "src/components/shop/ShopDestination.tsx"]) {
    assert.match(raw(f), /normalizeAvatarShape\(profile\.avatar_shape\)/, f);
    assert.ok(!/avatar_shape\s*[:=]/.test(strip(raw(f)).replace(/normalizeAvatarShape\(profile\.avatar_shape\)/g, "")), f + " writes");
  }
});
test("upload, crop, storage and image generation are untouched", () => {
  // the avatar-shape work itself never touched them; the performance project (phase26Files.mjs) sizes NEW uploads in the two upload fields and is proven in performance.test.mjs
  assert.deepEqual(git(["diff", "--name-only", "HEAD", "--", "src/app/api/profile", "src/lib/supabase"]), []);
});
test("the crop widget: the performance project only loads it on demand; the crop, the 512 px output, the upload and the storage path are unchanged", () => {
  const changed = git(["diff", "-U0", "HEAD", "--", "src/components/editor/AvatarCropperField.tsx"]).filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l));
  assert.ok(changed.every((l) => /^[-+]\s*$|dynamic|Cropper|import type \{ Area \}|crop widget|react-easy-crop/.test(l)), "only the way the widget is imported changed: " + changed.join(" | "));
  const c = raw("src/components/editor/AvatarCropperField.tsx");
  assert.ok(c.includes("const OUTPUT_SIZE = 512;") && c.includes('contentType: "image/jpeg"') && c.includes('cacheControl: "31536000"') && c.includes("${userId}/avatar/${crypto.randomUUID()}.jpg"));
});
test("migration: UN-APPLIED, one additive column default 'round' with a round/square check, a rollback and a verify; nothing else", () => {
  const sql = raw("supabase/migrations/2026-12-17_profile_avatar_shape.sql");
  assert.match(sql, /PROPOSED, NOT APPLIED/);
  assert.match(sql, /add column if not exists avatar_shape text not null default 'round'/);
  assert.match(sql, /check \(avatar_shape in \('round', 'square'\)\)/);
  assert.ok(!/\b(drop|delete|update|truncate|insert|grant)\b|create (policy|trigger|function|index)|alter table (?!public\.profiles)/i.test(sql.replace(/--.*$/gm, "")), "additive only: no data change, policy, trigger, function, index or other table");
  assert.match(raw("supabase/support/2026-12-17_profile_avatar_shape.rollback.sql"), /drop column if exists avatar_shape/);
  assert.match(raw("supabase/support/2026-12-17_profile_avatar_shape.verify.sql"), /avatar_shape/);
  assert.ok(!/avatar_shape/.test(raw("supabase/schema.sql")), "schema.sql (the applied schema) does not claim the column");
});
test("EN / FR: the label and both options exist, are translated, and the editor profile namespace keeps the same keys", () => {
  for (const l of ["en", "fr"]) for (const k of ["photoShape", "photoRound", "photoSquare"]) assert.ok(translations[l].editor.profile[k], `${l}.${k}`);
  assert.equal(translations.en.editor.profile.photoShape, "Profile Picture Shape");
  assert.ok(["photoShape", "photoRound", "photoSquare"].every((k) => translations.en.editor.profile[k] !== translations.fr.editor.profile[k]));
  assert.equal(JSON.stringify(Object.keys(translations.en.editor.profile).sort()), JSON.stringify(Object.keys(translations.fr.editor.profile).sort()));
});
test("scope: every changed file is on this phase's list, nothing sensitive is on it, and no foreign currency crept in", () => {
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  assert.deepEqual(changed.filter((f) => !PHASE25_FILES.has(f) && !PHASE26_FILES.has(f)), [], "only the registered files changed (this phase, or the performance project that sits on top of it)");
  assert.deepEqual([...PHASE25_FILES].filter((f) => /payment|fapshi|stripe|webhook|\/auth|whatsapp|track|pixel|useTrackPlayback|previewLimit|middleware|\/api\//i.test(f)), []);
  for (const f of changed.filter((x) => /\.(tsx?|mjs|sql)$/.test(x) && !x.startsWith("scripts/tests/") && fs.existsSync(path.join(REPO, x)))) {
    assert.ok(!/GH₵|GHS/.test(fs.readFileSync(path.join(REPO, f), "utf8")), "foreign currency in " + f);
  }
});

console.log(`\navatarShape: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
