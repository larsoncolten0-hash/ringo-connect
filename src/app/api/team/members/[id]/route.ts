import { NextResponse } from "next/server";
import { requireOrgAccessJson, getOrgMaxSeats, countActiveOrgMembers } from "@/lib/team/access";
import { logOrgActivity } from "@/lib/team/activity";

const VALID_STATUSES = ["active", "inactive", "removed"];

// PATCH /api/team/members/[id] — body: { profileId, roleId?, status? }.
// Changes an existing member's role and/or status. staff.manage (or
// owner/admin) only. This is the one place role escalation is actually
// prevented server-side:
//   - a non-owner/admin actor can never assign a role that grants a
//     permission they don't hold themselves
//   - a non-owner/admin actor can never edit their OWN membership row here
//     (no self-promotion, no self-reactivation after being deactivated by
//     someone else, no self-removal that could be used to dodge an audit
//     trail) — only the owner/admin, or another staff.manage holder acting
//     on someone else, can change a membership row
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  const roleId = body?.roleId as string | undefined;
  const status = body?.status as string | undefined;
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });
  if (!roleId && !status) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  if (status && !VALID_STATUSES.includes(status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.manage");
  if (!auth.ok) return auth.response;
  const { supabase, user, access } = auth;

  const { data: member } = await supabase
    .from("organization_members")
    .select("id, user_id, role_id, status")
    .eq("id", params.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  if (!access.isOwner && !access.isAdmin && member.user_id === user.id) {
    return NextResponse.json({ error: "You can't change your own role or status." }, { status: 403 });
  }

  // Seat cap — this route can flip a previously removed/deactivated member
  // straight back to 'active' without going through an invitation at all, so
  // it needs the same check as invitation creation/acceptance (see those
  // routes' own comments). Only checked when actually transitioning INTO
  // 'active' from something else — a role-only edit on an already-active
  // member, or a transition OUT of 'active' (which frees a seat), is never
  // blocked by this.
  if (status === "active" && member.status !== "active") {
    const maxSeats = await getOrgMaxSeats(profileId);
    if (maxSeats != null) {
      const activeCount = await countActiveOrgMembers(profileId);
      if (activeCount >= maxSeats) {
        return NextResponse.json(
          { error: `Your plan's staff seat limit (${maxSeats}) is full. Remove another team member first or upgrade your plan.` },
          { status: 403 }
        );
      }
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let newRoleName: string | null = null;

  if (roleId && roleId !== member.role_id) {
    const { data: role } = await supabase.from("organization_roles").select("id, name, permissions").eq("id", roleId).eq("profile_id", profileId).maybeSingle();
    if (!role) return NextResponse.json({ error: "Invalid role for this organization." }, { status: 400 });

    if (!access.isOwner && !access.isAdmin) {
      const disallowed = (role.permissions || []).filter((p: string) => !access.hasPermission(p as any));
      if (disallowed.length > 0) {
        return NextResponse.json({ error: `You can't grant permissions you don't have: ${disallowed.join(", ")}` }, { status: 403 });
      }
    }
    update.role_id = roleId;
    newRoleName = role.name;
  }

  if (status) update.status = status;

  const { error } = await supabase.from("organization_members").update(update).eq("id", member.id);
  if (error) return NextResponse.json({ error: "Could not update this member." }, { status: 500 });

  if (update.role_id) {
    await logOrgActivity({ profileId, actorUserId: user.id, action: "role_changed", targetUserId: member.user_id, details: { memberId: member.id, roleId, roleName: newRoleName } });
  }
  if (status && status !== member.status) {
    await logOrgActivity({
      profileId,
      actorUserId: user.id,
      action: status === "removed" ? "member_removed" : status === "inactive" ? "member_deactivated" : "member_reactivated",
      targetUserId: member.user_id,
      details: { memberId: member.id },
    });
  }

  return NextResponse.json({ ok: true });
}
