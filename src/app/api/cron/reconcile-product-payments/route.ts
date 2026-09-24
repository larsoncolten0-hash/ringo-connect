import crypto from "crypto";
import { NextResponse } from "next/server";
import { reconcileProductPayments } from "@/lib/productCheckout/reconcile";
import { buildCheckoutDeps } from "@/lib/productCheckout/http";

// Reconciliation sweep for product payments: discovers a Fapshi payment that succeeded while the
// customer was no longer watching (closed the tab) and settles it through the SAME idempotent path
// the customer's own polling uses. Safe to run repeatedly and alongside customer polling. Bounded per
// run (see RECONCILE_* constants). No schedule is configured in vercel.json yet.
//
// Protected like the other cron routes (`Authorization: Bearer ${CRON_SECRET}`), but stricter: an unset
// CRON_SECRET rejects everything (never matches a literal "Bearer undefined") and the comparison is
// constant-time. Responses carry counts only — no ids, phone numbers, amounts or error text.
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
    const summary = await reconcileProductPayments(buildCheckoutDeps());
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[product-checkout] reconcile failed:", (err as Error)?.message || err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
