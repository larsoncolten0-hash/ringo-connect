import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse, rpcErrorResponse } from "@/lib/bookkeeping/http";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Void an entry (a reason is required; nothing is ever deleted). Idempotent: voiding twice reports
// `already_voided` and changes nothing. The entry must belong to the caller's own business.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  const { owner } = access;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "entry_not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 300) return NextResponse.json({ error: "validation_failed", details: ["invalid_reason"] }, { status: 400 });

  const { data, error } = await owner.admin.rpc("bk_void_entry", { p_profile_id: owner.profile.id, p_actor_user_id: owner.userId, p_entry_id: params.id, p_reason: reason });
  if (error) return rpcErrorResponse(error.message);
  return NextResponse.json(data);
}
