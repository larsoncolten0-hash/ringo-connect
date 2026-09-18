import { createAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/association/tokens";
import AcceptPartnerInvitationView from "@/components/association/AcceptPartnerInvitationView";

export const dynamic = "force-dynamic";

// Public — no auth required to LOAD this page. Only reads the invitation by
// the SHA-256 hash of the token, and only returns non-sensitive display
// fields. Actually linking in happens through POST
// /api/association/invitations/accept, which re-validates everything again
// server-side — this page is not a security boundary by itself, same
// posture as /team/invite/[token]/page.tsx.
export default async function AssociationInvitePage({ params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const tokenHash = hashToken(params.token);

  const { data: invitation } = await admin
    .from("association_invitations")
    .select("status, expires_at, invitee_profile_id, profiles!association_invitations_association_profile_id_fkey(name, username)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  let status: "pending" | "expired" | "revoked" | "cancelled" | "accepted" | "not_found" = "not_found";
  if (invitation) {
    status = invitation.status === "pending" && new Date(invitation.expires_at) < new Date() ? "expired" : (invitation.status as any);
  }

  const association = invitation?.profiles as any;

  return (
    <AcceptPartnerInvitationView
      token={params.token}
      status={status}
      associationName={association?.name || association?.username || null}
    />
  );
}
