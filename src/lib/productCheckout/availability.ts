// Server-side checkout availability for the UI (item page, checkout page, dashboard editor).
//
// There is ONE eligibility system: checkCommerceEligibility / checkProfileEligibility in
// eligibility.ts — the same rules the order API and create_product_order() enforce. This file only
// gathers the inputs (platform settings need the service-role client) and adds cheap pre-checks so the
// vast majority of product pages never pay for the settings read: music profiles, items with their own
// link, and items with no explicit purchase CTA can never resolve to product checkout.
// Server only.

import { CTA_PRESETS, getRecommendedCta, isCtaPresetId, type CtaPresetId } from "@/lib/cta";
import { createAdminClient } from "@/lib/supabase/server";
import type { CheckoutErrorCode } from "./errors";
import { checkCommerceEligibility, checkProfileEligibility, isMusicProfile } from "./eligibility";
import { createSupabaseStore } from "./supabaseStore";
import type { CommerceSettings, ProductRow, ProfileRow } from "./types";

/** Narrow a `profiles` row (select *) to the fields eligibility needs. Never forwards anything else. */
export function toProfileRow(p: any): ProfileRow {
  return {
    id: p.id,
    user_id: p.user_id,
    username: p.username ?? null,
    currency: p.currency ?? null,
    published: p.published !== false,
    is_demo: p.is_demo === true,
    category: p.category ?? null,
    categories: Array.isArray(p.categories) ? p.categories : [],
  };
}

export function toProductRow(p: any): ProductRow {
  return {
    id: p.id,
    profile_id: p.profile_id,
    name: p.name ?? null,
    price: p.price ?? null,
    available: p.available ?? null,
    inventory_count: p.inventory_count ?? null,
  };
}

/** Does this product's CTA (explicit preset/label, else the category default) mean "purchase"? */
function isExplicitPurchaseCta(product: any, category: string | null): boolean {
  const explicit = !!(product.cta_preset || (typeof product.cta_label === "string" && product.cta_label.trim()));
  if (!explicit) return false; // NULL/NULL never gains a new destination
  const action = isCtaPresetId(product.cta_preset) ? CTA_PRESETS[product.cta_preset as CtaPresetId] : getRecommendedCta(category).action;
  return action === "purchase";
}

type SettingsLoader = () => Promise<CommerceSettings>;
const getSettings: SettingsLoader = () => createSupabaseStore(createAdminClient()).getSettings();

/**
 * Should THIS product page offer product checkout? (true only when the CTA resolver may route to it.)
 * Any failure to read settings counts as "not available" — the safe answer.
 */
export async function computeCheckoutAvailability(profile: any, product: any, load: SettingsLoader = getSettings): Promise<boolean> {
  try {
    if (isMusicProfile(toProfileRow(profile))) return false; // music keeps its own flow
    if (product.landing_url) return false; // the item's own link always wins
    if (!isExplicitPurchaseCta(product, profile.category ?? null)) return false;
    const settings = await load();
    return checkCommerceEligibility({ settings, profile: toProfileRow(profile), product: toProductRow(product), quantity: 1 }) === null;
  } catch {
    return false;
  }
}

/** Profile-level capability for the dashboard editor (product rules are applied per row in the browser). */
export async function computeProfileCheckoutAvailability(profile: any, load: SettingsLoader = getSettings): Promise<boolean> {
  try {
    if (isMusicProfile(toProfileRow(profile))) return false;
    const settings = await load();
    return checkProfileEligibility({ settings, profile: toProfileRow(profile) }) === null;
  } catch {
    return false;
  }
}

/** For the checkout page itself: the exact error code that blocks checkout, or null when it may proceed. */
export async function getCheckoutBlock(profile: any, product: any, quantity = 1, load: SettingsLoader = getSettings): Promise<CheckoutErrorCode | null> {
  try {
    const settings = await load();
    return checkCommerceEligibility({ settings, profile: toProfileRow(profile), product: toProductRow(product), quantity });
  } catch {
    return "commerce_disabled";
  }
}
