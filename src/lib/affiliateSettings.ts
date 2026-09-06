import { createAdminClient } from "@/lib/supabase/server";

// Lives in the same platform_settings row as everything in
// src/lib/platformSettings.ts, but kept in its own file rather than bolted
// onto that one — platformSettings.ts is exclusively payment-provider
// credentials (encrypted secrets, Stripe/Fapshi keys) and is wired into
// the admin Settings page + /api/admin/settings. The affiliate program has
// nothing secret in it and its own dedicated admin page
// (/admin/affiliates), so it gets its own small get/update pair here and
// its own /api/admin/affiliate/settings route — no risk of an affiliate
// change ever touching billing credential handling, or vice versa.

export type AffiliateSettings = {
  affiliateEnabled: boolean;
  /** Fraction, e.g. 0.2 for 20% — see affiliateCommissionRatePct below for the admin-editable form of this. */
  affiliateCommissionRate: number;
  affiliateHoldDays: number;
  affiliateMinPayoutXaf: number;
  affiliateMinPayoutUsd: number;
};

const DEFAULTS: AffiliateSettings = {
  affiliateEnabled: true,
  affiliateCommissionRate: 0.2,
  affiliateHoldDays: 14,
  affiliateMinPayoutXaf: 10000,
  affiliateMinPayoutUsd: 20,
};

export async function getAffiliateSettings(): Promise<AffiliateSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("affiliate_enabled, affiliate_commission_rate, affiliate_hold_days, affiliate_min_payout_xaf, affiliate_min_payout_usd")
    .limit(1)
    .single();

  return {
    affiliateEnabled: data?.affiliate_enabled ?? DEFAULTS.affiliateEnabled,
    affiliateCommissionRate:
      data?.affiliate_commission_rate != null ? Number(data.affiliate_commission_rate) : DEFAULTS.affiliateCommissionRate,
    affiliateHoldDays: data?.affiliate_hold_days ?? DEFAULTS.affiliateHoldDays,
    affiliateMinPayoutXaf:
      data?.affiliate_min_payout_xaf != null ? Number(data.affiliate_min_payout_xaf) : DEFAULTS.affiliateMinPayoutXaf,
    affiliateMinPayoutUsd:
      data?.affiliate_min_payout_usd != null ? Number(data.affiliate_min_payout_usd) : DEFAULTS.affiliateMinPayoutUsd,
  };
}

export type AffiliateSettingsPatch = Partial<{
  affiliateEnabled: boolean;
  /** Admin edits the rate as a whole-number percentage (0-100) — converted to a fraction on write. */
  affiliateCommissionRatePct: number;
  affiliateHoldDays: number;
  affiliateMinPayoutXaf: number;
  affiliateMinPayoutUsd: number;
}>;

/**
 * Only ever call this from an already admin-verified API route (see
 * src/lib/assertAdmin.ts) — like platformSettings.ts, this uses the
 * service-role client and does no permission check of its own.
 */
export async function updateAffiliateSettings(patch: AffiliateSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.affiliateEnabled !== undefined) dbPatch.affiliate_enabled = patch.affiliateEnabled;

  if (patch.affiliateCommissionRatePct !== undefined) {
    const pct = Number(patch.affiliateCommissionRatePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error("Commission rate must be a number between 0 and 100.");
    }
    dbPatch.affiliate_commission_rate = Math.round(pct * 100) / 10000; // e.g. 20 -> 0.2000, keeps 2 decimal places of percentage precision
  }

  if (patch.affiliateHoldDays !== undefined) {
    const days = Number(patch.affiliateHoldDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("Hold period must be a non-negative number of days.");
    dbPatch.affiliate_hold_days = Math.round(days);
  }

  if (patch.affiliateMinPayoutXaf !== undefined) {
    const v = Number(patch.affiliateMinPayoutXaf);
    if (!Number.isFinite(v) || v < 0) throw new Error("Minimum payout must be a non-negative number.");
    dbPatch.affiliate_min_payout_xaf = v;
  }

  if (patch.affiliateMinPayoutUsd !== undefined) {
    const v = Number(patch.affiliateMinPayoutUsd);
    if (!Number.isFinite(v) || v < 0) throw new Error("Minimum payout must be a non-negative number.");
    dbPatch.affiliate_min_payout_usd = v;
  }

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
