// Sub-category picker for every category OTHER than Music & Entertainment and Restaurant & Food,
// which keep their own separate, unchanged music_role/restaurant_subcategory mechanisms — see
// src/lib/categories.ts's SubcategoryOption/getSubcategoryOption/isValidSubcategoryId, the
// getBookingConfig(id, subcategoryId) widening, CategoryCard.tsx's new picker UI, and
// 2026-09-27_category_subcategories.sql's additive profiles.subcategory column.
//
// Purely cosmetic everywhere except creative_media, whose photographer/videographer/
// graphic_designer/studio sub-types each override the category's single "Book a Photoshoot"
// default — the one deliberate, user-requested exception (see categories.ts's own comments).
//   Run:  node scripts/tests/categorySubcategories.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const {
  CATEGORIES,
  CATEGORY_IDS,
  getCategory,
  getBookingConfig,
  getSubcategoryOption,
  isValidSubcategoryId,
  GENERIC_BOOKING_CONFIG,
  MUSIC_ROLES,
  RESTAURANT_SUBCATEGORIES,
} = jiti(path.join(SRC, "lib/categories.ts"));

const NO_SUBCATEGORY_IDS = ["music_entertainment", "restaurant_food", "other"];
const WITH_SUBCATEGORY_IDS = CATEGORY_IDS.filter((id) => !NO_SUBCATEGORY_IDS.includes(id));

// ---------------------------------------------------------------- 1. music/restaurant/other untouched — never get the new mechanism
{
  for (const id of NO_SUBCATEGORY_IDS) {
    const cat = getCategory(id);
    check(`${id} has NO subcategories list (keeps its own separate mechanism, or stays generic)`, !cat?.defaults.subcategories);
  }
  check("MUSIC_ROLES is untouched (still 7 roles, own dedicated mechanism)", Array.isArray(MUSIC_ROLES) && MUSIC_ROLES.length === 7);
  check("RESTAURANT_SUBCATEGORIES is untouched (still 8 options, own dedicated mechanism)", Array.isArray(RESTAURANT_SUBCATEGORIES) && RESTAURANT_SUBCATEGORIES.length === 8);
}

// ---------------------------------------------------------------- 2. every other category has a real, bilingual subcategories list
{
  check("exactly 13 other categories exist to receive the new mechanism", WITH_SUBCATEGORY_IDS.length === 13, `got ${WITH_SUBCATEGORY_IDS.length}: ${WITH_SUBCATEGORY_IDS.join(",")}`);
  for (const id of WITH_SUBCATEGORY_IDS) {
    const cat = getCategory(id);
    const subs = cat?.defaults.subcategories;
    check(`${id} has a non-empty subcategories list`, Array.isArray(subs) && subs.length >= 3, `subs=${JSON.stringify(subs)}`);
    if (!Array.isArray(subs)) continue;
    for (const s of subs) {
      check(`${id}.${s.id} has an emoji`, typeof s.emoji === "string" && s.emoji.length > 0);
      check(`${id}.${s.id} has a bilingual label (en + fr, both non-empty)`, !!s.label?.en && !!s.label?.fr);
    }
    check(`${id} ends its subcategories list with a generic "other" catch-all`, subs[subs.length - 1].id === "other");
    check(`${id}'s subcategory ids are unique within the category`, new Set(subs.map((s) => s.id)).size === subs.length);
  }
}

// ---------------------------------------------------------------- 3. creative_media: the ONE deliberate booking-override exception
{
  const creative = getCategory("creative_media");
  const subs = creative.defaults.subcategories;
  const withOverride = ["photographer", "videographer", "graphic_designer", "studio"];
  for (const id of withOverride) {
    const opt = subs.find((s) => s.id === id);
    check(`creative_media.${id} defines its own booking override`, !!opt?.booking?.buttonLabel?.en && !!opt?.booking?.buttonLabel?.fr, JSON.stringify(opt));
  }
  const videographer = subs.find((s) => s.id === "videographer");
  check('videographer\'s button says "Book a Videoshoot", not the photography default', videographer.booking.buttonLabel.en === "Book a Videoshoot");
  check("videographer's label differs from the category's own generic default (the exact mismatch the user reported)", videographer.booking.buttonLabel.en !== creative.defaults.booking.buttonLabel.en);
  const photographer = subs.find((s) => s.id === "photographer");
  check("photographer's override matches the category default (still Book a Photoshoot)", photographer.booking.buttonLabel.en === creative.defaults.booking.buttonLabel.en);
  const other = subs.find((s) => s.id === "other");
  check("creative_media's catch-all 'other' does NOT define a booking override (falls back to the category default)", !other.booking);
}

