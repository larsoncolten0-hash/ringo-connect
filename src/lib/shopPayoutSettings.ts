import { createAdminClient } from "@/lib/supabase/server";

// Lives in the same platform_settings row as everything in src/lib/platformSettings.ts, but kept
// in its own file rather than bolted onto that one — mirrors musicPayoutSettings.ts exactly, one
// per payout-bearing category, edited from /admin/price-controls (see AdminPriceControlsView.tsx)
// rather than the general admin Settings page. commerce_enabled/commerce_commission_rate already
// live in platformSettings.ts (the Commerce Admin Settings increment) and are untouched here —
// this file only owns the two payout-specific knobs Shop didn't have before.

export type ShopPayoutSettings = {
  commercePayoutHoldDays: number;
  commerceMinPayoutXaf: number;
};

const DEFAULTS: ShopPayoutSettings = {
  commercePayoutHoldDays: 3,
  commerceMinPayoutXaf: 5000,
};

export async function getShopPayoutSettings(): Promise<ShopPayoutSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("commerce_payout_hold_days, commerce_min_payout_xaf").limit(1).single();

  return {
    commercePayoutHoldDays: data?.commerce_payout_hold_days ?? DEFAULTS.commercePayoutHoldDays,
    commerceMinPayoutXaf: data?.commerce_min_payout_xaf != null ? Number(data.commerce_min_payout_xaf) : DEFAULTS.commerceMinPayoutXaf,
  };
}

export type ShopPayoutSettingsPatch = Partial<{
  commercePayoutHoldDays: number;
  commerceMinPayoutXaf: number;
}>;

/**
 * Only ever call this from an already admin-verified API route (see src/lib/assertAdmin.ts) —
 * like musicPayoutSettings.ts, this uses the service-role client and does no permission check of
 * its own.
 */
export async function updateShopPayoutSettings(patch: ShopPayoutSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.commercePayoutHoldDays !== undefined) {
    const days = Number(patch.commercePayoutHoldDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("Hold period must be a non-negative number of days.");
    dbPatch.commerce_payout_hold_days = Math.round(days);
  }

  if (patch.commerceMinPayoutXaf !== undefined) {
    const v = Number(patch.commerceMinPayoutXaf);
    if (!Number.isFinite(v) || v < 0) throw new Error("Minimum payout must be a non-negative number.");
    dbPatch.commerce_min_payout_xaf = v;
  }

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
