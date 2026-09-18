import { NextResponse } from "next/server";
import { requireAssociationPermission, isUuid } from "@/lib/association/permissions";
import { rpcErrorResponse, badRequest } from "@/lib/association/membership";

// GET  /api/associations/[associationId]/memberships[?memberId=] — memberships.view. Terms (history), newest first,
//      each with the DATABASE-computed effective_state.
// POST                                                            — memberships.manage. ENROLL: { memberId, planId, startsAt? }
//      Price, expiry and number are computed by the database; nothing of the kind is accepted from the client.
export async function GET(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "memberships.view");
  if (!auth.ok) return auth.response;
  const memberId = new URL(request.url).searchParams.get("memberId");
  if (memberId !== null && !isUuid(memberId)) return badRequest();

  let query = auth.admin
    .from("association_memberships_effective")
    .select("id, member_id, plan_id, membership_number, state, effective_state, starts_at, expires_at, grace_days, price_amount, currency, activated_at, renewed_from, state_reason, ended_at, ended_reason, created_at")
    .eq("association_id", params.associationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (memberId) query = query.eq("member_id", memberId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ code: "server_error" }, { status: 500 });
  return NextResponse.json({ memberships: data || [] });
}

export async function POST(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "memberships.manage");
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => ({}));
  if (!isUuid(b?.memberId) || !isUuid(b?.planId)) return badRequest();

  let startsAt: string | null = null;
  if (b?.startsAt !== undefined && b?.startsAt !== null && b?.startsAt !== "") {
    const d = new Date(b.startsAt);
    if (Number.isNaN(d.getTime())) return badRequest();
    startsAt = d.toISOString();
  }

  const { data, error } = await auth.admin.rpc("association_start_membership", {
    p_association_id: params.associationId,
    p_actor: auth.user.id,
    p_member_id: b.memberId,
    p_plan_id: b.planId,
    p_starts_at: startsAt,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ membership: data }, { status: 201 });
}