// ---------------------------------------------------------------- 4. every OTHER category's sub-options stay purely cosmetic (no booking override) — parity with music/restaurant
{
  const exemptFromNoOverrideRule = new Set(["creative_media"]);
  for (const id of WITH_SUBCATEGORY_IDS) {
    if (exemptFromNoOverrideRule.has(id)) continue;
    const subs = getCategory(id).defaults.subcategories;
    check(`${id}'s sub-options are purely cosmetic — none define a booking override`, subs.every((s) => !s.booking), JSON.stringify(subs.filter((s) => s.booking)));
  }
}

// ---------------------------------------------------------------- 5. getBookingConfig — widened but fully backward compatible
{
  check("getBookingConfig(id) with no subcategory arg still works exactly as before (Restaurant)", getBookingConfig("restaurant_food").buttonLabel.en === "Book a Table");
  check("getBookingConfig(id) with no subcategory arg still works exactly as before (Music)", getBookingConfig("music_entertainment").buttonLabel.en === "Book Artist");
  check("unknown category still falls back to GENERIC_BOOKING_CONFIG", getBookingConfig("not_a_real_category").buttonLabel.en === GENERIC_BOOKING_CONFIG.buttonLabel.en);

  check("videographer subcategory changes the button label via the 2nd arg", getBookingConfig("creative_media", "videographer").buttonLabel.en === "Book a Videoshoot");
  check("a subcategory with no override falls back to the category default", getBookingConfig("business_ecommerce", "retailer").buttonLabel.en === GENERIC_BOOKING_CONFIG.buttonLabel.en);
  check("a subcategory belonging to a DIFFERENT category is ignored (never cross-applies)", getBookingConfig("business_ecommerce", "videographer").buttonLabel.en === GENERIC_BOOKING_CONFIG.buttonLabel.en);
  check("null/undefined subcategory behaves identically to omitting it", getBookingConfig("creative_media", null).buttonLabel.en === "Book a Photoshoot");
}

// ---------------------------------------------------------------- 6. getSubcategoryOption / isValidSubcategoryId
{
  check("getSubcategoryOption finds a real option", getSubcategoryOption("creative_media", "photographer")?.id === "photographer");
  check("getSubcategoryOption returns undefined for a category with no list", getSubcategoryOption("music_entertainment", "artist") === undefined);
  check("getSubcategoryOption returns undefined for an id from a different category", getSubcategoryOption("business_ecommerce", "photographer") === undefined);
  check("isValidSubcategoryId true for a real pair", isValidSubcategoryId("real_estate", "agent") === true);
  check("isValidSubcategoryId false for a mismatched pair", isValidSubcategoryId("real_estate", "photographer") === false);
  check("isValidSubcategoryId false for non-string input", isValidSubcategoryId("real_estate", 123) === false && isValidSubcategoryId(null, "agent") === false);
}

// ---------------------------------------------------------------- 7. CategoryDefaults/SubcategoryOption stayed additive (structural)
{
  const src = read("src/lib/categories.ts");
  check("SubcategoryOption interface exists", /export interface SubcategoryOption \{/.test(src));
  check("CategoryDefaults gained subcategories as an OPTIONAL field (never required)", /subcategories\?: SubcategoryOption\[\];/.test(src));
}

// ---------------------------------------------------------------- 8. the new migration is additive/idempotent and never touches music_role/restaurant_subcategory
{
  const migrationFiles = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => /category_subcategories/.test(f));
  check("exactly one new migration was added for this feature", migrationFiles.length === 1, migrationFiles.join(","));
  const migration = read(`supabase/migrations/${migrationFiles[0]}`);
  check("adds profiles.subcategory as a nullable, idempotent column add", /alter table profiles add column if not exists subcategory text;/.test(migration));
  check("the CHECK constraint is guarded (idempotent, only added if missing)", /if not exists \(select 1 from pg_constraint where conname = 'profiles_subcategory_check'\)/.test(migration));
  check(
    "never touches music_role or restaurant_subcategory columns/constraints (mentioning their existing constraint names in a comment is fine — only DDL against them is not)",
    !/alter table profiles add column if not exists (music_role|restaurant_subcategory)/.test(migration) &&
      !/alter table profiles (add|drop) constraint profiles_(music_role|restaurant_subcategory)_check/.test(migration)
  );
}

