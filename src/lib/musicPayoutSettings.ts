import { createAdminClient } from "@/lib/supabase/server";

// Lives in the same platform_settings row as everything in
// src/lib/platformSettings.ts and src/lib/affiliateSettings.ts, kept in its
// own file for the same reason affiliateSettings.ts is: nothing secret in
// it, and its own dedicated admin surface (/admin/music-payouts) rather
// than the Fapshi-credentials-focused admin Settings page.

export type MusicPayoutSettings = {
  /** Fraction, e.g. 0.1 for 10% — see musicCommissionRatePct below for the admin-editable form of this. */
  musicCommissionRate: number;
  musicPayoutHoldDays: number;
  musicMinPayoutXaf: number;
};

const DEFAULTS: MusicPayoutSettings = {
  musicCommissionRate: 0.1,
  musicPayoutHoldDays: 3,
  musicMinPayoutXaf: 5000,
};

export async function getMusicPayoutSettings(): Promise<MusicPayoutSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("music_commission_rate, music_payout_hold_days, music_min_payout_xaf")
    .limit(1)
    .single();

  return {
    musicCommissionRate: data?.music_commission_rate != null ? Number(data.music_commission_rate) : DEFAULTS.musicCommissionRate,
    musicPayoutHoldDays: data?.music_payout_hold_days ?? DEFAULTS.musicPayoutHoldDays,
    musicMinPayoutXaf: data?.music_min_payout_xaf != null ? Number(data.music_min_payout_xaf) : DEFAULTS.musicMinPayoutXaf,
  };
}

export type MusicPayoutSettingsPatch = Partial<{
  /** Admin edits the rate as a whole-number percentage (0-100) — converted to a fraction on write. */
  musicCommissionRatePct: number;
  musicPayoutHoldDays: number;
  musicMinPayoutXaf: number;
}>;

/**
 * Only ever call this from an already admin-verified API route (see
 * src/lib/assertAdmin.ts) — like platformSettings.ts/affiliateSettings.ts,
 * this uses the service-role client and does no permission check of its own.
 */
export async function updateMusicPayoutSettings(patch: MusicPayoutSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.musicCommissionRatePct !== undefined) {
    const pct = Number(patch.musicCommissionRatePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error("Commission rate must be a number between 0 and 100.");
    }
    dbPatch.music_commission_rate = Math.round(pct * 100) / 10000;
  }

  if (patch.musicPayoutHoldDays !== undefined) {
    const days = Number(patch.musicPayoutHoldDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("Hold period must be a non-negative number of days.");
    dbPatch.music_payout_hold_days = Math.round(days);
  }

  if (patch.musicMinPayoutXaf !== undefined) {
    const v = Number(patch.musicMinPayoutXaf);
    if (!Number.isFinite(v) || v < 0) throw new Error("Minimum payout must be a non-negative number.");
    dbPatch.music_min_payout_xaf = v;
  }

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
