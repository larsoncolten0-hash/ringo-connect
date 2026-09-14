import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { hashInvitationToken } from "@/lib/team/invitations";
import { logOrgActivity } from "@/lib/team/activity";
import { notifyUser } from "@/lib/notifications";
import { getOrgTeamEnabled } from "@/lib/team/access";

// POST /api/team/invitations/accept — body: { token }. Requires the caller
// to already be signed in (the public invite page routes an unauthenticated
// visitor through the existing signup/login flow first, then returns here —
// see src/app/team/invite/[token]/page.tsx). This is deliberately the ONLY
// place a token is ever exchanged for a real organization_members row, and
// it re-validates everything server-side:
//
//   - the token's HASH must match a row (the raw token is never stored, so
//     there is nothing to compare it against except by hashing again)
//   - status must still be 'pending' (never accept a revoked/cancelled/
//     already-accepted/expired row — single-use, enforced here, not by the
//     frontend)
//   - expires_at must be in the future
//
// The organization + role a membership is created with come ENTIRELY from
// the invitation row looked up here — never from the request body — so
// there is no way for a client to negotiate a different organization or a
// higher-privileged role than the one the invitation actually grants.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const tokenHash = hashInvitationToken(token);

  const { data: invitation } = await admin
    .from("organization_invitations")
    .select("id, profile_id, role_id, status, expires_at, organization_roles(name), profiles(user_id, name, username)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!invitation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (invitation.status === "revoked") return NextResponse.json({ error: "revoked" }, { status: 410 });
  if (invitation.status === "cancelled") return NextResponse.json({ error: "cancelled" }, { status: 410 });
  if (invitation.status === "accepted") return NextResponse.json({ error: "already_used" }, { status: 409 });
  if (invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
    // Covers both an already-flipped 'expired' row and one that's merely
    // past its expiry but hasn't been lazily flipped yet (see the GET
    // /api/team/invitations list route, which is the only other place that
    // does the lazy flip) — either way, this must never be accepted.
    if (invitation.status === "pending") {
      await admin.from("organization_invitations").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", invitation.id);
    }
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const org = invitation.profiles as any;
  if (org?.user_id === user.id) {
    // The owner can't "join" their own organization as staff.
    return NextResponse.json({ error: "is_owner" }, { status: 400 });
  }

  // The organization's plan may have changed between invitation creation
  // and acceptance (e.g. the owner downgraded away from the plan that
  // unlocks Team Management) — re-checked here rather than trusted from
  // creation time, same "never trust a stale precondition" reasoning as
  // the status/expiry checks above.
  if (!(await getOrgTeamEnabled(invitation.profile_id))) {
    return NextResponse.json({ error: "team_disabled" }, { status: 403 });
  }

  // Upsert rather than insert — re-inviting someone previously removed
  // reactivates their existing row (unique(profile_id, user_id)) instead of
  // colliding with it.
  const { error: memberError } = await admin
    .from("organization_members")
    .upsert(
      {
        profile_id: invitation.profile_id,
        user_id: user.id,
        role_id: invitation.role_id,
        status: "active",
        invited_by: null,
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,user_id" }
    );

  if (memberError) {
    console.error("organization_members upsert failed:", memberError.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  await admin
    .from("organization_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "pending"); // belt-and-braces: never flips a row a concurrent request already accepted

  await logOrgActivity({
    profileId: invitation.profile_id,
    actorUserId: user.id,
    action: "member_joined",
    targetUserId: user.id,
    details: { invitationId: invitation.id, roleName: (invitation.organization_roles as any)?.name },
  });

  const { data: memberProfile } = await admin.from("profiles").select("name").eq("user_id", user.id).maybeSingle();
  if (org?.user_id) {
    await notifyUser(org.user_id, {
      type: "team_member_joined",
      title: "New team member",
      body: `${memberProfile?.name || "Someone"} joined ${org.name || org.username} as ${(invitation.organization_roles as any)?.name || "a team member"}.`,
      link: "/dashboard/team",
    });
  }

  return NextResponse.json({
    ok: true,
    organizationName: org?.name || org?.username,
    profileId: invitation.profile_id,
  });
}
