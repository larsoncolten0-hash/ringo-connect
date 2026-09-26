// Structural tests for three unrelated small features shipped together:
//   1. Catalog cards (profile/main page, all categories) show a real labeled
//      button instead of a bare arrow icon.
//   2. A third Ringo Card + Subscription bundle (5,000 FCFA, grants 'pro'
//      monthly) added alongside the existing two (untouched).
//   3. Login page's "Create one" now goes to /get-started, matching the
//      landing page's own primary CTA.
//   Run:  node scripts/tests/catalogCardAndCardBundle.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ---------------------------------------------------------------- 1. Catalog card button
{
  const src = read("src/components/catalog/CatalogSection.tsx");
  check("the bare arrow icon (ArrowUpRight) is gone from the catalog card", !/ArrowUpRight/.test(src));
  check("a real button element renders on every card, using the profile's own button style", /style=\{buttonStyle\}/.test(src) && /t\.profilePage\.viewItem/.test(src));
  check("the button's destination is the same href as the rest of the card (a second way in, not a different action)", /const cls = `group block/.test(src));
  check("price is still shown on the card", /formatPrice\(product\.price, currency\)/.test(src));
  check("description is still shown on the card", /product\.description/.test(src));
  check("CatalogSection now requires buttonStyle/radiusClass props (threaded from the profile's own theme)", /buttonStyle: CSSProperties/.test(src) && /radiusClass: string/.test(src));

  const profileSrc = read("src/components/ProfileView.tsx");
  check("ProfileView passes its own themed buttonStyle/radiusClass into CatalogSection", /<CatalogSection[\s\S]{0,600}radiusClass=\{radiusClass\}[\s\S]{0,600}\/>/.test(profileSrc));
}

// ---------------------------------------------------------------- 2. Third Ringo Card bundle
{
  const migrationSrc = read("supabase/migrations/2026-11-13_ringo_card_pro_bundle.sql");
  check("the new migration is additive/idempotent (guarded insert)", /where not exists \(select 1 from addons where grants_plan_name = 'pro'/.test(migrationSrc));
  check("the new bundle grants the 'pro' plan for 30 days at 5,000 FCFA", /'Ringo Physical Card \(Pro\)', 5000,[\s\S]{0,80}'pro', 30/.test(migrationSrc));
  check("the migration never touches the existing two bundles' price, name, or plan grant — only a display-order (sort_order) bump", !/set\s+(name|price_xaf|grants_plan_name|grants_plan_duration_days)\s*=/.test(migrationSrc.replace(/--.*$/gm, "")));
  check("the migration is transaction-wrapped", /^begin;/m.test(migrationSrc) && /^commit;/m.test(migrationSrc));

  // The plan-granting mechanism itself (cardBundle.ts) is already fully
  // generic over any plan name — confirms no code change was needed there.
  const cardBundleSrc = read("src/lib/cardBundle.ts");
  check("applyCardBundleGrant remains fully generic over any plan name (no hardcoded 'basic')", /planName: string/.test(cardBundleSrc) && !/=== "basic"/.test(cardBundleSrc.replace(/\/\/.*$/gm, "")));

  const dashSrc = read("src/components/dashboard/CardBundleSection.tsx");
  check("CardBundleSection no longer hardcodes 'Basic' — it reads the addon's own grants_plan_name", !/of Basic/.test(dashSrc) && /grants_plan_name/.test(dashSrc));
  check("CardBundleSection's grid is dynamic (3 columns once there are 3+ bundles, not a fixed 2-up)", /bundles\.length >= 3.*sm:grid-cols-3/.test(dashSrc));
  check("CardBundleSection's text is bilingual (t.cardBundle.*), not new hardcoded English", /t\.cardBundle\.title/.test(dashSrc) && /t\.cardBundle\.buyCta/.test(dashSrc));

  const ringoCardPageSrc = read("src/app/dashboard/ringo-card/page.tsx");
  check("the dashboard's own bundle query now selects grants_plan_name", /select\("id, name, price_xaf, grants_plan_duration_days, grants_plan_name"\)/.test(ringoCardPageSrc));

  const pricingSrc = read("src/components/landing/PricingSection.tsx");
  check("the landing page's card-bundle grid is dynamic (3 columns once there are 3+ bundles, not a fixed 2-up)", /bundleAddons\.length >= 3.*max-w-5xl sm:grid-cols-3/.test(pricingSrc));

  const flowSrc = read("src/components/onboarding/GetStartedFlow.tsx");
  check("the bundle picker no longer hardcodes 'the two' bundle options", !/the two card \+ subscription bundle options/.test(flowSrc));
  check("the bundle picker's subtitle is bilingual (t.getStarted.bundlePickerSubtitle)", /t\.getStarted\.bundlePickerSubtitle/.test(flowSrc));
  check("mutual exclusion between bundles is generic over any number of bundles (not hardcoded to 2)", /bundleAddons\.some\(\(b\) => b\.id === id\)/.test(flowSrc));

  const i18nSrc = read("src/lib/i18n/translations.ts");
  const enBlock = i18nSrc.slice(0, i18nSrc.indexOf("fr:"));
  const frBlock = i18nSrc.slice(i18nSrc.indexOf("fr:"));
  for (const key of ["bundlePickerSubtitle"]) {
    check(`en getStarted defines ${key}`, new RegExp(`${key}:`).test(enBlock));
    check(`fr getStarted defines ${key}`, new RegExp(`${key}:`).test(frBlock));
  }
  check("en cardBundle namespace exists with all required keys", /cardBundle:\s*\{\s*title:/.test(enBlock) && /includes:/.test(enBlock.match(/cardBundle:[\s\S]{0,400}/)?.[0] ?? ""));
  check("fr cardBundle namespace exists with all required keys", /cardBundle:\s*\{\s*title:/.test(frBlock) && /includes:/.test(frBlock.match(/cardBundle:[\s\S]{0,400}/)?.[0] ?? ""));
  check("the accountTypeCardDesc copy no longer claims 'Basic-tier' specifically (a Pro-granting bundle exists now too)", !/Basic-tier access/.test(enBlock) && !/l'accès Basic/.test(frBlock));
}

// ---------------------------------------------------------------- 3. Login page "Create one" -> /get-started
{
  const loginSrc = read("src/app/auth/login/page.tsx");
  check("login's 'Create one' now links to /get-started, matching the landing page's own primary CTA", /href="\/get-started"[\s\S]{0,120}Create one/.test(loginSrc));
  check("the old self-serve /auth/signup link is no longer used for this button", !/href="\/auth\/signup"/.test(loginSrc));

  const landingSrc = read("src/components/landing/LandingView.tsx");
  check("the landing page's own primary CTA is still /get-started (unchanged)", /const primaryHref = isLoggedIn \? dashboardHref : "\/get-started"/.test(landingSrc));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\ncatalog_card_and_card_bundle: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
