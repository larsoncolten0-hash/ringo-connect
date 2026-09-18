import { NextResponse } from "next/server";
import { requireAssociationPermission } from "@/lib/association/permissions";
import { loadLatestTerms } from "@/lib/association/membership";
import type { RosterMember } from "@/lib/association/membershipTypes";

// GET /api/associations/[associationId]/members[?managed=1] — memberships.view. READ-ONLY.
//   default:    the member roster with each member's latest term (database-computed effective state)
//   ?managed=1: only { managed: { [memberId]: info } } for members that are membership-managed
// Members whose association_id link is still NULL (a Phase A fail-open gap) are simply not listed here.
export async function GET(request: Request, { params }: { params: { associationId: string } }) {
  const auth = await requireAssociationPermission(params.associationId, "memberships.view");
  if (!auth.ok) return auth.response;
  const managedOnly = new URL(request.url).searchParams.get("managed") === "1";

  let query = auth.admin
    .from("association_members")
    .select("id, name, phone, status, lifecycle_state, points_balance")
    .eq("association_id", params.associationId)
    .order("created_at", { ascending: false });
  if (managedOnly) query = query.not("lifecycle_state", "is", null);
  const { data: members, error } = await query;
  if (error) return NextResponse.json({ code: "server_error" }, { status: 500 });

  let terms: Awaited<ReturnType<typeof loadLatestTerms>> = {};
  try {
    terms = await loadLatestTerms(auth.admin, params.associationId, (members || []).filter((m: any) => m.lifecycle_state).map((m: any) => m.id));
  } catch {
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }

  if (managedOnly) return NextResponse.json({ managed: terms });
  const roster: RosterMember[] = (members || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    phone: m.phone,
    status: m.status,
    lifecycleState: m.lifecycle_state,
    pointsBalance: m.points_balance,
    membership: terms[m.id] || null,
  }));
  return NextResponse.json({ members: roster });
}
