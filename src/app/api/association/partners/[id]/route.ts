import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAssociationAccess } from "@/lib/association/access";

// PATCH /api/association/partners/[id] — body: { status? } (Owner only —
// remove/reactivate a Partner) or { momoNumber? } (the Partner themselves,
// updating their own payment number for this Association). Never both at
// once from the same caller: an Owner can't set another business's MoMo
// number, and a Partner can't change their own active/removed status.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_authenticated", error: "Not authenticated." }, { status: 401 });

  const { data: link } = await supabase
    .from("association_partners")
    .select("id, association_profile_id, partner_profile_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!link) return NextResponse.json({ code: "partner_not_found", error: "Partner link not found." }, { status: 404 });

  const access = await getAssociationAccess(link.association_profile_id, user.id);
  if (!access) return NextResponse.json({ code: "not_authorized", error: "Not authorized." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };

  if (access.isOwner || access.isAdmin) {
    const status = body?.status as string | undefined;
    if (status && status !== "active" && status !== "removed") {
      return NextResponse.json({ code: "invalid_status", error: "Invalid status." }, { status: 400 });
    }
    if (status) patch.status = status;
  } else if (access.isPartner && access.partnerProfileId === link.partner_profile_id) {
    if (typeof body?.momoNumber === "string") patch.momo_number = body.momoNumber.trim().slice(0, 40) || null;
  } else {
    return NextResponse.json({ code: "not_authorized", error: "Not authorized." }, { status: 403 });
  }

  const { data: updated, error } = await supabase.from("association_partners").update(patch).eq("id", params.id).select("*").single();
  if (error || !updated) return NextResponse.json({ code: "server_error", error: "Could not update this Partner." }, { status: 500 });

  return NextResponse.json({ partner: updated });
}
