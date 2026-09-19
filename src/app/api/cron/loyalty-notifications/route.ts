import { NextResponse } from "next/server";
import { claimExpiringPackages, sweepExpired } from "@/lib/loyalty/engine";
import { notifyExpiringPackages, notifyExpiryEvents } from "@/lib/loyalty/notify";

// Scheduled loyalty job. Two independent parts, each safe to run any number of times, including
// at the same time:
//
//  1. Packages expiring within EXPIRING_WITHIN_DAYS: claimed by loyalty_claim_expiring_packages()
//     (a unique insert into loyalty_notification_log), notified afterwards.
//  2. Expiry maintenance, loyalty_sweep_expired(): in ONE database transaction it closes rewards
//     that are past their expiry, marks ended packages "expired" (their credits and history are
//     untouched), and claims each expiry notification in loyalty_expiry_log. It returns only what
//     THIS run newly claimed, for customers who are still connected.
//
//     database state -> committed -> notifications. Nothing is sent from inside the database, and a
//     push/email failure can never undo the state that was committed.
//
// Expiry itself never depends on this job: every read (customer Rewards page, business customer
// view, overview, and the database functions) already treats a past-expiry reward/package as
// expired. This job keeps the stored state tidy and sends the reminders.
//
// If the process dies after the database commit but before notifications go out, those
// notifications are NOT re-sent later (the claim already exists): a missed reminder is preferred
// over a duplicate.
//
// Auth follows the existing cron convention (Vercel sends `Authorization: Bearer $CRON_SECRET`),
// hardened: an unset OR EMPTY CRON_SECRET rejects everything, so "Bearer undefined" / "Bearer "
// can never authorize.
const EXPIRING_WITHIN_DAYS = 5;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};

  try {
    const claimed = await claimExpiringPackages(EXPIRING_WITHIN_DAYS);
    result.claimed = claimed.length;
    Object.assign(result, await notifyExpiringPackages(claimed));
  } catch (err) {
    console.error("loyalty cron (expiring packages) failed:", (err as any)?.message ?? "unknown error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // The expiry sweep is reported separately: if it cannot run (for example the expiry migration
  // has not been applied yet) the package reminders above still went out, and the failure is
  // visible here and in the logs rather than hidden.
  try {
    const events = await sweepExpired();
    result.expiryEvents = events.length;
    result.expiry = await notifyExpiryEvents(events);
  } catch (err) {
    console.error("loyalty cron (expiry sweep) failed:", (err as any)?.message ?? "unknown error");
    result.expiryFailed = true;
  }

  return NextResponse.json(result);
}
