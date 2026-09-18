import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/association/tokens";
import { getAssociationCaps, countActiveAssociationPartners } from "@/lib/association/access";
import { notifyUser } from "@/lib/notifications";

// POST /api/association/invitations/accept — body: { token }. Requires the
// caller to already be signed in as the SAME profile the invitation was
// issued to (invitee_profile_id) — unlike a Team invite, there's no
// "whoever accepts becomes the member" step, since a Partner invitation
// targets one specific, already-existing profile from the moment it's
// created. Re-validates everything server-side: hash match, status still
// 'pending', not expired, caller owns the targeted profile, plan still has
// Association enabled, and the Partner cap hasn't filled up since the
// invitation was sent.
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
  const tokenHash = hashToken(token);

  const { data: invitation } = await admin
    .from("association_invitations")
    .select("id, association_profile_id, invitee_profile_id, status, expires_at, profiles!association_invitations_association_profile_id_fkey(name, username)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!invitation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (invitation.status === "revoked") return NextResponse.json({ error: "revoked" }, { status: 410 });
  if (invitation.status === "cancelled") return NextResponse.json({ error: "cancelled" }, { status: 410 });
  if (invitation.status === "accepted") return NextResponse.json({ error: "already_used" }, { status: 409 });
  if (invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
    if (invitation.status === "pending") {
      await admin.from("association_invitations").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", invitation.id);
    }
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // The invitation targets one specific profile — the signed-in caller must
  // own exactly that profile, never "whoever clicks the link."
  const { data: targetProfile } = await admin.from("profiles").select("id, user_id, name, username").eq("id", invitation.invitee_profile_id).maybeSingle();
  if (!targetProfile || targetProfile.user_id !== user.id) {
    return NextResponse.json({ error: "wrong_account" }, { status: 403 });
  }

  const caps = await getAssociationCaps(invitation.association_profile_id);
  if (!caps.enabled) return NextResponse.json({ error: "association_disabled" }, { status: 403 });

  if (caps.maxPartners != null) {
    const activeCount = await countActiveAssociationPartners(invitation.association_profile_id);
    if (activeCount >= caps.maxPartners) {
      return NextResponse.json({ error: "partners_full" }, { status: 409 });
    }
  }

  // Upsert — re-inviting a previously removed Partner reactivates their
  // existing row (unique(association_profile_id, partner_profile_id))
  // instead of colliding with it.
  const { error: linkError } = await admin.from("association_partners").upsert(
    {
      association_profile_id: invitation.association_profile_id,
      partner_profile_id: invitation.invitee_profile_id,
      status: "active",
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "association_profile_id,partner_profile_id" }
  );

  if (linkError) {
    console.error("association_partners upsert failed:", linkError.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  await admin
    .from("association_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "pending"); // belt-and-braces: never flips a row a concurrent request already accepted

  const association = invitation.profiles as any;
  if (association) {
    const { data: assocOwner } = await admin.from("profiles").select("user_id").eq("id", invitation.association_profile_id).maybeSingle();
    if (assocOwner?.user_id) {
      await notifyUser(assocOwner.user_id, {
        type: "association_partner_joined",
        title: "New Partner",
        body: `${targetProfile.name || targetProfile.username} joined as a Partner.`,
        link: "/dashboard/association",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    associationName: association?.name || association?.username,
    associationProfileId: invitation.association_profile_id,
  });
}
