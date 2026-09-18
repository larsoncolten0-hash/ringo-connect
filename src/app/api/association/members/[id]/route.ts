import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/members/[id]?associationProfileId=... — one
// Member's full detail, including transaction history. Owner only.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data: member } = await supabase
    .from("association_members")
    .select("*, profiles!association_members_linked_profile_id_fkey(username, name, avatar_url)")
    .eq("id", params.id)
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();
  if (!member) return NextResponse.json({ code: "member_not_found", error: "Member not found." }, { status: 404 });

  const { data: transactions } = await supabase
    .from("association_point_transactions")
    .select("*, association_rewards(name), profiles!association_point_transactions_partner_profile_id_fkey(username, name)")
    .eq("member_id", params.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return NextResponse.json({ member, transactions: transactions || [] });
}

// PATCH /api/association/members/[id] — body: { associationProfileId, name?,
// phone?, status? }. Owner only. points_balance is never editable here —
// the only way a balance changes is through the two atomic RPCs.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const associationProfileId = body?.associationProfileId as string | undefined;
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (typeof body?.phone === "string") patch.phone = body.phone.trim().slice(0, 40) || null;
  if (body?.status === "active" || body?.status === "disabled") patch.status = body.status;

  const { data: updated, error } = await createClient()
    .from("association_members")
    .update(patch)
    .eq("id", params.id)
    .eq("association_profile_id", associationProfileId)
    .select("*")
    .single();

  if (error || !updated) return NextResponse.json({ code: "server_error", error: "Could not update this Member." }, { status: 500 });
  return NextResponse.json({ member: updated });
}
