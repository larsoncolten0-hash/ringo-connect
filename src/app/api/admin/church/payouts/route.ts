import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET the church payout requests waiting to be paid (Ringo administrators only), with the church and the destination the owner chose.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("church_payouts")
    .select("id, profile_id, amount, currency, status, payout_method, payout_details, requested_at, profiles(name, username)")
    .in("status", ["requested", "processing"])
    .order("requested_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: "Could not load the payouts." }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
