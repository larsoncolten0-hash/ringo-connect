import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET the church gift refund requests waiting for a decision (Ringo administrators only). Shows the reason the donor gave and the gift's amount and reference; never the donor's phone or email.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("church_gift_refund_requests")
    .select("id, gift_id, profile_id, reason, status, requested_at, decided_at, decision_note, church_gifts(amount_xaf, external_id, receipt_number, status)")
    .in("status", ["requested", "approved"])
    .order("requested_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: "Could not load the requests." }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
