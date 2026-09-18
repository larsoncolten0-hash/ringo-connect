import { NextResponse } from "next/server";
import { requireAssociationPermission, isUuid } from "@/lib/association/permissions";
import { rpcErrorResponse, str } from "@/lib/association/membership";

// POST /api/associations/[associationId]/memberships/[membershipId]/[operation] — memberships.manage.
// operation is an ALLOW-LIST mapped to one narrow SQL function each (never a target state):
//   activate | suspend | reinstate | renew | cancel
// p_actor is the authenticated session user. The database re-verifies that actor's permission and the
// allowed state transition inside the same transaction.
const OPERATIONS: Record<string, { rpc: string; expect?: string; extra: (b: any) => Record<string, unknown> }> = {
  activate: { rpc: "association_activate_membership", expect: "active", extra: () => ({}) },
  suspend: { rpc: "association_suspend_membership", expect: "suspended", extra: (b) => ({ p_reason: str(b?.reason) }) },
  reinstate: { rpc: "association_reinstate_membership", expect: "active", extra: () => ({}) },
  renew: { rpc: "association_renew_membership", extra: (b) => ({ p_plan_id: isUuid(b?.planId) ? b.planId : null }) },
  cancel: { rpc: "association_cancel_membership", expect: "cancelled", extra: (b) => ({ p_reason: str(b?.reason) }) },
};

export async function POST(request: Request, { params }: { params: { associationId: string; membershipId: string; operation: string } }) {
  const op = Object.prototype.hasOwnProperty.call(OPERATIONS, params.operation) ? OPERATIONS[params.operation] : null;
  if (!op) return NextResponse.json({ code: "invalid_input" }, { status: 400 });

  const auth = await requireAssociationPermission(params.associationId, "memberships.manage");
  if (!auth.ok) return auth.response;
  if (!isUuid(params.membershipId)) return NextResponse.json({ code: "membership_not_found" }, { status: 404 });

  // the term must belong to THIS Association (clean 404 before any RPC)
  const { data: term } = await auth.admin.from("association_memberships").select("association_id").eq("id", params.membershipId).maybeSingle();
  if (!term || term.association_id !== params.associationId) return NextResponse.json({ code: "membership_not_found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { data, error } = await auth.admin.rpc(op.rpc, {
    p_membership_id: params.membershipId,
    p_actor: auth.user.id,
    ...op.extra(body),
  });
  if (error) return rpcErrorResponse(error);

  // "materialize-then-report": if the term had already ended, the database recorded it as expired and returned
  // that row instead of raising (so the change persists). Report it as a conflict, not a success.
  if (op.expect && data?.state !== op.expect) {
    return NextResponse.json({ code: "term_ended", membership: data }, { status: 409 });
  }
  return NextResponse.json({ membership: data });
}
