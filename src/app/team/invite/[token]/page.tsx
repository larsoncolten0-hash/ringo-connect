import { createAdminClient } from "@/lib/supabase/server";
import { hashInvitationToken } from "@/lib/team/invitations";
import AcceptInvitationView from "@/components/team/AcceptInvitationView";

export const dynamic = "force-dynamic";

// Public — no auth required to LOAD this page (a person clicking the link
// hasn't necessarily signed in yet). Only ever reads the invitation by the
// SHA-256 hash of the token in the URL, and only ever returns
// non-sensitive display fields (organization name, role name, expiry) —
// never the token_hash, profile_id, or role_id themselves. Actually
// joining an organization happens through POST
// /api/team/invitations/accept, which re-validates everything again
// server-side; nothing here is a security boundary by itself.
export default async function InvitePage({ params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const tokenHash = hashInvitationToken(params.token);

  const { data: invitation } = await admin
    .from("organization_invitations")
    .select("status, expires_at, organization_roles(name), profiles(name, username)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  let status: "pending" | "expired" | "revoked" | "cancelled" | "accepted" | "not_found" = "not_found";
  if (invitation) {
    status = invitation.status === "pending" && new Date(invitation.expires_at) < new Date() ? "expired" : (invitation.status as any);
  }

  const org = invitation?.profiles as any;
  const role = invitation?.organization_roles as any;

  return (
    <AcceptInvitationView
      token={params.token}
      status={status}
      organizationName={org?.name || org?.username || null}
      roleName={role?.name || null}
    />
  );
}
