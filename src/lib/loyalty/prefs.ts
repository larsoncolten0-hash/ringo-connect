import { createAdminClient } from "@/lib/supabase/server";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// A customer's LOYALTY notification preferences (table customer_loyalty_prefs). A missing row
// means the defaults: everything ON. These are transactional product notifications (progress,
// rewards, packages) and are deliberately kept apart from marketing consent
// (customer_connections.marketing_consent) and from the per-device push permission: turning
// one of them on or off never touches the others, and Loyalty never enables marketing.
//
// `customerId` must come from the authenticated My Ringo session.

export interface LoyaltyPrefs {
  notificationsEnabled: boolean;
  emailEnabled: boolean;
}

export const DEFAULT_LOYALTY_PREFS: LoyaltyPrefs = { notificationsEnabled: true, emailEnabled: true };

export async function getLoyaltyPrefs(customerId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<LoyaltyPrefs> {
  const { data, error } = await admin
    .from("customer_loyalty_prefs")
    .select("notifications_enabled, email_enabled")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("getLoyaltyPrefs failed:", error.message);
    return DEFAULT_LOYALTY_PREFS;
  }
  if (!data) return DEFAULT_LOYALTY_PREFS;
  return { notificationsEnabled: (data as any).notifications_enabled, emailEnabled: (data as any).email_enabled };
}

/** Narrows a request body to the two known booleans; anything else is rejected. */
export function parsePrefsPatch(body: unknown): Partial<LoyaltyPrefs> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<LoyaltyPrefs> = {};
  if (b.notifications_enabled !== undefined) {
    if (typeof b.notifications_enabled !== "boolean") return null;
    patch.notificationsEnabled = b.notifications_enabled;
  }
  if (b.email_enabled !== undefined) {
    if (typeof b.email_enabled !== "boolean") return null;
    patch.emailEnabled = b.email_enabled;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function setLoyaltyPrefs(
  customerId: string,
  patch: Partial<LoyaltyPrefs>,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<LoyaltyPrefs | null> {
  const current = await getLoyaltyPrefs(customerId, admin);
  const next: LoyaltyPrefs = { ...current, ...patch };
  const { error } = await admin.from("customer_loyalty_prefs").upsert(
    {
      customer_id: customerId,
      notifications_enabled: next.notificationsEnabled,
      email_enabled: next.emailEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_id" }
  );
  if (error) {
    console.error("setLoyaltyPrefs failed:", error.message);
    return null;
  }
  return next;
}
