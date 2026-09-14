import { NextResponse } from "next/server";
import { requireOrgAccessJson } from "@/lib/team/access";
import { generateInvitationToken, invitationExpiryDate, buildInvitationUrl, DEFAULT_INVITATION_TTL_DAYS } from "@/lib/team/invitations";
import { logOrgActivity } from "@/lib/team/activity";
import { sendTeamInvitationEmail } from "@/lib/email/sendTeamInvitationEmail";
import { isEmailProviderConfigured } from "@/lib/email/provider";

// GET /api/team/invitations?profileId=... — every invitation for this
// organization, newest first. staff.invite (or owner/admin) only — see
// "organization_invitations read" in 2026-10-01_team_management.sql, which
// this route's request-scoped client is already bound by.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.invite");
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Lazily flip anything whose expiry has passed — no cron needed, this is
  // the only place invitation status is ever read from, so it's always
  // accurate by the time a caller sees it.
  await supabase
    .from("organization_invitations")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, role_id, method, invitee_name, invitee_email, invitee_phone, status, expires_at, accepted_at, created_at, organization_roles(name)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not load invitations." }, { status: 500 });
  return NextResponse.json({ invitations: data });
}

// POST /api/team/invitations — creates ONE invitation row, used by both
// invitation methods (they differ only in `method` + whether invitee_* is
// filled in). The raw token is returned here and ONLY here — it is never
// stored (only its hash is), so this response is the one and only moment
// the manager can copy/share it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  const roleId = body?.roleId as string | undefined;
  const method = body?.method as "manual" | "link" | undefined;
  const inviteeName = typeof body?.inviteeName === "string" ? body.inviteeName.trim().slice(0, 120) : null;
  const inviteeEmail = typeof body?.inviteeEmail === "string" ? body.inviteeEmail.trim().slice(0, 200) : null;
  const inviteePhone = typeof body?.inviteePhone === "string" ? body.inviteePhone.trim().slice(0, 40) : null;

  if (!profileId || !roleId || (method !== "manual" && method !== "link")) {
    return NextResponse.json({ error: "profileId, roleId, and a valid method are required." }, { status: 400 });
  }
  if (method === "manual" && !inviteeName) {
    return NextResponse.json({ error: "A name is required to add a team member directly." }, { status: 400 });
  }
  if (method === "manual" && !inviteeEmail && !inviteePhone) {
    return NextResponse.json({ error: "Provide at least an email or a phone number." }, { status: 400 });
  }

  const auth = await requireOrgAccessJson(profileId, "staff.invite");
  if (!auth.ok) return auth.response;
  const { supabase, user, access } = auth;

  // The role must belong to THIS organization — never trust a role id from
  // the client without checking it wasn't picked from a different
  // organization's role list.
  const { data: role } = await supabase.from("organization_roles").select("id, name, permissions").eq("id", roleId).eq("profile_id", profileId).maybeSingle();
  if (!role) return NextResponse.json({ error: "Invalid role for this organization." }, { status: 400 });

  // A manager can never invite someone into a role that grants a
  // permission the manager doesn't hold themselves — owner/admin callers
  // already passed the check above unconditionally.
  if (!access.isOwner && !access.isAdmin) {
    const disallowed = (role.permissions || []).filter((p: string) => !access.hasPermission(p as any));
    if (disallowed.length > 0) {
      return NextResponse.json({ error: `You can't grant permissions you don't have: ${disallowed.join(", ")}` }, { status: 403 });
    }
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = invitationExpiryDate(DEFAULT_INVITATION_TTL_DAYS);

  const { data: invitation, error: insertError } = await supabase
    .from("organization_invitations")
    .insert({
      profile_id: profileId,
      role_id: roleId,
      invited_by: user.id,
      method,
      invitee_name: inviteeName,
      invitee_email: inviteeEmail,
      invitee_phone: inviteePhone,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !invitation) {
    console.error("invitation insert failed:", insertError?.message);
    return NextResponse.json({ error: "Could not create the invitation." }, { status: 500 });
  }

  const inviteUrl = buildInvitationUrl(token);

  const { data: org } = await supabase.from("profiles").select("name, username").eq("id", profileId).maybeSingle();
  const organizationName = org?.name || org?.username || "your organization";

  let emailSent = false;
  if (method === "manual" && inviteeEmail && isEmailProviderConfigured()) {
    const result = await sendTeamInvitationEmail({
      to: inviteeEmail,
      organizationName,
      roleName: role.name,
      inviteUrl,
      inviteeName: inviteeName || "there",
      invitationId: invitation.id,
    });
    emailSent = result.ok;
  }

  await logOrgActivity({
    profileId,
    actorUserId: user.id,
    action: method === "manual" ? "member_invited" : "invitation_link_generated",
    details: { invitationId: invitation.id, roleId, roleName: role.name, inviteeEmail, inviteeName },
  });

  return NextResponse.json({ id: invitation.id, inviteUrl, expiresAt, emailSent });
}
