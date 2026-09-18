import { NextResponse } from "next/server";
import { requireAssociationPermission } from "@/lib/association/permissions";

// GET /api/associations/[associationId]/audit[?before=<id>] — audit.view (super_associate implicitly). Newest first,
// 50 per page. The log is append-only and contains no tokens or secrets.
export async function GET(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "audit.view");
  if (!auth.ok) return auth.response;
  const before = Number(new URL(request.url).searchParams.get("before"));

  let query = auth.admin
    .from("association_audit_log")
    .select("id, action, actor_kind, actor_role, target_type, target_id, member_id, changes, metadata, created_at")
    .eq("association_id", params.associationId)
    .order("id", { ascending: false })
    .limit(50);
  if (Number.isFinite(before) && before > 0) query = query.lt("id", before);
  const { data, error } = await query;
  if (error) return NextResponse.json({ code: "server_error" }, { status: 500 });
  return NextResponse.json({ entries: data || [] });
}
