import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSubscriptionReminderSettings } from "@/lib/subscriptionReminderSettings";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { sendEmail } from "@/lib/email/provider";
import { emailShell } from "@/lib/email/emailShell";

// Runs daily via Vercel Cron (see vercel.json). Fapshi mobile money (and
// manual/offline payments) have no stored payment method to auto-charge,
// so a purchase grants a fixed period (plan_expires_at) rather than
// renewing itself the way a Stripe subscription does. This job enforces
// that expiry, now with a grace period and a 3-stage reminder schedule
// (2026-10-08_expiry_reminders.sql) rather than an instant cutoff:
//
//   plan_expires_at - expiringSoonReminderDays  -> "expiring_soon" reminder
//   plan_expires_at                             -> access continues (grace
//                                                   starts); "grace_started"
//                                                   reminder fires
//   plan_expires_at + graceDays - graceEndingReminderDays
//                                                -> "grace_ending_soon" reminder
//   plan_expires_at + graceDays                 -> actually downgraded to Free
//
// SCOPE: only ever touches accounts with a real plan_expires_at. Stripe
// subscriptions renew themselves via webhook and never set
// plan_expires_at at all, so they're excluded by construction — no
// separate payment_provider filter could make this more or less correct,
// but one is kept below anyway as belt-and-suspenders.
//
// IDEMPOTENCY: each reminder stage is sent at most once per (user,
// plan_expires_at) — enforced by subscription_reminder_log's unique
// constraint, not by application logic alone. Candidates are written via
// upsert(..., { ignoreDuplicates: true }).select(), which only returns
// the rows that were actually newly inserted (a conflicting row is
// silently skipped, not returned) — so even if this cron were somehow
// triggered twice concurrently, at most one of the two runs would ever
// see a given (user, stage, plan_expires_at) come back and send it. A
// renewal changes plan_expires_at to a new value, which makes every stage
// for the new cycle eligible again automatically — nothing to reset.
//
// Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` on
// requests it triggers for a configured cron job, as long as CRON_SECRET
// is set as an env var on the project — that's what's being checked here.
// This also means the endpoint is safe to leave public: without the
// correct secret, it just returns 401.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const settings = await getSubscriptionReminderSettings();

  const { data: freePlan, error: freePlanError } = await admin
    .from("plans")
    .select("id")
    .eq("name", "free")
    .single();

  if (freePlanError || !freePlan) {
    console.error("Cron: free plan not found:", freePlanError?.message);
    return NextResponse.json({ error: "Free plan not found" }, { status: 500 });
  }

  // Every fixed-duration account, expired or not — reminders below need
  // the ones still short of plan_expires_at too ("expiring_soon"), not
  // just the already-expired set the old version of this job fetched.
  const { data: fixedDurationUsers, error: fetchError } = await admin
    .from("users")
    .select("id, email, plan_expires_at, payment_provider, plans(display_name, name)")
    .not("plan_expires_at", "is", null);

  if (fetchError) {
    console.error("Cron: failed to fetch fixed-duration users:", fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const candidates = (fixedDurationUsers || []).filter((u) => u.payment_provider !== "stripe");

  const DAY_MS = 24 * 60 * 60 * 1000;
  const graceMs = settings.gracePeriodDays * DAY_MS;
  const expiringSoonMs = settings.expiringSoonReminderDays * DAY_MS;
  const graceEndingMs = settings.graceEndingReminderDays * DAY_MS;
  const nowMs = Date.now();

  const toDowngrade: string[] = [];
  type Stage = "expiring_soon" | "grace_started" | "grace_ending_soon";
  const reminderRows: { user_id: string; stage: Stage; plan_expires_at: string }[] = [];
  // Keeps the user/plan context each reminderRows entry needs for its
  // message, keyed the same way the upsert result below is matched back
  // up by (user_id, stage, plan_expires_at).
  const contextByKey = new Map<string, (typeof candidates)[number]>();
  const keyOf = (userId: string, stage: Stage, expiresAt: string) => `${userId}|${stage}|${expiresAt}`;

  for (const u of candidates) {
    const expiresAtMs = new Date(u.plan_expires_at as string).getTime();
    const graceEndsAtMs = expiresAtMs + graceMs;

    if (nowMs >= graceEndsAtMs) {
      // Past grace entirely — downgraded below, no reminder is useful at
      // this point.
      toDowngrade.push(u.id);
      continue;
    }

    if (nowMs >= expiresAtMs - expiringSoonMs && nowMs < expiresAtMs) {
      reminderRows.push({ user_id: u.id, stage: "expiring_soon", plan_expires_at: u.plan_expires_at as string });
      contextByKey.set(keyOf(u.id, "expiring_soon", u.plan_expires_at as string), u);
    }
    if (nowMs >= expiresAtMs) {
      reminderRows.push({ user_id: u.id, stage: "grace_started", plan_expires_at: u.plan_expires_at as string });
      contextByKey.set(keyOf(u.id, "grace_started", u.plan_expires_at as string), u);
    }
    // Independent `if`, not `else if` — with a short grace period and a
    // grace-ending window close to its length, "grace_started" and
    // "grace_ending_soon" can both become due the same day. That's a
    // platform_settings configuration edge case, not a bug: each stage
    // still only ever sends once, tracked separately.
    if (nowMs >= graceEndsAtMs - graceEndingMs) {
      reminderRows.push({ user_id: u.id, stage: "grace_ending_soon", plan_expires_at: u.plan_expires_at as string });
      contextByKey.set(keyOf(u.id, "grace_ending_soon", u.plan_expires_at as string), u);
    }
  }

  let remindersSent = 0;
  if (reminderRows.length > 0) {
    // ignoreDuplicates: true -> INSERT ... ON CONFLICT DO NOTHING; .select()
    // then returns ONLY the rows that were actually newly inserted, which
    // is what makes this atomic against a stage already sent for this
    // exact plan_expires_at (see the file header's IDEMPOTENCY note).
    const { data: newlyLogged, error: logError } = await admin
      .from("subscription_reminder_log")
      .upsert(reminderRows, { onConflict: "user_id,stage,plan_expires_at", ignoreDuplicates: true })
      .select("user_id, stage, plan_expires_at");

    if (logError) {
      console.error("Cron: failed to write subscription_reminder_log:", logError.message);
    } else {
      for (const row of newlyLogged || []) {
        const u = contextByKey.get(keyOf(row.user_id, row.stage as Stage, row.plan_expires_at));
        if (!u) continue;
        await sendExpiryReminder(admin, u, row.stage as Stage, settings.gracePeriodDays);
        remindersSent++;
      }
    }
  }

  let downgraded = 0;
  if (toDowngrade.length > 0) {
    const { error: updateError } = await admin
      .from("users")
      .update({ plan_id: freePlan.id, payment_provider: null, plan_expires_at: null })
      .in("id", toDowngrade);

    if (updateError) {
      console.error("Cron: failed to downgrade expired users:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // admin_id is NOT NULL in the schema — there's no human admin behind
    // an automated downgrade, so each affected user is recorded as their
    // own actor here, with the automated reason spelled out in `details`.
    await admin.from("admin_audit_log").insert(
      toDowngrade.map((id) => ({
        admin_id: id,
        action: "plan_expired_downgrade",
        target_user_id: id,
        details: { reason: "plan_expires_at + grace period passed without renewal", automated: true },
      }))
    );

    downgraded = toDowngrade.length;
    console.log(`Cron: downgraded ${downgraded} expired account(s) to Free.`);
  }

  return NextResponse.json({ downgraded, remindersSent });
}

/**
 * Best-effort push + email + in-app notification for one reminder stage —
 * failures are logged, never thrown, same posture as every other
 * notification helper in this app (a delivery hiccup must never abort the
 * cron run or leave the subscription_reminder_log row unwritten, since
 * that row is what guarantees this never re-sends).
 */
async function sendExpiryReminder(
  admin: any,
  user: { id: string; email: string | null; plans: any },
  stage: "expiring_soon" | "grace_started" | "grace_ending_soon",
  gracePeriodDays: number
) {
  const planLabel = user.plans?.display_name || user.plans?.name || "your plan";

  const { title, body } =
    stage === "expiring_soon"
      ? {
          title: "Your subscription is expiring soon",
          body: `${planLabel} is about to expire. Renew now to keep your current access.`,
        }
      : stage === "grace_started"
      ? {
          title: "Your subscription has expired",
          body: `${planLabel} has expired, but you keep full access for ${gracePeriodDays} more day${gracePeriodDays === 1 ? "" : "s"}. Renew now to avoid losing access.`,
        }
      : {
          title: "Your grace period is ending soon",
          body: `Renew now — once your grace period ends you'll be moved to the Free plan.`,
        };

  await Promise.allSettled([
    notifyUser(user.id, { type: `subscription_${stage}`, title, body, link: "/dashboard/subscription" }),
    sendPushToUser(admin, user.id, { category: `subscription_${stage}`, title, body, url: "/dashboard/subscription" }),
    user.email
      ? sendEmail({
          to: user.email,
          subject: `${title} — Ringo Connect`,
          html: emailShell(
            `<p style="font-size:14px; margin:0 0 16px;">${body}</p><p style="font-size:14px; margin:0;"><a href="${
              process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com"
            }/dashboard/subscription" style="color:#4f46e5;">Renew your subscription</a></p>`
          ),
          log: { emailType: `subscription_${stage}`, resourceType: "user", resourceId: user.id },
        })
      : Promise.resolve(),
  ]);
}
