import { createAdminClient } from "@/lib/supabase/server";

// Lives in the same platform_settings row as everything in
// src/lib/platformSettings.ts/musicPayoutSettings.ts, kept in its own file
// for the same reason those are: nothing secret in it, and it has its own
// card on the /admin/price-controls page rather than belonging to the
// Fapshi-credentials-focused admin Settings page. See
// 2026-10-08_expiry_reminders.sql for the columns and the
// subscription_reminder_log table these settings drive.
//
// SCOPE: every value here only ever applies to fixed-duration accounts
// (payment_provider = 'fapshi' or 'manual', real plan_expires_at) — a
// Stripe subscription renews itself via webhook and never sets
// plan_expires_at at all, so it's naturally outside all of this.

export type SubscriptionReminderSettings = {
  gracePeriodDays: number;
  expiringSoonReminderDays: number;
  graceEndingReminderDays: number;
};

const DEFAULTS: SubscriptionReminderSettings = {
  gracePeriodDays: 5,
  expiringSoonReminderDays: 3,
  graceEndingReminderDays: 2,
};

export async function getSubscriptionReminderSettings(): Promise<SubscriptionReminderSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("grace_period_days, expiring_soon_reminder_days, grace_ending_reminder_days")
    .limit(1)
    .single();

  return {
    gracePeriodDays: data?.grace_period_days ?? DEFAULTS.gracePeriodDays,
    expiringSoonReminderDays: data?.expiring_soon_reminder_days ?? DEFAULTS.expiringSoonReminderDays,
    graceEndingReminderDays: data?.grace_ending_reminder_days ?? DEFAULTS.graceEndingReminderDays,
  };
}

export type SubscriptionBannerState = {
  state: "expiring_soon" | "grace_period";
  /** Always >= 1 — days left until the NEXT deadline (expiry, or grace end). */
  daysRemaining: number;
};

/**
 * The persistent dashboard banner state for one account (see
 * DashboardShell.tsx's subscriptionBanner prop) — reuses the exact same
 * thresholds and grace-period math as the reminder cron
 * (src/app/api/cron/downgrade-expired/route.ts), just read-only and with
 * no notification/idempotency concerns of its own: it's derived fresh on
 * every dashboard page load rather than logged anywhere.
 */
export function getSubscriptionBannerState(
  user: { planExpiresAt: string | null; paymentProvider: string | null },
  settings: SubscriptionReminderSettings
): SubscriptionBannerState | null {
  // Same scope as the cron job — Stripe renews itself via webhook and
  // never sets plan_expires_at, so this is already a no-op for it; the
  // explicit check is belt-and-suspenders, same reasoning as the cron.
  if (!user.planExpiresAt || user.paymentProvider === "stripe") return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const expiresAtMs = new Date(user.planExpiresAt).getTime();
  const graceEndsAtMs = expiresAtMs + settings.gracePeriodDays * DAY_MS;
  const expiringSoonAtMs = expiresAtMs - settings.expiringSoonReminderDays * DAY_MS;

  if (nowMs >= expiringSoonAtMs && nowMs < expiresAtMs) {
    return { state: "expiring_soon", daysRemaining: Math.max(1, Math.ceil((expiresAtMs - nowMs) / DAY_MS)) };
  }
  if (nowMs >= expiresAtMs && nowMs < graceEndsAtMs) {
    return { state: "grace_period", daysRemaining: Math.max(1, Math.ceil((graceEndsAtMs - nowMs) / DAY_MS)) };
  }
  return null;
}

export type SubscriptionReminderSettingsPatch = Partial<{
  gracePeriodDays: number;
  expiringSoonReminderDays: number;
  graceEndingReminderDays: number;
}>;

/**
 * Only ever call this from an already admin-verified API route (see
 * src/lib/assertAdmin.ts) — like musicPayoutSettings.ts, this uses the
 * service-role client and does no permission check of its own.
 */
export async function updateSubscriptionReminderSettings(patch: SubscriptionReminderSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.gracePeriodDays !== undefined) {
    const days = Number(patch.gracePeriodDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("Grace period must be a non-negative number of days.");
    dbPatch.grace_period_days = Math.round(days);
  }

  if (patch.expiringSoonReminderDays !== undefined) {
    const days = Number(patch.expiringSoonReminderDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("\"Expiring soon\" reminder must be a non-negative number of days.");
    dbPatch.expiring_soon_reminder_days = Math.round(days);
  }

  if (patch.graceEndingReminderDays !== undefined) {
    const days = Number(patch.graceEndingReminderDays);
    if (!Number.isFinite(days) || days < 0) throw new Error("\"Grace ending\" reminder must be a non-negative number of days.");
    dbPatch.grace_ending_reminder_days = Math.round(days);
  }

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