// ---------------------------------------------------------------- 9. CategoryCard.tsx wiring
{
  const src = read("src/components/editor/CategoryCard.tsx");
  check("accepts initialSubcategory prop", /initialSubcategory\?: string \| null/.test(src));
  check("resets an invalid subcategory when the primary category changes (never carries over a mismatched value)", /isValidSubcategoryId\(id, subcategory\)/.test(src));
  check("save() persists subcategory alongside category/categories in the SAME write (single Save button, no second Save)", /\.update\(\{ category, categories: \[category, \.\.\.extraCategories\], subcategory \}\)/.test(src));
  check("the picker only renders when the selected category actually has subcategories", /subcategoryOptions\?\.length/.test(src));
}

// ---------------------------------------------------------------- 10. Editor.tsx passes the new prop through
{
  const src = read("src/components/Editor.tsx");
  check("Editor.tsx passes initialSubcategory={profile.subcategory} to CategoryCard", /initialSubcategory=\{profile\.subcategory\}/.test(src));
}

// ---------------------------------------------------------------- 11. BookingButton/BookingPage pass subcategory through; the [username]/book route selects it
{
  const buttonSrc = read("src/components/BookingButton.tsx");
  check("BookingButton passes profile.subcategory as the 2nd arg", /getBookingConfig\(profile\.category, profile\.subcategory\)/.test(buttonSrc));
  const pageSrc = read("src/components/BookingPage.tsx");
  check("BookingPage passes profile.subcategory as the 2nd arg", /getBookingConfig\(profile\.category, profile\.subcategory\)/.test(pageSrc));
  const routeSrc = read("src/app/[username]/book/page.tsx");
  check("the booking route's profile select includes subcategory", /id, username, name, category, subcategory, theme_color/.test(routeSrc));
}

// ---------------------------------------------------------------- 12. Music/Restaurant call sites and their dedicated cards remain byte-for-byte untouched
{
  const restaurantHero = read("src/components/restaurant/RestaurantHeroButtons.tsx");
  check("RestaurantHeroButtons still calls getBookingConfig with ONLY the category arg (untouched)", /getBookingConfig\(profile\?\.category\)\.buttonLabel/.test(restaurantHero));
  const musicHero = read("src/components/music/MusicHeroButtons.tsx");
  check("MusicHeroButtons still calls getBookingConfig with ONLY the category arg (untouched)", /getBookingConfig\(profile\.category\)\.buttonLabel/.test(musicHero));
  const musicSettings = read("src/components/editor/MusicSettingsCard.tsx");
  check("MusicSettingsCard.tsx never references the new subcategory mechanism", !/getSubcategoryOption|isValidSubcategoryId|SubcategoryOption/.test(musicSettings));
  const restaurantSettings = read("src/components/editor/RestaurantSettingsCard.tsx");
  check("RestaurantSettingsCard.tsx never references the new subcategory mechanism", !/getSubcategoryOption|isValidSubcategoryId|SubcategoryOption/.test(restaurantSettings));
}

// ---------------------------------------------------------------- 13. i18n — both languages define the new picker's own copy
{
  const src = read("src/lib/i18n/translations.ts");
  const enBlock = src.slice(0, src.indexOf("fr:"));
  const frBlock = src.slice(src.indexOf("fr:"));
  check("en editor.category defines subcategoryLabel", /subcategoryLabel:/.test(enBlock));
  check("en editor.category defines subcategoryHint", /subcategoryHint:/.test(enBlock));
  check("fr editor.category defines subcategoryLabel", /subcategoryLabel:/.test(frBlock));
  check("fr editor.category defines subcategoryHint", /subcategoryHint:/.test(frBlock));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\ncategory_subcategories: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
