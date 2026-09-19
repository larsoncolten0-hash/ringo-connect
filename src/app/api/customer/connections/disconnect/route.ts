import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { isUuid } from "@/lib/customer/connect";

// Disconnect the signed-in customer from one Ringo profile.
//
// It ONLY flips this one customer_connections row to 'disconnected' (the row
// is kept for history and a later reconnect). It deletes nothing — not the
// customer, purchases, receipts, tickets, bookings, orders or other
// connections — and it does NOT touch marketing consent or any legacy
// community_subscribers row: connection and marketing consent are separate
// concepts. The customer comes from the session cookie only; the request
// body carries just the profile id, and the update is scoped to
// (session customer, that profile, currently active), so it can never affect
// anyone else's connection.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!isUuid(body?.profile_id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("customer_connections")
    .update({ status: "disconnected", disconnected_at: now, updated_at: now })
    .eq("customer_id", session.customer.id)
    .eq("profile_id", body.profile_id)
    .eq("status", "active");

  if (error) {
    console.error("customer disconnect failed:", error.message);
    return NextResponse.json({ error: "Could not disconnect — try again." }, { status: 500 });
  }
  // Idempotent: already-disconnected (or never connected) is the same outcome.
  return NextResponse.json({ ok: true });
}
