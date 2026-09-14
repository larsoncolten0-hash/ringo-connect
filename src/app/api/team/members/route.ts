import { NextResponse } from "next/server";
import { requireOrgAccessJson } from "@/lib/team/access";

// GET /api/team/members?profileId=... — every active/inactive member of
// this organization (never 'removed' ones — those belong to activity
// history, not the live team list). staff.view (or owner/admin) only. The
// owner themselves is NOT a row here (see the design note in
// 2026-10-01_team_management.sql) — the Team page adds them as a
// synthetic first row from `profiles`/`users` directly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.view");
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data: members, error } = await supabase
    .from("organization_members")
    .select("id, user_id, status, joined_at, role_id, organization_roles(id, name, permissions), users(email)")
    .eq("profile_id", profileId)
    .neq("status", "removed")
    .order("joined_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not load team members." }, { status: 500 });

  // organization_members and profiles both reference public.users but
  // aren't directly related by a foreign key to each other, so PostgREST
  // can't embed one inside the other — fetched as a second query and
  // merged here instead, keyed on user_id.
  const userIds = (members || []).map((m) => m.user_id);
  const { data: profiles } =
    userIds.length > 0 ? await supabase.from("profiles").select("user_id, name, username, avatar_url").in("user_id", userIds) : { data: [] as any[] };
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));

  const enriched = (members || []).map((m) => ({ ...m, profile: profileByUserId.get(m.user_id) || null }));

  return NextResponse.json({ members: enriched });
}
