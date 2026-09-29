import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reconcileAmbassadorLifecycle } from "@/lib/ambassador/reconcile";

// Ambassador Program (Phase C, extended in Phase I) — the daily safety net.
// It still runs the Milestone 2 activation sweep (see
// src/lib/ambassador/activationSweep.ts for why that exists at all), and now
// also recovers interrupted earlier steps and finalizes Fapshi-resolved
// payouts — see src/lib/ambassador/reconcile.ts for exactly which states are
// recovered and which are only reported. Bounded per run, safe to run
// repeatedly, concurrently, and alongside the live hooks: every path ends in
// the same idempotent, state-guarded SQL functions.
//
// Same stricter auth as reconcile-product-payments/route.ts: an unset
// CRON_SECRET rejects everything, constant-time comparison. Response
// carries counts only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = createAdminClient();
    const summary = await reconcileAmbassadorLifecycle(admin);
    // Counts only — never ids, amounts, destinations or customer data (the
    // ids of anything needing manual review go to the server log).
    return NextResponse.json({
      ok: true,
      checked: summary.activationChecked,
      earned: summary.activationEarned,
      salesLocked: summary.salesLocked,
      registrationsCompleted: summary.registrationsCompleted,
      payoutsChecked: summary.payoutsChecked,
      payoutsMarkedUncertain: summary.payoutsMarkedUncertain,
      payoutsFinalized: summary.payoutsFinalized,
      payoutsReverted: summary.payoutsReverted,
      needsReview: summary.integrity.reduce((n, f) => n + f.ids.length, 0),
      stepErrors: summary.stepErrors.length,
    });
  } catch (err) {
    console.error("[ambassador] activation sweep failed:", (err as Error)?.message || err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
