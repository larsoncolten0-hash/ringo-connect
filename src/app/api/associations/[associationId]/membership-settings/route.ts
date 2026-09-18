import { NextResponse } from "next/server";
import { requireAssociationPermission } from "@/lib/association/permissions";
import { rpcErrorResponse, badRequest } from "@/lib/association/membership";

// GET  /api/associations/[associationId]/membership-settings — any active staff. { enabled, prefix }
// PATCH                                                       — settings.manage. body: { enabled: boolean, prefix?: string }
// The opt-in flag defaults to OFF. p_actor is always the authenticated session user.
export async function GET(_request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "staff");
  if (!auth.ok) return auth.response;
  const cfg = auth.association.config;
  return NextResponse.json({
    enabled: cfg.membership_enabled === true,
    prefix: typeof cfg.membership_number_prefix === "string" ? cfg.membership_number_prefix : "M",
  });
}

export async function PATCH(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "settings.manage");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean") return badRequest();

  const { data, error } = await auth.admin.rpc("association_update_membership_settings", {
    p_association_id: params.associationId,
    p_actor: auth.user.id,
    p_enabled: body.enabled,
    p_prefix: typeof body.prefix === "string" ? body.prefix : null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ enabled: data.membership_enabled, prefix: data.membership_number_prefix });
}
