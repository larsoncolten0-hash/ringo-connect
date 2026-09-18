import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { ManagedMemberInfo, MembershipState } from "@/lib/association/membershipTypes";

// Server-only helpers for Association Membership (Phase B1). Every state change goes through the narrow
// SECURITY DEFINER RPCs; nothing here writes a table directly.

type Admin = ReturnType<typeof createAdminClient>;

const CODE_STATUS: Record<string, number> = {
  permission_denied: 403, association_disabled: 403,
  association_not_found: 404, membership_not_found: 404, plan_not_found: 404, member_not_found: 404,
  membership_not_enabled: 409, plan_inactive: 409, member_association_mismatch: 409, member_disabled_legacy: 409,
  already_current_membership: 409, invalid_state: 409, term_ended: 409, not_started: 409, already_renewed: 409,
  no_renewal_needed: 409, suspended_must_reinstate: 409, not_latest_term: 409, membership_managed: 409,
  invalid_transition: 409, invalid_renewal_lineage: 409,
  invalid_input: 400, invalid_prefix: 400, start_in_past: 400, start_too_far: 400,
};

/** Maps a database error raised by a membership RPC to a stable {code} response (no English text). */
export function rpcErrorResponse(error: { message?: string; code?: string } | null): NextResponse {
  const message = error?.message ?? "";
  let code: string | null = message in CODE_STATUS ? message : null;
  if (!code) {
    if (message === "lifecycle_write_denied") code = "membership_managed";
    else if (error?.code === "23514") code = "invalid_input";
    else if (error?.code === "23505") code = "already_current_membership";
    else if (error?.code === "42501") code = "permission_denied";
  }
  if (!code) {
    console.error("membership rpc error:", message || error);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ code }, { status: CODE_STATUS[code] });
}

export const badRequest = (code = "invalid_input") => NextResponse.json({ code }, { status: 400 });

export const str = (v: unknown, max = 300): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

type TermRow = Record<string, any>;

function toInfo(t: TermRow, plans: Map<string, { name_en: string; name_fr: string }>): ManagedMemberInfo {
  const plan = plans.get(t.plan_id);
  return {
    memberId: t.member_id,
    membershipId: t.id,
    membershipNumber: t.membership_number,
    state: t.state as MembershipState,
    effectiveState: (t.effective_state || t.state) as MembershipState,
    startsAt: t.starts_at,
    expiresAt: t.expires_at,
    graceDays: t.grace_days,
    planId: t.plan_id,
    planNameEn: plan?.name_en ?? null,
    planNameFr: plan?.name_fr ?? null,
    stateReason: t.state_reason ?? null,
  };
}

/**
 * The latest term of each given member, with the DATABASE-computed effective state
 * (association_memberships_effective). Throws if the view is unavailable (migration not applied).
 */
export async function loadLatestTerms(admin: Admin, associationId: string, memberIds: string[]): Promise<Record<string, ManagedMemberInfo>> {
  if (memberIds.length === 0) return {};
  const { data: terms, error } = await admin
    .from("association_memberships_effective")
    .select("*")
    .eq("association_id", associationId)
    .in("member_id", memberIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const planIds = Array.from(new Set((terms || []).map((t: TermRow) => t.plan_id)));
  const plans = new Map<string, { name_en: string; name_fr: string }>();
  if (planIds.length > 0) {
    const { data: planRows } = await admin.from("association_membership_plans").select("id, name_en, name_fr").in("id", planIds);
    (planRows || []).forEach((p: any) => plans.set(p.id, { name_en: p.name_en, name_fr: p.name_fr }));
  }
  const out: Record<string, ManagedMemberInfo> = {};
  for (const t of (terms || []) as TermRow[]) if (!out[t.member_id]) out[t.member_id] = toInfo(t, plans);
  return out;
}

/**
 * Server-rendered "managed member map" for the Owner view, available at first paint (so a managed member
 * never shows the dead legacy toggle). Never throws: if Membership isn't installed yet (migration not
 * applied) or anything fails, it reports available:false and the legacy view behaves exactly as before.
 */
export async function getManagedMemberMap(associationId: string): Promise<{ available: boolean; map: Record<string, ManagedMemberInfo> }> {
  try {
    const admin = createAdminClient();
    const probe = await admin.from("association_memberships_effective").select("id", { head: true, count: "exact" }).eq("association_id", associationId);
    if (probe.error) return { available: false, map: {} };
    const { data: members, error } = await admin
      .from("association_members")
      .select("id")
      .eq("association_id", associationId)
      .not("lifecycle_state", "is", null);
    if (error) return { available: false, map: {} };
    const map = await loadLatestTerms(admin, associationId, (members || []).map((m: any) => m.id));
    return { available: true, map };
  } catch {
    return { available: false, map: {} };
  }
}
