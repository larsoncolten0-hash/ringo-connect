import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToCustomer } from "@/lib/customer/push";
import { sendLoyaltyEmail } from "@/lib/email/sendLoyaltyEmail";
import { buildPush, EMAIL_KINDS, LOYALTY_PUSH_URL, type LoyaltyMessage } from "@/lib/loyalty/notifyMessages";
import type { ExpiringPackage, ExpiryEvent, LoyaltyAdmin, RecordResult, RedeemResult } from "@/lib/loyalty/engine";
import type { Locale } from "@/lib/i18n/translations";

// The ONE place loyalty notifications are delivered.
//
//   loyalty action -> database transaction decides the milestone / reward / package event
//                  -> transaction has SUCCEEDED (only then is anything here called)
//                  -> this service: push if enabled, email if enabled + verified
//                  -> failures are logged and swallowed: they can never affect the action
//
// Rules this file enforces:
//  * The recipient is ALWAYS a customer id the SERVER resolved (from an active connection, or
//    from a database row in the cron). Nothing here accepts an address, endpoint or id from a
//    browser, and a business can only reach customers it is connected to.
//  * These are transactional product notifications. customer_connections.marketing_consent is
//    never read; it neither allows nor blocks anything here. Only customer_loyalty_prefs decides,
//    and a preferences read that FAILS means "do not send" (fail closed).
//  * Push goes through the existing sendPushToCustomer() -> customer_push_subscriptions (the
//    same My Ringo service worker). Creator/admin/fan push_subscriptions are never touched.
//  * Milestones (near_2, near_1, unlocked, redeemed, package_expiring) arrive ALREADY claimed by
//    the database (loyalty_notification_log), so each is delivered at most once; this layer does
//    not recalculate progress or dedupe anything itself.
//  * No community_subscribers row is ever created, and no console output contains customer data.

export type DeliveryReport = {
  push: "delivered" | "not_delivered" | "skipped_prefs" | "failed";
  email: "sent" | "skipped_prefs" | "skipped_unverified" | "skipped_kind" | "failed";
};

export const NOTIFY_TIMEOUT_MS = 5000;

const TIMEOUT = Symbol("timeout");
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const logFailure = (kind: string, err: unknown) => console.error(`loyalty notification (${kind}) failed:`, (err as any)?.message ?? "unknown error");

/**
 * Deliver one loyalty message to one customer. Never throws. `options.timeoutMs` bounds each
 * channel so a slow push/email provider cannot hold up the staff member's request.
 */
export async function deliverLoyaltyNotification(
  customerId: string,
  message: LoyaltyMessage,
  options: { timeoutMs?: number } = {},
  admin: LoyaltyAdmin = createAdminClient()
): Promise<DeliveryReport> {
  const report: DeliveryReport = { push: "failed", email: "failed" };
  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;
  try {
    // Preferences: fail CLOSED. An unreadable preference must never turn into a notification.
    const { data: prefsRow, error: prefsError } = await admin
      .from("customer_loyalty_prefs")
      .select("notifications_enabled, email_enabled")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (prefsError) {
      logFailure(message.kind, prefsError);
      return { push: "skipped_prefs", email: "skipped_prefs" };
    }
    // No row means the documented defaults: everything ON.
    const notificationsEnabled = prefsRow ? (prefsRow as any).notifications_enabled !== false : true;
    const emailEnabled = prefsRow ? (prefsRow as any).email_enabled !== false : true;
    if (!notificationsEnabled) return { push: "skipped_prefs", email: "skipped_prefs" };

    const { data: customer, error: customerError } = await admin
      .from("ringo_customers")
      .select("email, email_verified_at, preferred_language")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError || !customer) {
      logFailure(message.kind, customerError ?? new Error("customer not found"));
      return report;
    }
    const locale: Locale = (customer as any).preferred_language === "en" ? "en" : "fr";

    // ---- push (existing My Ringo customer push) ----
    try {
      const built = buildPush(message, locale);
      const sent = await withTimeout(
        sendPushToCustomer(customerId, { category: built.category, title: built.title, body: built.body, url: LOYALTY_PUSH_URL, data: { kind: message.kind } }),
        timeoutMs
      );
      report.push = sent === TIMEOUT ? "failed" : sent ? "delivered" : "not_delivered";
      if (sent === TIMEOUT) logFailure(message.kind, new Error("push timed out"));
    } catch (err) {
      report.push = "failed";
      logFailure(message.kind, err);
    }

    // ---- email (supplementary; verified address only) ----
    if (!EMAIL_KINDS.has(message.kind)) {
      report.email = "skipped_kind";
    } else if (!emailEnabled) {
      report.email = "skipped_prefs";
    } else if (!(customer as any).email_verified_at || !(customer as any).email) {
      report.email = "skipped_unverified";
    } else {
      try {
        const result = await withTimeout(sendLoyaltyEmail((customer as any).email, message, locale), timeoutMs);
        report.email = result !== TIMEOUT && result.ok ? "sent" : "failed";
        if (report.email === "failed") logFailure(message.kind, new Error(result === TIMEOUT ? "email timed out" : result.error ?? "email not sent"));
      } catch (err) {
        report.email = "failed";
        logFailure(message.kind, err);
      }
    }
    return report;
  } catch (err) {
    logFailure(message.kind, err);
    return report;
  }
}

