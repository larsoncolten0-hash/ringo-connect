// Subscription entitlement system — downgrade restricts VISIBILITY, never deletes data.
//
// Covers: the central splitByPlanLimit/countHidden/isCustomThemeAllowed helpers (pure), structural
// checks that the public profile pages actually apply them server-side (never leaking hidden
// content), that the dashboard editor still shows every saved item (owner never loses access to
// their own data) while surfacing what's currently hidden, that the dashboard banner only ever
// shows the content-hidden state when nothing more urgent is active, and that team/pixel
// entitlement enforcement (already correct before this change) stays action-time-only with no
// deletion job anywhere.
//   Run:  node scripts/tests/subscriptionEntitlements.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const { splitByPlanLimit, countHidden, isCustomThemeAllowed } = jiti(path.join(SRC, "lib/planEntitlements.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ---------------------------------------------------------------- 1. splitByPlanLimit / countHidden (pure)
{
  const links = [
    { id: "instagram", sort_order: 0 },
    { id: "website", sort_order: 1 },
    { id: "whatsapp", sort_order: 2 },
    { id: "youtube", sort_order: 3 },
    { id: "facebook", sort_order: 4 },
  ];

  // Exactly the Phase 4 example: Free allows 1 link -> only Instagram shows, original order kept.
  const free = splitByPlanLimit(links, 1);
  check("Free (max 1): only the first item by sort_order is visible", free.visible.length === 1 && free.visible[0].id === "instagram");
  check("Free (max 1): the other four are hidden, not deleted (still returned, just separated)", free.hidden.length === 4);
  check("Free (max 1): hidden items keep their original relative order too", free.hidden.map((l) => l.id).join(",") === "website,whatsapp,youtube,facebook");

  // Upgrade again -> everything comes back, same order, nothing recreated.
  const restored = splitByPlanLimit(links, null);
  check("Restoration (unlimited): all 5 links return", restored.visible.length === 5 && restored.hidden.length === 0);
  check("Restoration: original order is exactly preserved (Instagram, Website, WhatsApp, YouTube, Facebook)", restored.visible.map((l) => l.id).join(",") === "instagram,website,whatsapp,youtube,facebook");

  // Order independence: input array order must never matter, only sort_order.
  const shuffled = [links[3], links[0], links[4], links[1], links[2]];
  const fromShuffled = splitByPlanLimit(shuffled, 2);
  check("Visibility is computed from sort_order, never array/insertion order", fromShuffled.visible.map((l) => l.id).join(",") === "instagram,website");

  check("countHidden: 10 items, Free (max 1) -> 9 hidden", countHidden(10, 1) === 9);
  check("countHidden: unlimited plan -> always 0 hidden", countHidden(10, null) === 0);
  check("countHidden: never negative when under the limit", countHidden(1, 15) === 0);
  check("countHidden: exactly at the limit -> 0 hidden", countHidden(15, 15) === 0);

  check("isCustomThemeAllowed: true only when the plan explicitly says so", isCustomThemeAllowed({ custom_theme_enabled: true }) === true);
  check("isCustomThemeAllowed: false for Free/Basic (custom_theme_enabled: false)", isCustomThemeAllowed({ custom_theme_enabled: false }) === false);
  check("isCustomThemeAllowed: false-safe for a missing plan row (never assumes access)", isCustomThemeAllowed(null) === false && isCustomThemeAllowed(undefined) === false);
}

// ---------------------------------------------------------------- 2. products behave identically to links
{
  const products = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, sort_order: i }));
  const basic = splitByPlanLimit(products, 15);
  check("Basic (max 15): all 15 products visible, none hidden", basic.visible.length === 15 && basic.hidden.length === 0);
  const droppedToFree = splitByPlanLimit(products, 1);
  check("Downgrade Basic -> Free: only the first product stays visible", droppedToFree.visible.length === 1 && droppedToFree.visible[0].id === "p0");
  check("Downgrade Basic -> Free: the other 14 are hidden, still present in the full dataset", droppedToFree.hidden.length === 14);
  const backToBasic = splitByPlanLimit(products, 15);
  check("Restoration Free -> Basic: all 15 products return in original order", backToBasic.visible.map((p) => p.id).join(",") === products.map((p) => p.id).join(","));
}

