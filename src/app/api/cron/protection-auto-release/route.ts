import crypto from "crypto";
import { NextResponse } from "next/server";
import { autoReleaseEligibleProtectionTransactions } from "@/lib/protection/release";
import { buildProtectionReleaseDeps } from "@/lib/protection/releaseHttp";

// Auto-release sweep: releases any Protection transaction still `awaiting_confirmation` once its own
// snapshotted auto_release_at deadline has passed, through the SAME idempotent, concurrency-safe
// releaseProtectionTransaction() a customer's own confirmation uses. Safe to run repeatedly and
// concurrently with a customer confirming at the same time — only one of them ever actually
// releases. Bounded per run. Mirrors /api/cron/reconcile-product-payments's own auth exactly; like
// that route, no schedule is added to vercel.json by this phase (not requested, and adding one would
// be a config change outside Phase 6's own scope).
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
    const summary = await autoReleaseEligibleProtectionTransactions(buildProtectionReleaseDeps());
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[protection-release] auto-release sweep failed:", (err as Error)?.message || err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
