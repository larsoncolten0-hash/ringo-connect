import { NextResponse } from "next/server";
import { requireAssociationAccessJson, countActiveAssociationPartners } from "@/lib/association/access";
import { generateToken, invitationExpiryDate, buildInvitationUrl, DEFAULT_INVITATION_TTL_DAYS } from "@/lib/association/tokens";
import { createAdminClient } from "@/lib/supabase/server";

// GET /api/association/invitations?associationProfileId=... — every
// invitation for this Association, newest first. Owner only.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Lazily flip anything whose expiry has passed — same pattern as
  // /api/team/invitations, the only place invitation status is read from.
  await supabase
    .from("association_invitations")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("association_profile_id", associationProfileId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  const { data, error } = await supabase
    .from("association_invitations")
    .select("id, method, invitee_profile_id, invitee_username, invitee_phone, status, expires_at, accepted_at, created_at, profiles!association_invitations_invitee_profile_id_fkey(username, name, avatar_url)")
    .eq("association_profile_id", associationProfileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not load invitations." }, { status: 500 });
  return NextResponse.json({ invitations: data });
}

// POST /api/association/invitations — invites an EXISTING Ringo user (their
// own real profile) to link in as a Partner. Unlike a Team invite, the
// target must already resolve to a real profiles row — invitee_profile_id
// is required and is what the invitation is actually bound to; invitee_
// username/phone are kept only as a record of what the Owner searched for.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const method = body?.method as "manual" | "link" | undefined;
  const inviteeProfileId = body?.inviteeProfileId as string | undefined;
  const inviteeUsername = typeof body?.inviteeUsername === "string" ? body.inviteeUsername.trim().slice(0, 60) : null;
  const inviteePhone = typeof body?.inviteePhone === "string" ? body.inviteePhone.trim().slice(0, 40) : null;

  if (!associationProfileId || !inviteeProfileId || (method !== "manual" && method !== "link")) {
    return NextResponse.json({ error: "associationProfileId, inviteeProfileId, and a valid method are required." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  if (inviteeProfileId === associationProfileId) {
    return NextResponse.json({ code: "invite_self", error: "An Association can't invite its own profile as a Partner." }, { status: 400 });
  }

  // Partner seat cap — checked against ACTIVE partners only, same "an
  // invitation doesn't reserve a seat" reasoning as Team's own seat check.
  // Re-checked again at accept time below for the same "a seat can fill up
  // in between" reason Team's accept route documents. Soft-block only, per
  // the product decision — `partner_limit_reached` is the code the UI must
  // map to a message offering BOTH resolutions (upgrade, or contact support
  // about extra slots), never "remove a Partner first."
  const maxPartners = auth.access.caps.maxPartners;
  if (maxPartners != null) {
    const activeCount = await countActiveAssociationPartners(associationProfileId);
    if (activeCount >= maxPartners) {
      return NextResponse.json(
        { code: "partner_limit_reached", error: `You've reached your plan's Partner limit (${maxPartners}).` },
        { status: 403 }
      );
    }
  }

  // The target must be a real, existing profile — never trust the id
  // without confirming it (RLS already prevents reading nothing, but this
  // asserts the row actually exists).
  const { data: targetProfile } = await supabase.from("profiles").select("id, username, name").eq("id", inviteeProfileId).maybeSingle();
  if (!targetProfile) return NextResponse.json({ code: "profile_not_found", error: "That Ringo profile couldn't be found." }, { status: 404 });

  const { data: existingLink } = await supabase
    .from("association_partners")
    .select("id, status")
    .eq("association_profile_id", associationProfileId)
    .eq("partner_profile_id", inviteeProfileId)
    .maybeSingle();
  if (existingLink?.status === "active") {
    return NextResponse.json({ code: "already_partner", error: "This profile is already a Partner." }, { status: 409 });
  }

  const { token, hash } = generateToken();
  const expiresAt = invitationExpiryDate(DEFAULT_INVITATION_TTL_DAYS);

  const { data: invitation, error: insertError } = await supabase
    .from("association_invitations")
    .insert({
      association_profile_id: associationProfileId,
      invited_by: user.id,
      method,
      invitee_profile_id: inviteeProfileId,
      invitee_username: inviteeUsername,
      invitee_phone: inviteePhone,
      token_hash: hash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !invitation) {
    console.error("association invitation insert failed:", insertError?.message);
    return NextResponse.json({ code: "server_error", error: "Could not create the invitation." }, { status: 500 });
  }

  const inviteUrl = buildInvitationUrl(token);

  // Notify the invited Partner in-app if they have a real account (they
  // always do, per the constraint above) — best-effort, uses the generic
  // notifyUser helper (src/lib/notifications.ts), same as Team.
  const admin = createAdminClient();
  const { data: targetOwner } = await admin.from("profiles").select("user_id").eq("id", inviteeProfileId).maybeSingle();
  if (targetOwner?.user_id) {
    const { notifyUser } = await import("@/lib/notifications");
    const { data: assocProfile } = await supabase.from("profiles").select("name, username").eq("id", associationProfileId).maybeSingle();
    await notifyUser(targetOwner.user_id, {
      type: "association_partner_invite",
      title: "Partner invitation",
      body: `${assocProfile?.name || assocProfile?.username || "An Association"} invited you to link in as a Partner.`,
      link: inviteUrl,
    });
  }

  return NextResponse.json({ id: invitation.id, inviteUrl, expiresAt });
}
