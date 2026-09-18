import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/transactions?associationProfileId=... — the Owner
// sees every transaction across the whole Association; a Partner sees only
// the rows THEY logged (their own log, per the product description). This
// is enforced by RLS itself here (the request-scoped client, not the
// admin client) — "association_point_transactions owner read" vs "...
// partner read own" — so there's no risk of this route's own logic
// drifting out of sync with what the database actually allows.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("association_point_transactions")
    .select(
      "id, type, amount_xaf, points_delta, created_at, association_members(name), association_rewards(name), profiles!association_point_transactions_partner_profile_id_fkey(username, name)"
    )
    .eq("association_profile_id", associationProfileId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ code: "server_error", error: "Could not load transactions." }, { status: 500 });
  return NextResponse.json({ transactions: data });
}
