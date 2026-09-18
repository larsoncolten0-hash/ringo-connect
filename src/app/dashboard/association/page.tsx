import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAssociationAccess } from "@/lib/association/access";
import AssociationOwnerView from "@/components/association/AssociationOwnerView";
import AssociationPartnerView from "@/components/association/AssociationPartnerView";
import AssociationPickView from "@/components/association/AssociationPickView";
import { getManagedMemberMap } from "@/lib/association/membership";
import type { ManagedMemberInfo } from "@/lib/association/membershipTypes";

export const dynamic = "force-dynamic";

// Entry point for the whole /dashboard/association tree. Always resolved
// against the signed-in person's OWN profile (never Team's active-
// organization concept — see src/lib/association/access.ts's own note on
// why these two features are entirely independent).
export default async function AssociationPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: ownProfile } = await supabase.from("profiles").select("id, name, username, avatar_url, is_demo").eq("user_id", user.id).maybeSingle();
  if (!ownProfile) redirect("/dashboard");

  const access = await getAssociationAccess(ownProfile.id, user.id);

  if (access?.isOwner && access.caps.enabled) {
    const [{ data: partners }, { data: members }, { data: rewards }, { data: settings }, { data: invitations }] = await Promise.all([
      supabase
        .from("association_partners")
        .select("id, partner_profile_id, momo_number, status, joined_at, created_at, profiles!association_partners_partner_profile_id_fkey(username, name, avatar_url)")
        .eq("association_profile_id", ownProfile.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("association_members")
        .select("id, name, phone, linked_profile_id, points_balance, status, created_at, profiles!association_members_linked_profile_id_fkey(username, name, avatar_url)")
        .eq("association_profile_id", ownProfile.id)
        .order("created_at", { ascending: false }),
      supabase.from("association_rewards").select("*").eq("association_profile_id", ownProfile.id).order("sort_order", { ascending: true }),
      supabase.from("association_settings").select("*").eq("association_profile_id", ownProfile.id).maybeSingle(),
      supabase
        .from("association_invitations")
        .select("id, method, invitee_profile_id, invitee_username, invitee_phone, status, expires_at, accepted_at, created_at, profiles!association_invitations_invitee_profile_id_fkey(username, name, avatar_url)")
        .eq("association_profile_id", ownProfile.id)
        .order("created_at", { ascending: false }),
    ]);

    // Membership (Phase B1): resolve the Association id and the managed-member map on the server so managed members
    // never render the legacy toggle, even on first paint. Any failure (or Membership not installed yet) leaves
    // the view exactly as it was: associationId/managed stay empty.
    let associationId: string | null = null;
    let managed: { available: boolean; map: Record<string, ManagedMemberInfo> } = { available: false, map: {} };
    try {
      const { data: assoc } = await supabase.from("associations").select("id").eq("legacy_profile_id", ownProfile.id).maybeSingle();
      associationId = assoc?.id ?? null;
      if (associationId) managed = await getManagedMemberMap(associationId);
    } catch {
      managed = { available: false, map: {} };
    }

    return (
      <AssociationOwnerView
        associationProfileId={ownProfile.id}
        associationName={ownProfile.name || ownProfile.username}
        maxMembers={access.caps.maxMembers}
        maxPartners={access.caps.maxPartners}
        initialPartners={(partners || []) as any}
        initialMembers={(members || []) as any}
        initialRewards={(rewards || []) as any}
        initialSettings={settings as any}
        initialInvitations={(invitations || []) as any}
        isDemo={!!ownProfile.is_demo}
        associationId={associationId}
        managedMembers={managed.map}
        membershipAvailable={managed.available}
      />
    );
  }

  // Not an enabled Owner — see whether they're an active Partner of at
  // least one Association instead. A person could in principle be Partner
  // to more than one; per the product decision, no real multi-Association
  // switcher is built — a plain pick-one list is a trivial, acceptable
  // side effect of the underlying join-table design.
  const { data: partnerLinks } = await supabase
    .from("association_partners")
    .select("association_profile_id, momo_number, profiles!association_partners_association_profile_id_fkey(name, username, avatar_url)")
    .eq("partner_profile_id", ownProfile.id)
    .eq("status", "active");

  if (!partnerLinks || partnerLinks.length === 0) redirect("/dashboard");

  if (partnerLinks.length === 1) {
    const link = partnerLinks[0];
    const assoc = link.profiles as any;
    return (
      <AssociationPartnerView
        associationProfileId={link.association_profile_id}
        associationName={assoc?.name || assoc?.username}
        partnerProfileId={ownProfile.id}
        momoNumber={link.momo_number}
      />
    );
  }

  return (
    <AssociationPickView
      options={partnerLinks.map((l) => {
        const assoc = l.profiles as any;
        return { associationProfileId: l.association_profile_id, name: assoc?.name || assoc?.username, avatarUrl: assoc?.avatar_url };
      })}
      partnerProfileId={ownProfile.id}
    />
  );
}
