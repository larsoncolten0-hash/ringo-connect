import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Ambassador Program (Phase F) — rename or deactivate a Team. Admin-only.
// Deliberately does not support reassigning team_leader_user_id here —
// that would orphan the team's existing Ambassadors' historical
// team_id-snapshotted sales in a confusing way without a clearer product
// decision than this phase has been given; not required by the approved
// Phase F scope ("if team reassignment functionality is not required for
// this phase, do not add it" applied literally to the LEADER of a team,
// not to an Ambassador's own team_id, which IS handled in
// /api/admin/ambassadors/[id]).
const VALID_STATUSES = ["active", "inactive"];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (body?.status !== undefined) {
    if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return NextResponse.json({ error: "Invalid name." }, { status: 400 });
    patch.name = name;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const adminClient = createAdminClient();
  const { data: existing } = await adminClient.from("ambassador_teams").select("*").eq("id", params.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Team not found." }, { status: 404 });

  const { data: updated, error } = await adminClient.from("ambassador_teams").update(patch).eq("id", params.id).select("id, name, status").single();
  if (error || !updated) {
    console.error("ambassador team update failed:", error?.message);
    return NextResponse.json({ error: "Could not update the team." }, { status: 500 });
  }

  await adminClient.from("ambassador_admin_actions").insert({
    actor_user_id: admin.id,
    action: "team_updated",
    target_table: "ambassador_teams",
    target_id: params.id,
    before: existing,
    after: updated,
    reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : null,
  });

  return NextResponse.json({ ok: true, team: updated });
}
