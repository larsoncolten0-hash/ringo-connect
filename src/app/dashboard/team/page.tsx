import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveOrganization, ensureDefaultRoles } from "@/lib/team/access";
import TeamView from "@/components/team/TeamView";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const active = await resolveActiveOrganization(user.id);
  if (!active) redirect("/dashboard");
  if (!active.teamEnabled) redirect("/dashboard");
  if (!active.isOwner && !active.permissions.includes("staff.view")) redirect("/dashboard");

  const profileId = active.profile.id;

  // First visit to Team for this organization — materialize its category's
  // default role templates into real, editable rows (see
  // src/lib/team/access.ts). No-op every time after the first.
  await ensureDefaultRoles(profileId, active.profile.category, user.id);

  const [{ data: members }, { data: invitations }, { data: roles }, { data: ownerUser }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id, user_id, status, joined_at, role_id, organization_roles(id, name, permissions)")
      .eq("profile_id", profileId)
      .neq("status", "removed")
      .order("joined_at", { ascending: false }),
    supabase
      .from("organization_invitations")
      .select("id, role_id, method, invitee_name, invitee_email, invitee_phone, status, expires_at, accepted_at, created_at, organization_roles(name)")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false }),
    supabase.from("organization_roles").select("id, key, name, permissions, is_system").eq("profile_id", profileId).order("created_at", { ascending: true }),
    supabase.from("users").select("email").eq("id", active.profile.user_id).maybeSingle(),
  ]);

  // organization_members and profiles both reference public.users but
  // aren't directly related to each other by a foreign key, so they can't
  // be embedded in one PostgREST query — fetched separately and merged
  // here (same pattern as GET /api/team/members).
  const userIds = (members || []).map((m) => m.user_id);
  const [{ data: memberProfiles }, { data: memberUsers }] =
    userIds.length > 0
      ? await Promise.all([
          supabase.from("profiles").select("user_id, name, username, avatar_url").in("user_id", userIds),
          supabase.from("users").select("id, email").in("id", userIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

  const profileByUserId = new Map((memberProfiles || []).map((p) => [p.user_id, p]));
  const emailByUserId = new Map((memberUsers || []).map((u) => [u.id, u.email]));
  const enrichedMembers = (members || []).map((m) => ({
    ...m,
    profile: profileByUserId.get(m.user_id) || null,
    email: emailByUserId.get(m.user_id) || null,
  }));

  return (
    <TeamView
      profileId={profileId}
      organizationName={active.profile.name || active.profile.username}
      isOwner={active.isOwner}
      myPermissions={active.permissions}
      initialMembers={enrichedMembers as any}
      initialInvitations={(invitations || []) as any}
      initialRoles={(roles || []) as any}
      owner={{
        name: active.profile.name || active.profile.username,
        username: active.profile.username,
        avatarUrl: active.profile.avatar_url,
        email: ownerUser?.email || "",
      }}
    />
  );
}
