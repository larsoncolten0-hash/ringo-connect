import { NextResponse } from "next/server";
import { requireAssociationPermission, isUuid } from "@/lib/association/permissions";
import { rpcErrorResponse, str } from "@/lib/association/membership";

// PATCH /api/associations/[associationId]/membership-plans/[planId] — plans.manage. Full replace of the
// editable fields (association_update_plan). Existing memberships keep their own price/date snapshots.
export async function PATCH(request: Request, { params }: { params: { associationId: string; planId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "plans.manage");
  if (!auth.ok) return auth.response;
  if (!isUuid(params.planId)) return NextResponse.json({ code: "plan_not_found" }, { status: 404 });

  const { data: existing } = await auth.admin.from("association_membership_plans").select("association_id").eq("id", params.planId).maybeSingle();
  if (!existing || existing.association_id !== params.associationId) return NextResponse.json({ code: "plan_not_found" }, { status: 404 });

  const b = await request.json().catch(() => ({}));
  const { data, error } = await auth.admin.rpc("association_update_plan", {
    p_plan_id: params.planId,
    p_actor: auth.user.id,
    p_name_en: str(b?.nameEn, 80) ?? "",
    p_name_fr: str(b?.nameFr, 80) ?? "",
    p_description_en: str(b?.descriptionEn, 500),
    p_description_fr: str(b?.descriptionFr, 500),
    p_price_amount: Number.isFinite(Number(b?.priceAmount)) ? Number(b.priceAmount) : 0,
    p_currency: str(b?.currency, 3),
    p_duration_months: b?.durationMonths === null || b?.durationMonths === "" || b?.durationMonths === undefined ? null : Number(b.durationMonths),
    p_grace_days: Number.isFinite(Number(b?.graceDays)) ? Number(b.graceDays) : 0,
    p_sort_order: Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ plan: data });
}
