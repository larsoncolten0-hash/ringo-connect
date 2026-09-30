import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notifyAmbassadorApproved } from "@/lib/ambassador/notifications";

// Ambassador Program (Phase F) — activate/deactivate/suspend an
// Ambassador, and/or reassign their team. Admin-only.
//
// Team reassignment here ONLY ever writes ambassador_profiles.team_id —
// it never touches ambassador_sales.team_id, which is a permanent,
// attribution-time snapshot (see the approved migration). This is what
// makes "team changes affect future sales only" true: there is simply no
// code path here that could rewrite history, by construction, not by a
// runtime check.
//
// Deactivating/suspending an Ambassador here also has an immediate,
// already-approved downstream effect with no extra code needed: their
// sales_code stops resolving in ambassador_attribute_sale() (which only
// matches status = 'active'), so a suspended Ambassador's link simply
// stops creating new attributed sales the moment this is saved.
const VALID_STATUSES = ["active", "inactive", "suspended"];

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
    patch.deactivated_at = body.status === "active" ? null : new Date().toISOString();
  }
  if (body?.teamId !== undefined) {
    patch.team_id = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const adminClient = createAdminClient();
  // Explicit column list — this row is copied into the audit trail as `before`,
  // so it must never be a select("*") that could sweep in sensitive columns.
  const { data: existing } = await adminClient
    .from("ambassador_profiles")
    .select("id, user_id, team_id, sales_code, status, created_at, deactivated_at, created_by")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Ambassador not found." }, { status: 404 });

  // Captured before the update so "was pending, is now active" is judged on the real before-state.
  const previousStatus = existing.status;

  if (patch.team_id) {
    const { data: team } = await adminClient.from("ambassador_teams").select("id").eq("id", patch.team_id).maybeSingle();
    if (!team) return NextResponse.json({ error: "That team does not exist." }, { status: 404 });
  }

  const { data: updated, error } = await adminClient.from("ambassador_profiles").update(patch).eq("id", params.id).select("id, status, team_id, deactivated_at").single();
  if (error || !updated) {
    console.error("ambassador update failed:", error?.message);
    return NextResponse.json({ error: "Could not update the Ambassador." }, { status: 500 });
  }

  await adminClient.from("ambassador_admin_actions").insert({
    actor_user_id: admin.id,
    action: "ambassador_updated",
    target_table: "ambassador_profiles",
    target_id: params.id,
    before: existing,
    after: updated,
    reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : null,
  });

  // A pending Ambassador (added by a Team Leader) was just approved: tell them.
  // Never fails the approval itself.
  if (previousStatus === "pending" && updated.status === "active") {
    await notifyAmbassadorApproved(adminClient, existing.user_id, existing.id);
  }

  return NextResponse.json({ ok: true, ambassador: updated });
}
