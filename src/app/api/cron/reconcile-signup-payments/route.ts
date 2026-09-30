import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reconcileSignupPayments } from "@/lib/signupPayment";

// Safety net for get-started (signup) payments: finds a payment that succeeded at Fapshi while
// nothing on our side was watching (the customer's tab was closed, the webhook never arrived) and
// records it through the SAME idempotent path the customer's own polling uses — see
// src/lib/signupPayment.ts. Safe to run repeatedly and alongside polling/webhooks. Bounded per run.
// The admin's own screens also confirm on load, so this is the backstop, not the only line.
//
// Protected like the other cron routes (`Authorization: Bearer ${CRON_SECRET}`), but stricter: an
// unset CRON_SECRET rejects everything (never matches a literal "Bearer undefined") and the
// comparison is constant-time. Responses carry counts only — no ids, phone numbers or amounts.
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
    const summary = await reconcileSignupPayments(createAdminClient());
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[signup-payments] reconcile failed:", (err as Error)?.message || err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
