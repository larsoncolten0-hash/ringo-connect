import { NextResponse } from "next/server";
import { requireAssociationPermission } from "@/lib/association/permissions";
import { rpcErrorResponse, str } from "@/lib/association/membership";

// GET  /api/associations/[associationId]/membership-plans — any active staff.
// POST                                                     — plans.manage. Both language names are required.
// Price is CONFIGURATION ONLY: it is never a payment record and no payment is taken in B1.
export async function GET(_request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "staff");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin
    .from("association_membership_plans")
    .select("id, name_en, name_fr, description_en, description_fr, price_amount, currency, duration_months, grace_days, active, sort_order")
    .eq("association_id", params.associationId)
    .order("active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ code: "server_error" }, { status: 500 });
  return NextResponse.json({ plans: data || [] });
}

export async function POST(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "plans.manage");
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => ({}));

  const { data, error } = await auth.admin.rpc("association_create_plan", {
    p_association_id: params.associationId,
    p_actor: auth.user.id,
    p_name_en: str(b?.nameEn, 80) ?? "",
    p_name_fr: str(b?.nameFr, 80) ?? "",
    p_description_en: str(b?.descriptionEn, 500),
    p_description_fr: str(b?.descriptionFr, 500),
    p_price_amount: Number.isFinite(Number(b?.priceAmount)) ? Number(b.priceAmount) : 0,
    p_currency: str(b?.currency, 3),
    p_duration_months: b?.durationMonths === null || b?.durationMonths === "" || b?.durationMonths === undefined ? null : Number(b.durationMonths),
    p_grace_days: Number.isFinite(Number(b?.graceDays)) ? Number(b.graceDays) : 0,
    p_sort_order: Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : 0,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ plan: data }, { status: 201 });
}
