// Client-safe types and pure helpers for Association Membership (Phase B1). No server imports here,
// so client components may import this file. The DATABASE is the source of truth for every rule below:
// effectiveState is computed by association_membership_effective_state() (stored state + expires_at +
// grace_days + the database clock) and is only DISPLAYED here. Nothing in this file authorizes anything.

export type MembershipState = "pending" | "active" | "suspended" | "expired" | "cancelled";
export type MembershipAction = "enroll" | "activate" | "suspend" | "reinstate" | "renew" | "cancel";

export interface ManagedMemberInfo {
  memberId: string;
  membershipId: string;
  membershipNumber: string;
  state: MembershipState;
  effectiveState: MembershipState;
  startsAt: string;
  expiresAt: string | null;
  graceDays: number;
  planId: string;
  planNameEn: string | null;
  planNameFr: string | null;
  stateReason: string | null;
}

export interface RosterMember {
  id: string;
  name: string;
  phone: string | null;
  status: "active" | "disabled";
  lifecycleState: MembershipState | null;
  pointsBalance: number;
  membership: ManagedMemberInfo | null;
}

export interface PlanRow {
  id: string;
  name_en: string;
  name_fr: string;
  description_en: string | null;
  description_fr: string | null;
  price_amount: number | string;
  currency: string;
  duration_months: number | null;
  grace_days: number;
  active: boolean;
  sort_order: number;
}

export interface AuditRow {
  id: number;
  action: string;
  actor_kind: "staff" | "system";
  actor_role: string | null;
  target_type: string;
  target_id: string;
  member_id: string | null;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AssociationPerms {
  settings: boolean;
  plans: boolean;
  membershipsView: boolean;
  membershipsManage: boolean;
  audit: boolean;
}

/**
 * Which actions the panel OFFERS for a member's latest term. Presentation only: every action is
 * re-validated by its SQL function, so a stale or forged button can never do something illegal.
 */
export function availableActions(info: ManagedMemberInfo): MembershipAction[] {
  switch (info.effectiveState) {
    case "active":
      return info.expiresAt === null ? ["suspend", "cancel"] : ["suspend", "renew", "cancel"];
    case "suspended":
      return ["reinstate", "cancel"];
    case "pending":
      return new Date(info.startsAt).getTime() <= Date.now() ? ["activate", "cancel"] : ["cancel"];
    case "expired":
      return ["renew"];
    case "cancelled":
      return ["enroll"];
    default:
      return [];
  }
}

// Stable error codes returned by /api/associations/**; the UI translates them (t.association.membership.errors).
export const MEMBERSHIP_ERROR_CODES = [
  "not_authenticated", "permission_denied", "association_disabled", "association_not_found", "membership_not_enabled",
  "membership_not_found", "plan_not_found", "plan_inactive", "member_not_found", "member_association_mismatch",
  "member_disabled_legacy", "already_current_membership", "invalid_state", "term_ended", "not_started",
  "already_renewed", "no_renewal_needed", "suspended_must_reinstate", "not_latest_term", "membership_managed",
  "invalid_transition", "invalid_renewal_lineage", "invalid_input", "invalid_prefix", "start_in_past",
  "start_too_far", "server_error",
] as const;
export type MembershipErrorCode = (typeof MEMBERSHIP_ERROR_CODES)[number];
