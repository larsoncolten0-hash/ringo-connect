import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Ambassador Program (Phase F) — create a Team, assigning an existing
// Ringo Connect account (looked up by username, same convention as
// /api/admin/ambassadors) as its Team Leader. Admin-only.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const username = typeof body?.teamLeaderUsername === "string" ? body.teamLeaderUsername.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!username || !name) return NextResponse.json({ error: "A team leader username and a team name are required." }, { status: 400 });

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient.from("profiles").select("user_id").eq("username", username).maybeSingle();
  if (!profile) return NextResponse.json({ error: "No profile found with that username." }, { status: 404 });

  const { data: created, error } = await adminClient
    .from("ambassador_teams")
    .insert({ team_leader_user_id: profile.user_id, name, status: "active" })
    .select("id, name, status, team_leader_user_id")
    .single();
  if (error || !created) {
    // ambassador_teams.team_leader_user_id is unique — one team per leader.
    const isDuplicate = error?.code === "23505";
    console.error("ambassador team create failed:", error?.message);
    return NextResponse.json({ error: isDuplicate ? "This person already leads a team." : "Could not create the team." }, { status: isDuplicate ? 409 : 500 });
  }

  await adminClient.from("ambassador_admin_actions").insert({
    actor_user_id: admin.id,
    action: "team_created",
    target_table: "ambassador_teams",
    target_id: created.id,
    before: null,
    after: created,
    reason: null,
  });

  return NextResponse.json({ ok: true, team: created });
}