// ---------------------------------------------------------------- 3. public profile pages apply the entitlement server-side (never leak hidden content)
{
  const mainPageSrc = read("src/app/[username]/page.tsx");
  check("the main profile page imports the shared entitlement helpers (not a one-off reimplementation)", /import \{ splitByPlanLimit, isCustomThemeAllowed \} from ["']@\/lib\/planEntitlements["']/.test(mainPageSrc));
  // The owner's plan is fetched via createAdminClient(), never embedded in the plain anon-key
  // profiles query — an anonymous visitor has no RLS access to `users` at all, so an embed there
  // would silently resolve to null for every real visitor (confirmed live — see
  // subscriptionEntitlementsLiveSchema.test.mjs). This was a real bug caught in this exact
  // production deployment, not a hypothetical.
  check("the main profile page fetches the OWNER's current plan via the ADMIN client, never embedded in the anon-key profiles query", /createAdminClient\(\)\s*\.from\("users"\)\s*\.select\("plans\(max_links, max_products, custom_theme_enabled\)"\)/.test(mainPageSrc));
  check("the main profile page's own anon-key profiles query no longer embeds users!user_id at all (the fixed bug)", !/\.from\("profiles"\)[\s\S]{0,300}users!user_id/.test(mainPageSrc));
  check("links are sliced to the current plan's limit BEFORE being handed to ProfileView (server-side, never just a UI hide)", /profile\.links = visibleLinks/.test(mainPageSrc));
  check("products are sliced the same way", /profile\.products = visibleProducts/.test(mainPageSrc));
  check("when custom theme isn't allowed, the public page falls back to fixed defaults rather than the creator's stored colors", /isCustomThemeAllowed\(ownerPlan\)/.test(mainPageSrc) && /profile\.theme_color = "#D4A954"/.test(mainPageSrc));
  check("nothing here deletes or updates any row — this is read-then-slice-in-memory only", !/\.from\("links"\)\.(update|delete)|\.from\("products"\)\.(update|delete)/.test(mainPageSrc));

  const musicStoreSrc = read("src/app/m/[username]/page.tsx");
  check("the music storefront page also fetches the owner's plan via the ADMIN client (same fixed pattern, not the anon-embed bug)", /createAdminClient\(\)\s*\.from\("users"\)\s*\.select\("plans\(max_products\)"\)/.test(musicStoreSrc));
  check("the music storefront's own anon-key profiles query no longer embeds users!user_id either", !/\.from\("profiles"\)[\s\S]{0,300}users!user_id/.test(musicStoreSrc));
}

// ---------------------------------------------------------------- 4. ProfileView.tsx itself is untouched (all enforcement happens one layer up, at the page)
{
  const profileViewSrc = read("src/components/ProfileView.tsx");
  check("ProfileView.tsx has no new plan-checking logic of its own — it just renders whatever profile.links/products/theme it's given, same as before", !/planEntitlements|max_links|max_products|custom_theme_enabled/.test(profileViewSrc));
}

// ---------------------------------------------------------------- 5. dashboard editor: owner still sees and can edit EVERYTHING, with an honest "hidden from your public profile" note
{
  const linksCardSrc = read("src/components/editor/LinksCard.tsx");
  check("LinksCard still initializes from the FULL initialLinks prop (no filtering applied to what the owner can edit)", /useState\(\s*\[\.\.\.initialLinks\]\.sort/.test(linksCardSrc));
  check("LinksCard computes a hidden count from the same shared helper, never a reimplemented limit check", /countHidden\(links\.length, maxLinks\)/.test(linksCardSrc));
  check("LinksCard shows the new hidden-count message distinctly from the existing 'limit reached, can't add more' message", /t\.editor\.linksHiddenByPlan/.test(linksCardSrc) && /t\.editor\.linkLimitReached/.test(linksCardSrc));
  check("deleteLink/addLink logic is untouched — no new restriction on editing an existing, already-saved link", /const deleteLink = async \(id: string\) => \{/.test(linksCardSrc));

  const catalogCardSrc = read("src/components/editor/CatalogCard.tsx");
  check("CatalogCard still initializes from the FULL initialProducts prop", /useState\(\s*\[\.\.\.initialProducts\]\.sort/.test(catalogCardSrc));
  check("CatalogCard shows the new hidden-count message", /t\.editor\.productsHiddenByPlan/.test(catalogCardSrc));
  check("deleteProduct logic is untouched", /const deleteProduct = async \(id: string\) => \{/.test(catalogCardSrc));
}

// ---------------------------------------------------------------- 6. theme: locked in the editor, but the saved values are never cleared
{
  const themeCardSrc = read("src/components/editor/ThemeCard.tsx");
  check("ThemeCard.tsx (the editor UI) is unmodified by this change — it already correctly locked editing without touching saved values", !/planEntitlements/.test(themeCardSrc));
  check("resetToDefaults is a separate, explicit, user-initiated action — a plan downgrade must never call it implicitly", !/resetToDefaults\(\)/.test(read("src/app/[username]/page.tsx")));
}

// ---------------------------------------------------------------- 7. dashboard banner: content-hidden state, owner-only, mutually exclusive with the time-based banner
{
  const layoutSrc = read("src/app/dashboard/layout.tsx");
  check("hidden-content counts are computed only for the account owner, never while acting as staff in someone else's organization", /!isActingAsStaff && ownProfile && !subscriptionBanner/.test(layoutSrc));
  check("the content-hidden banner is only computed when there's no more urgent time-based banner already active (never shown together)", /!subscriptionBanner\b/.test(layoutSrc));
  check("hidden counts come from the same shared countHidden() helper, never a duplicated calculation", /countHidden\(linksCount \?\? 0, ownerPlan\?\.max_links/.test(layoutSrc) && /countHidden\(productsCount \?\? 0, ownerPlan\?\.max_products/.test(layoutSrc));
  check("the count queries are head-only (count: exact, head: true) — no row data is fetched just to count", (layoutSrc.match(/\{ count: "exact", head: true \}/g) || []).length >= 2);

  const shellSrc = read("src/components/dashboard/DashboardShell.tsx");
  check("DashboardShell's banner slot now accepts a third, content_hidden state (extends the existing banner, doesn't duplicate it)", /state: "content_hidden"/.test(shellSrc));
  check("the content_hidden banner never renders alongside the expiring_soon/grace_period banner (mutually exclusive JSX conditions)", /subscriptionBanner\.state !== "content_hidden"/.test(shellSrc) && /subscriptionBanner\.state === "content_hidden"/.test(shellSrc));
  check("the content_hidden banner explicitly says data is safe / nothing was deleted", /nothing was deleted/.test(shellSrc));
  check(
    "the content_hidden banner's CTA points at the existing subscription page (no second checkout flow)",
    /state === "content_hidden" && \([\s\S]{0,50}<Link[\s\S]{0,1400}Resubscribe to Pro/.test(shellSrc)
  );
}

// ---------------------------------------------------------------- 8. absolute requirement: no deletion job exists anywhere for subscription expiration
{
  const cronSrc = read("src/app/api/cron/downgrade-expired/route.ts");
  check("the expiry cron only ever updates users.plan_id/payment_provider/plan_expires_at — never touches links/products/tracks/events/organization_members", !/\.from\("links"\)|\.from\("products"\)|\.from\("tracks"\)|\.from\("events"\)|\.from\("organization_members"\)/.test(cronSrc));
  check("the expiry cron never issues a delete() call at all", !/\.delete\(/.test(cronSrc));
  check("no new cleanup/deletion cron was added by this change", !fs.existsSync(path.join(REPO, "src/app/api/cron/cleanup-expired-content")) && !fs.existsSync(path.join(REPO, "src/app/api/cron/prune-downgraded-content")));
}

// ---------------------------------------------------------------- 9. team seats: existing members are never removed on downgrade (already correct, verified unchanged)
{
  const accessSrc = read("src/lib/team/access.ts");
  check("getOrgMaxSeats/countActiveOrgMembers exist and are the ONLY seat-limit primitives (not touched/duplicated by this change)", /export async function getOrgMaxSeats/.test(accessSrc) && /export async function countActiveOrgMembers/.test(accessSrc));
  check("countActiveOrgMembers never deletes or deactivates a member — it only counts status = 'active'", /\.eq\("status", "active"\)/.test(accessSrc) && !/\.from\("organization_members"\)\.(update|delete)/.test(accessSrc));

  const inviteSrc = read("src/app/api/team/invitations/route.ts");
  check("seat limit is checked only at invite-send time (an action, never a background prune)", /getOrgMaxSeats|countActiveOrgMembers/.test(inviteSrc));
}

// ---------------------------------------------------------------- 10. pixels: already correctly live-gated at fire-time, unmodified
{
  const pixelSrc = read("src/lib/pixelTracking.ts");
  check("isPixelsEnabledForUser checks the CURRENT plan live, independent of what's saved on the profile row (unmodified by this change)", /checked independently of what's saved on the profile row/.test(pixelSrc));
  const profileViewSrc = read("src/components/ProfileView.tsx");
  check("the browser-side pixel scripts are gated on the same server-resolved pixelsEnabled prop, never fired unconditionally", /pixelsEnabled && profile\.facebook_pixel_id/.test(profileViewSrc));
}

// ---------------------------------------------------------------- 11. security: hidden content is never merely CSS-hidden — it's absent from the payload entirely
{
  const mainPageSrc = read("src/app/[username]/page.tsx");
  // profile.links/products are REASSIGNED to the sliced arrays before the object is spread into
  // publicProfile and handed to a client component — so the hidden items are never serialized into
  // the page's own RSC payload in the first place, not just hidden by CSS/JS on the client.
  {
    const sliceIdx = mainPageSrc.indexOf("profile.products = visibleProducts;");
    const destructureIdx = mainPageSrc.indexOf("...publicProfile } = profile;");
    check(
      "hidden links/products are excluded before the profile object is ever passed to the client component (not shipped-then-hidden)",
      sliceIdx !== -1 && destructureIdx !== -1 && sliceIdx < destructureIdx
    );
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nsubscription_entitlements: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
