import { NextResponse } from "next/server";
import { requireOrgAccessJson } from "@/lib/team/access";
import { generateInvitationToken, invitationExpiryDate, buildInvitationUrl, DEFAULT_INVITATION_TTL_DAYS } from "@/lib/team/invitations";
import { logOrgActivity } from "@/lib/team/activity";
import { sendTeamInvitationEmail } from "@/lib/email/sendTeamInvitationEmail";
import { isEmailProviderConfigured } from "@/lib/email/provider";

// POST /api/team/invitations/[id] — body: { action: "revoke" | "resend", profileId }.
// One route for both actions (rather than two) since they share the exact
// same lookup/authorization shape.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  const action = body?.action as "revoke" | "resend" | undefined;
  if (!profileId || (action !== "revoke" && action !== "resend")) {
    return NextResponse.json({ error: "profileId and a valid action are required." }, { status: 400 });
  }

  const auth = await requireOrgAccessJson(profileId, "staff.invite");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select("id, status, expires_at, invitee_email, invitee_name, invitee_phone, role_id, organization_roles(name)")
    .eq("id", params.id)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!invitation) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });

  if (action === "revoke") {
    if (invitation.status !== "pending") {
      return NextResponse.json({ error: "Only a pending invitation can be revoked." }, { status: 400 });
    }
    const { error } = await supabase
      .from("organization_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", invitation.id);
    if (error) return NextResponse.json({ error: "Could not revoke the invitation." }, { status: 500 });

    await logOrgActivity({ profileId, actorUserId: user.id, action: "invitation_revoked", details: { invitationId: invitation.id } });
    return NextResponse.json({ ok: true });
  }

  // Resend: only for a still-pending, not-yet-expired invitation — this is
  // a courtesy re-send (rotates the token, since only its hash was ever
  // stored — see src/lib/team/invitations.ts), not a way to revive an
  // expired one. An expired/revoked/accepted/cancelled invitation must go
  // through a brand-new invitation instead (never extended silently).
  if (invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: "This invitation is no longer pending — create a new one instead." }, { status: 400 });
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = invitationExpiryDate(DEFAULT_INVITATION_TTL_DAYS);

  const { error: updateError } = await supabase
    .from("organization_invitations")
    .update({ token_hash: tokenHash, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", invitation.id);
  if (updateError) return NextResponse.json({ error: "Could not resend the invitation." }, { status: 500 });

  const inviteUrl = buildInvitationUrl(token);

  let emailSent = false;
  if (invitation.invitee_email && isEmailProviderConfigured()) {
    const { data: org } = await supabase.from("profiles").select("name, username").eq("id", profileId).maybeSingle();
    const result = await sendTeamInvitationEmail({
      to: invitation.invitee_email,
      organizationName: org?.name || org?.username || "your organization",
      roleName: (invitation.organization_roles as any)?.name || "Team member",
      inviteUrl,
      inviteeName: invitation.invitee_name || "there",
      invitationId: invitation.id,
    });
    emailSent = result.ok;
  }

  await logOrgActivity({ profileId, actorUserId: user.id, action: "invitation_resent", details: { invitationId: invitation.id } });

  return NextResponse.json({ ok: true, inviteUrl, expiresAt, emailSent });
}
