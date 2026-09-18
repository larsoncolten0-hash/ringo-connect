import { NextResponse } from "next/server";
import { requireAssociationPermission, isUuid } from "@/lib/association/permissions";
import { rpcErrorResponse, badRequest } from "@/lib/association/membership";

// POST /api/associations/[associationId]/membership-plans/[planId]/active — plans.manage. body: { active: boolean }
// Archive (false) or unarchive (true). Plans are never deleted, so historical terms always keep their plan.
export async function POST(request: Request, { params }: { params: { associationId: string; planId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "plans.manage");
  if (!auth.ok) return auth.response;
  if (!isUuid(params.planId)) return NextResponse.json({ code: "plan_not_found" }, { status: 404 });

  const { data: existing } = await auth.admin.from("association_membership_plans").select("association_id").eq("id", params.planId).maybeSingle();
  if (!existing || existing.association_id !== params.associationId) return NextResponse.json({ code: "plan_not_found" }, { status: 404 });

  const b = await request.json().catch(() => ({}));
  if (typeof b?.active !== "boolean") return badRequest();
  const { data, error } = await auth.admin.rpc("association_set_plan_active", {
    p_plan_id: params.planId,
    p_actor: auth.user.id,
    p_active: b.active,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ plan: data });
}
