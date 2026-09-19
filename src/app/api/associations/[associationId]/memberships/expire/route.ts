import { NextResponse } from "next/server";
import { requireAssociationPermission } from "@/lib/association/permissions";
import { rpcErrorResponse } from "@/lib/association/membership";

// POST /api/associations/[associationId]/memberships/expire — memberships.manage.
// An EXPLICIT staff action that converges stored state for terms whose end has passed. It is convenience only:
// security never depends on it (the database computes effective state and guards benefits on its own), and it
// is not called automatically anywhere in B1. Automatic scheduling belongs to B4.
export async function POST(_request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "memberships.manage");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.rpc("association_expire_memberships", {
    p_association_id: params.associationId,
    p_actor: auth.user.id,
    p_limit: 500,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ expired: data });
}