// ---------------------------------------------------------------------
// Entry points used by the routes AFTER their database call succeeded.
// Each one is best-effort and never throws.
// ---------------------------------------------------------------------

/** After loyalty_record_activity: send the milestones the database newly claimed (near_2, near_1, unlocked). */
export async function notifyAfterRecord(
  input: { customerId: string; profileId: string; businessName: string; programId: string; result: RecordResult },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<DeliveryReport[]> {
  const wanted = input.result.notify.filter((m) => m === "near_2" || m === "near_1" || m === "unlocked");
  if (wanted.length === 0) return [];
  try {
    const { data: program } = await admin
      .from("loyalty_programs")
      .select("action_key, reward_title")
      .eq("id", input.programId)
      .eq("profile_id", input.profileId)
      .maybeSingle();
    if (!program) return [];
    const reports: DeliveryReport[] = [];
    for (const milestone of wanted) {
      const message: LoyaltyMessage =
        milestone === "unlocked"
          ? { kind: "unlocked", business: input.businessName, reward: (program as any).reward_title }
          : { kind: "near", remaining: milestone === "near_2" ? 2 : 1, business: input.businessName, actionKey: (program as any).action_key };
      reports.push(await deliverLoyaltyNotification(input.customerId, message, {}, admin));
    }
    return reports;
  } catch (err) {
    logFailure("record", err);
    return [];
  }
}

/** After loyalty_redeem_reward. */
export async function notifyAfterRedeem(
  input: { customerId: string | null; businessName: string; result: RedeemResult },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<DeliveryReport[]> {
  if (!input.customerId || input.result.outcome !== "redeemed" || !input.result.notify.includes("redeemed") || !input.result.title) return [];
  return [await deliverLoyaltyNotification(input.customerId, { kind: "redeemed", business: input.businessName, reward: input.result.title }, {}, admin)];
}

/** After a package was newly activated for a connected customer. */
export async function notifyPackageActivated(
  input: { customerId: string; profileId: string; businessName: string; packageId: string | null },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<DeliveryReport[]> {
  if (!input.packageId) return [];
  try {
    const { data: pkg } = await admin
      .from("loyalty_packages")
      .select("name_snapshot, ends_at")
      .eq("id", input.packageId)
      .eq("profile_id", input.profileId)
      .eq("customer_id", input.customerId)
      .maybeSingle();
    if (!pkg) return [];
    return [
      await deliverLoyaltyNotification(input.customerId, { kind: "package_activated", business: input.businessName, name: (pkg as any).name_snapshot, endsAt: (pkg as any).ends_at }, {}, admin),
    ];
  } catch (err) {
    logFailure("package_activated", err);
    return [];
  }
}

/** After a package credit was used; `remaining` is the balance the database returned. */
export async function notifyPackageUsed(
  input: { customerId: string; profileId: string; businessName: string; packageId: string | null; actionKey: string | null; remaining: number | null },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<DeliveryReport[]> {
  if (!input.packageId || !input.actionKey || input.remaining === null) return [];
  try {
    const { data: pkg } = await admin
      .from("loyalty_packages")
      .select("name_snapshot")
      .eq("id", input.packageId)
      .eq("profile_id", input.profileId)
      .eq("customer_id", input.customerId)
      .maybeSingle();
    if (!pkg) return [];
    return [
      await deliverLoyaltyNotification(
        input.customerId,
        { kind: "package_used", business: input.businessName, name: (pkg as any).name_snapshot, actionKey: input.actionKey, remaining: input.remaining },
        {},
        admin
      ),
    ];
  } catch (err) {
    logFailure("package_used", err);
    return [];
  }
}

/**
 * Cron: notify for expiry events the database has JUST claimed (reward expiring soon, reward
 * expired, package expired). The state change is already committed and each event was claimed by
 * exactly one sweep, so this cannot double-send, and a delivery failure changes nothing.
 */
export async function notifyExpiryEvents(
  events: ExpiryEvent[],
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ delivered: number; skipped: number; failed: number }> {
  const tally = { delivered: 0, skipped: 0, failed: 0 };
  const businessNames = new Map<string, string>();
  for (const e of events) {
    try {
      let business = businessNames.get(e.profileId);
      if (business === undefined) {
        const { data: profile } = await admin.from("profiles").select("name, username").eq("id", e.profileId).maybeSingle();
        business = (profile as any)?.name || (profile as any)?.username || "";
        businessNames.set(e.profileId, business as string);
      }
      const message: LoyaltyMessage =
        e.event === "reward_expiring"
          ? { kind: "reward_expiring", business: business as string, reward: e.title, endsAt: e.at }
          : e.event === "reward_expired"
          ? { kind: "reward_expired", business: business as string, reward: e.title }
          : { kind: "package_expired", business: business as string, name: e.title, remaining: e.remaining ?? 0 };
      const report = await deliverLoyaltyNotification(e.customerId, message, {}, admin);
      if (report.push === "delivered" || report.email === "sent") tally.delivered++;
      else if (report.push === "failed" || report.email === "failed") tally.failed++;
      else tally.skipped++;
    } catch (err) {
      tally.failed++;
      logFailure(e.event, err);
    }
  }
  return tally;
}

/**
 * Cron: notify for packages the database has JUST claimed as "expiring soon" (each package is
 * returned by exactly one run, so this cannot double-send even with concurrent runs).
 */
export async function notifyExpiringPackages(
  claimed: ExpiringPackage[],
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ delivered: number; skipped: number; failed: number }> {
  const tally = { delivered: 0, skipped: 0, failed: 0 };
  for (const p of claimed) {
    try {
      const [{ data: profile }, { data: credits }] = await Promise.all([
        admin.from("profiles").select("name, username").eq("id", p.profileId).maybeSingle(),
        admin.from("loyalty_package_credits").select("total, used, carried_out").eq("package_id", p.packageId),
      ]);
      const remaining = ((credits ?? []) as any[]).reduce((sum, c) => sum + (c.total - c.used - c.carried_out), 0);
      const business = (profile as any)?.name || (profile as any)?.username || "";
      const report = await deliverLoyaltyNotification(p.customerId, { kind: "package_expiring", business, name: p.name, endsAt: p.endsAt, remaining }, {}, admin);
      if (report.push === "delivered" || report.email === "sent") tally.delivered++;
      else if (report.push === "failed" || report.email === "failed") tally.failed++;
      else tally.skipped++;
    } catch (err) {
      tally.failed++;
      logFailure("package_expiring", err);
    }
  }
  return tally;
}
