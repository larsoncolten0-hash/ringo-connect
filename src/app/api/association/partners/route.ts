import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/partners?associationProfileId=... — every Partner
// link for this Association, newest first. Owner only via the request-
// scoped client, matching the "association_partners read" RLS policy.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("association_partners")
    .select("id, partner_profile_id, momo_number, status, joined_at, created_at, profiles!association_partners_partner_profile_id_fkey(username, name, avatar_url)")
    .eq("association_profile_id", associationProfileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ code: "server_error", error: "Could not load Partners." }, { status: 500 });
  return NextResponse.json({ partners: data });
}
