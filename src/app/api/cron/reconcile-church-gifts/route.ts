import crypto from "crypto";
import { NextResponse } from "next/server";
import { reconcileGifts } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps } from "@/lib/church/giving/gifts/http";

// Reconciliation sweep for church gifts: finds a gift whose Fapshi payment succeeded while the donor was no longer watching (closed the tab) and settles it through the SAME idempotent path the donor's own
// page and the administrator's manual sweep use (reconcileGifts -> refreshGift): the server asks Fapshi about the transaction, a gift is paid ONLY when Fapshi says so, the amount is checked, and settlement
// is one atomic database function, so running this twice, or alongside a donor's page, cannot create a second earning. Bounded per run. It contains no payment logic of its own.
//
// Protected like the shop's sweep (`Authorization: Bearer ${CRON_SECRET}`): an unset or empty CRON_SECRET rejects everything (the literal "Bearer undefined" never matches) and the comparison is constant-time.
// Responses carry counts only: no gift id, phone number, amount or error text.
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
    const summary = await reconcileGifts(buildGiftDeps(), { limit: 50 });
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    console.error(JSON.stringify({ scope: "church_gifts", result: "cron_reconcile_error" }));
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
