import { createAdminClient } from "@/lib/supabase/server";

// Ringo Protection — Phase 1 admin configuration ONLY. Lives in the same platform_settings row as
// everything else, in its own file mirroring shopPayoutSettings.ts/musicPayoutSettings.ts/
// affiliateSettings.ts exactly — its own dedicated get/update pair, edited from its own card on
// /admin/price-controls, no risk of a Protection change ever touching billing credential handling.
//
// Nothing reads protectionEnabled or protectionFeeRate outside this file and its admin route/UI
// yet — there is no checkout integration, no charge, no release engine. Changing these settings
// today has zero effect on any customer or seller.

export type ProtectionSettings = {
  protectionEnabled: boolean;
  /** Fraction, e.g. 0.03 for 3% — null means "not configured," never a guessed default. */
  protectionFeeRate: number | null;
  protectionAutoReleaseHours: number;
};

const DEFAULTS: ProtectionSettings = {
  protectionEnabled: false,
  protectionFeeRate: null,
  protectionAutoReleaseHours: 48,
};

/**
 * Pure — no DB access. Row shape in, settings shape out, same purpose mapAiSettingsRow() already
 * serves for AI settings: a missing/null row (migration not applied, or genuinely no row yet)
 * degrades to the same safe defaults a real "protection has never been configured" row would —
 * enabled stays false, fee rate stays unset, never a guessed value.
 */
export function mapProtectionSettingsRow(row: Record<string, unknown> | null | undefined): ProtectionSettings {
  if (!row) return DEFAULTS;
  return {
    protectionEnabled: row.protection_enabled === true,
    protectionFeeRate: row.protection_fee_rate != null ? Number(row.protection_fee_rate) : DEFAULTS.protectionFeeRate,
    protectionAutoReleaseHours: typeof row.protection_auto_release_hours === "number" ? row.protection_auto_release_hours : DEFAULTS.protectionAutoReleaseHours,
  };
}

export async function getProtectionSettings(): Promise<ProtectionSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("protection_enabled, protection_fee_rate, protection_auto_release_hours")
    .limit(1)
    .single();

  return mapProtectionSettingsRow(data as Record<string, unknown> | null);
}

export type ProtectionSettingsPatch = Partial<{
  protectionEnabled: boolean;
  /** Admin edits the rate as a whole/decimal percentage (0-100); null explicitly clears it back to "not configured." */
  protectionFeeRatePct: number | null;
  protectionAutoReleaseHours: number;
}>;

/** Pure — no DB access. Returns the fraction to store, or throws a message safe to show the admin. */
export function parseProtectionFeeRatePct(pct: number | null): number | null {
  if (pct === null) return null;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("Protection fee must be a number between 0 and 100 (%).");
  }
  return Math.round(pct * 100) / 10000; // e.g. 3.75 -> 0.0375, keeps 2 decimal places of percentage precision
}

/** Pure — no DB access. */
export function parseProtectionAutoReleaseHours(hours: number): number {
  if (!Number.isInteger(hours) || hours <= 0) {
    throw new Error("Auto-release period must be a positive whole number of hours.");
  }
  return hours;
}

/**
 * Only ever call this from an already admin-verified API route (see src/lib/assertAdmin.ts) —
 * like every settings module in this family, this uses the service-role client and does no
 * permission check of its own. Protection stays OFF unless an admin explicitly flips it: this
 * function never assigns a default fee rate, and never enables the switch on its own.
 */
export async function updateProtectionSettings(patch: ProtectionSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.protectionEnabled !== undefined) dbPatch.protection_enabled = patch.protectionEnabled;

  if (patch.protectionFeeRatePct !== undefined) {
    dbPatch.protection_fee_rate = parseProtectionFeeRatePct(patch.protectionFeeRatePct);
  }

  if (patch.protectionAutoReleaseHours !== undefined) {
    dbPatch.protection_auto_release_hours = parseProtectionAutoReleaseHours(patch.protectionAutoReleaseHours);
  }

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
