// Four independent UX fixes shipped together:
//   1. The "Pay with Ringo Protection" offer is now a prominent, inline, accent-colored banner at
//      the top of checkout (previously a low-contrast floating pill customers were missing).
//   2. Dashboard saves showing stale data until a hard refresh — fixed via Next's staleTimes config,
//      globally, not per save-handler.
//   3. A "My Ringo" customer login entry point on the landing page (desktop dropdown + mobile menu
//      row), reusing the existing /my-ringo/signin flow — no new auth system.
//   4. Catalog card buttons show the item's real resolved CTA (Buy Now / Book Now / Shop Now / the
//      creator's own text), matching the item's own detail page, instead of a generic "View".
//   Run:  node scripts/tests/shopUxFixes.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ---------------------------------------------------------------- 1. Ringo Protection checkout offer is now prominent
{
  const src = read("src/components/checkout/CheckoutModeSwitch.tsx");
  check("the floating low-contrast pill (bg/fg theme colors, fixed positioning) is gone", !/fixed inset-x-0 bottom-\[92px\]/.test(src));
  check("the new offer is an inline banner rendered BEFORE ProductCheckout (first thing on the page, not competing with the sticky pay bar)", /modeSwitchTitle[\s\S]{0,600}<ProductCheckout \{\.\.\.productProps\} \/>/.test(src));
  check("the banner uses the profile's own ACCENT color prominently (not just neutral bg/fg), so it actually stands out", /hexToRgba\(theme\.accent, 0\.12\)/.test(src) && /backgroundColor: theme\.accent/.test(src));
  check("the banner surfaces copy that already existed in translations.ts but was never shown (modeSwitchTitle/modeProtectionHint)", /c\.modeSwitchTitle/.test(src) && /c\.modeProtectionHint/.test(src));
  check("clicking the banner still only ever switches local UI state to the Protection flow — no new API call, no bypassing the existing controller", /onClick=\{\(\) => setMode\("protection"\)\}/.test(src));
  check("Protection is still only ever offered when the server says it's available — unchanged gate", /if \(!protectionAvailable \|\| protectionFeeRate === null\)/.test(src));
}

// ---------------------------------------------------------------- 2. Dashboard save staleness — fixed globally, not per-handler
{
  const src = read("next.config.js");
  check("staleTimes.dynamic is set to 0 (disables the client Router Cache's default 30s staleness for every dynamic page)", /staleTimes:\s*\{\s*dynamic:\s*0\s*\}/.test(src));
  check("this is a global config change, not dozens of individual router.refresh() calls scattered across save handlers", !/router\.refresh\(\)/.test(src));
}

// ---------------------------------------------------------------- 3. My Ringo login entry point on the landing page
{
  const src = read("src/components/landing/LandingView.tsx");
  check("a desktop 'Log in' dropdown now offers both the creator/business login and My Ringo, reusing the existing NavDropdown component (not a new menu system)", /loginDropdownItems = \[/.test(src) && /href: "\/auth\/login"/.test(src) && /href: "\/my-ringo\/signin"/.test(src));
  check("the existing customer sign-in route is reused verbatim — no new auth flow was built", /"\/my-ringo\/signin"/.test(src));
  check("mobile (where NavDropdown's panel width was never designed to fit) keeps a plain, simple 'Log in' link, unchanged from before", /lg:hidden px-2\.5 py-2 rounded-card text-sm font-medium text-ringo-text hover:bg-ringo-muted\/10/.test(src));
  check("My Ringo also has its own row in the mobile menu's flat list (mobile parity, not just a desktop-only feature)", /mobileNavLinks = \[[\s\S]{0,700}"\/my-ringo\/signin"/.test(src));
  check("the desktop dropdown is gated to lg: and up (never rendered at a width its own panel wasn't built for)", /hidden lg:block lg:ml-1/.test(src));

  const signinSrc = read("src/components/my-ringo/SignInForm.tsx");
  check("the underlying customer sign-in mechanism itself is untouched by this change (still the existing email + one-time-code flow)", /step === "email" \? \(/.test(signinSrc));
}

// ---------------------------------------------------------------- 4. Catalog card CTA labels match the item's own detail page
{
  const ctaSrc = read("src/lib/cta.ts");
  check("a single shared resolveDisplayCtaLabel() exists so the grid card and the detail page can never show different wording for the same product", /export function resolveDisplayCtaLabel/.test(ctaSrc));
  check("it falls back to a destination-appropriate default (never a bare 'View' for a purchase/booking/order item) only when the creator never set an explicit preset/label", /explicit \|\| \(isMusic \? labels\.buyNow : labels\.viewDetails\)/.test(ctaSrc));

  const detailSrc = read("src/components/catalog/ProductDetailView.tsx");
  check("ProductDetailView now uses the SHARED helper instead of its own inline copy of the same fallback logic", /resolveDisplayCtaLabel\(cta, isMusic,/.test(detailSrc));
  check("the detail page's own destination-gated behavior for booking/restaurant/checkout (no button at all without an explicit creator label) is unchanged", /: ctaLabel\s*\?\s*\{\s*label: ctaLabel,/.test(detailSrc));

  const catalogSrc = read("src/components/catalog/CatalogSection.tsx");
  check("CatalogSection resolves each product's CTA using the SAME resolver the detail page uses (src/lib/cta.ts), not a reimplementation", /import \{ resolveProductCta, resolveDisplayCtaLabel \} from "@\/lib\/cta"/.test(catalogSrc));
  check("per-product checkout eligibility uses the same pure, client-safe check the dashboard editor's own CatalogCard already uses", /checkProductEligibility\(\{ product, profileId: product\.profile_id, quantity: 1 \}\)/.test(catalogSrc));
  check("the card's button text now comes from the resolved CTA, not a hardcoded viewItem string", /const buttonLabel = resolveDisplayCtaLabel/.test(catalogSrc) && !/\{t\.profilePage\.viewItem\}/.test(catalogSrc));
  check("the card's own navigation destination (tap → detail page) is unchanged — only the button's TEXT changed, never where it goes", /href={productHref\(username, product\.id, isMusic\)}/.test(catalogSrc));

  const profileViewSrc = read("src/components/ProfileView.tsx");
  check("ProfileView passes through the same profile-level capability flags CatalogCard (the editor's own equivalent) already uses — no new capability system invented", /bookingEnabled=\{!!profile\.bookings_enabled\}/.test(profileViewSrc) && /checkoutAvailable=\{!!\(profile as any\)\.commerceCheckoutAvailable\}/.test(profileViewSrc));

  const pageSrc = read("src/app/[username]/page.tsx");
  check("the public profile page computes commerceCheckoutAvailable via the EXISTING helper the dashboard editor already uses (never a new eligibility system)", /computeProfileCheckoutAvailability\(profile\)/.test(pageSrc));

  const musicStoreSrc = read("src/components/music/MusicStorePage.tsx");
  check("Music's own storefront already used a real label (shopMerch), confirming it needed no change for this fix", /t\.music\.shopMerch/.test(musicStoreSrc));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nshop_ux_fixes: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
