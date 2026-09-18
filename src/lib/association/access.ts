import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Access/capacity helpers for the Association Program — same shape and
// reasoning as src/lib/team/access.ts, but for a structurally different
// relationship: an Association's "Owner" is just the normal profile owner
// (profiles.user_id = auth.uid(), unchanged from everywhere else in the
// app), and a "Partner" is someone with their OWN separate, independent
// profile linked in via association_partners — never a staff/permission
// relationship, so there is no permission-string system here at all (unlike
// Team's has_org_permission). A Partner's capability is binary: actively
// linked, or not.

export interface AssociationCaps {
  enabled: boolean;
  maxMembers: number | null;
  maxPartners: number | null;
}

/**
 * Resolves `profileId`'s (i.e. its owner's) plan-level Association
 * capabilities. Resolved via the service-role client for the same reason
 * getOrgTeamEnabled is: this is the OWNER's plan, which a Partner (the other
 * realistic caller here) has no RLS access to read directly. Fails closed
 * (enabled: false) for a missing/malformed profile rather than throwing.
 */
export async function getAssociationCaps(profileId: string): Promise<AssociationCaps> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("user_id, users(plan_id, plans(association_enabled, max_association_members, max_association_partners))")
    .eq("id", profileId)
    .maybeSingle();
  const plan = (data as any)?.users?.plans;
  return {
    enabled: !!plan?.association_enabled,
    maxMembers: plan?.max_association_members ?? null,
    maxPartners: plan?.max_association_partners ?? null,
  };
}

export async function countActiveAssociationMembers(associationProfileId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("association_members")
    .select("id", { count: "exact", head: true })
    .eq("association_profile_id", associationProfileId)
    .eq("status", "active");
  return count || 0;
}

export async function countActiveAssociationPartners(associationProfileId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("association_partners")
    .select("id", { count: "exact", head: true })
    .eq("association_profile_id", associationProfileId)
    .eq("status", "active");
  return count || 0;
}

export interface AssociationAccess {
  isOwner: boolean;
  isAdmin: boolean;
  isPartner: boolean;
  // The Partner's own profile id, when isPartner is true — needed so a
  // route can stamp partner_profile_id on a transaction/lookup without
  // trusting it from the client.
  partnerProfileId: string | null;
  caps: AssociationCaps;
}

/**
 * Resolves the signed-in user's access to `associationProfileId` — owner,
 * platform admin, or an active Partner. Returns null when the caller has no
 * relationship to this Association at all. Deliberately its own independent
 * implementation (not a wrapper trusting client-supplied data), mirroring
 * how getOrgAccess is kept independent from has_org_permission in RLS.
 */
export async function getAssociationAccess(associationProfileId: string, userId: string): Promise<AssociationAccess | null> {
  const supabase = createClient();

  const { data: userRow } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  const isAdmin = userRow?.role === "admin";

  const { data: profile } = await supabase.from("profiles").select("id, user_id").eq("id", associationProfileId).maybeSingle();
  const isOwner = !!profile && profile.user_id === userId;

  const caps = await getAssociationCaps(associationProfileId);

  if (isOwner || isAdmin) {
    return { isOwner, isAdmin, isPartner: false, partnerProfileId: null, caps };
  }

  // Resolved in two steps (own profile, then the link) rather than one
  // embedded-filter query — simpler and more certain to behave correctly
  // than filtering through a joined table via PostgREST's embed syntax.
  const { data: ownProfile } = await supabase.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!ownProfile) return null;

  const { data: partnerLink } = await supabase
    .from("association_partners")
    .select("partner_profile_id")
    .eq("association_profile_id", associationProfileId)
    .eq("partner_profile_id", ownProfile.id)
    .eq("status", "active")
    .maybeSingle();

  if (!partnerLink) return null;

  return { isOwner: false, isAdmin: false, isPartner: true, partnerProfileId: partnerLink.partner_profile_id, caps };
}

/**
 * UX-only nav visibility check for DashboardShell — never a security
 * boundary itself (same posture as canManageTeam's own doc comment on that
 * component). True if the signed-in user's OWN profile is an Association
 * Owner on an association_enabled plan, or if they're an active Partner on
 * at least one Association. A wrong answer here only hides/shows a nav
 * link; every actual route still re-derives real access independently.
 */
export async function getAssociationNavAccess(userId: string, ownProfileId: string): Promise<boolean> {
  const caps = await getAssociationCaps(ownProfileId);
  if (caps.enabled) return true;

  const admin = createAdminClient();
  const { count } = await admin
    .from("association_partners")
    .select("id", { count: "exact", head: true })
    .eq("partner_profile_id", ownProfileId)
    .eq("status", "active");
  return (count || 0) > 0;
}

export type AssociationAccessJsonResult =
  | { ok: true; supabase: ReturnType<typeof createClient>; user: { id: string }; access: AssociationAccess }
  | { ok: false; response: NextResponse };

/**
 * The one choke point every /api/association/* route that needs "signed in,
 * and either the Owner/admin or an active Partner of this Association"
 * goes through. `requireOwner: true` additionally rejects an active Partner
 * — used by every Owner-management route (invitations, members, rewards,
 * settings, export).
 */
export async function requireAssociationAccessJson(
  associationProfileId: string,
  opts: { requireOwner?: boolean } = {}
): Promise<AssociationAccessJsonResult> {
  // Every response here pairs a stable `code` with an English fallback
  // `error` string, same convention as demo_invite_disabled/
  // demo_payout_disabled elsewhere in this app — the code is what the UI
  // layer actually matches against to show a translated t.* string; `error`
  // is only ever an untranslated last-resort fallback, never meant to be
  // the primary thing shown (see the bilingual requirement — every one of
  // these codes must have a matching translation before this ships).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ code: "not_authenticated", error: "Not authenticated." }, { status: 401 }) };

  const access = await getAssociationAccess(associationProfileId, user.id);
  if (!access) return { ok: false, response: NextResponse.json({ code: "not_authorized", error: "Not authorized." }, { status: 403 }) };

  if (!access.caps.enabled && !access.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ code: "association_disabled", error: "The Association Program isn't enabled on this plan." }, { status: 403 }),
    };
  }
  if (opts.requireOwner && !access.isOwner && !access.isAdmin) {
    return { ok: false, response: NextResponse.json({ code: "not_authorized", error: "Not authorized." }, { status: 403 }) };
  }

  return { ok: true, supabase, user, access };
}
