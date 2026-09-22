import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActiveOrgCookie } from "@/lib/team/access";
import { getAiSettings, hasPricing, type AiSettings } from "@/lib/ai/settings";
import { getAiProvider } from "@/lib/ai/providers";
import type { AiProvider } from "@/lib/ai/providers/types";
import type { AiWorkspace } from "@/lib/ai/types";
import type { AiDenyReason, AiLimitReason } from "@/lib/ai/codes";

// The ONLY place Ringo AI decides who may use it and which workspace a
// request runs in. The model never participates in any of this: by the
// time a prompt is built, identity/profile/limits have all been decided
// here from the caller's own Supabase session.
//
// Order of checks (cheapest/most fundamental first):
//   1. signed in                       → not_authenticated
//   2. kill switch                     → disabled
//   3. provider credentials present    → not_configured
//   4. account active                  → account_inactive
//   5. owns a profile                  → no_profile
//   6. not acting inside someone else's organization (Phase 1 is owner-only) → staff_workspace
//   7. not a demo account              → demo_account
//   8. beta allowlist (when enabled)   → not_in_beta
// Usage limits are a separate step (checkAiQuota) so /api/ai/status can
// report "you're in, but out of messages today" distinctly.

export interface AiAccess {
  workspace: AiWorkspace;
  settings: AiSettings;
  provider: AiProvider;
  dailyMessageLimit: number;
  isPlatformAdmin: boolean;
}

export type AiAccessResult = { ok: true; access: AiAccess } | { ok: false; reason: AiDenyReason };

export async function resolveAiAccess(): Promise<AiAccessResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_authenticated" };

  const settings = await getAiSettings();
  if (!settings.enabled) return { ok: false, reason: "disabled" };

  const provider = getAiProvider(settings.provider);
  if (!provider || !provider.isConfigured()) return { ok: false, reason: "not_configured" };

  const { data: userRow } = await supabase.from("users").select("status, role").eq("id", user.id).maybeSingle();
  if (!userRow || userRow.status !== "active") return { ok: false, reason: "account_inactive" };

  // Allow-listed columns only — never select("*") on profiles (it carries
  // encrypted pixel tokens).
  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("id, username, is_demo")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownProfile) return { ok: false, reason: "no_profile" };

  // Same selection rule as the dashboard (pickActiveOrganization): the
  // active-org cookie only counts when it points at an organization the
  // user really is an active member of. If they're currently working inside
  // someone else's business, Phase 1 AI is unavailable rather than silently
  // answering about the wrong workspace.
  const activeOrg = getActiveOrgCookie();
  if (activeOrg && activeOrg !== ownProfile.id) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("profile_id", activeOrg)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membership) return { ok: false, reason: "staff_workspace" };
  }

  if (ownProfile.is_demo === true) return { ok: false, reason: "demo_account" };

  let dailyMessageLimit = settings.dailyMessageLimit;
  const { data: beta } = await createAdminClient()
    .from("ai_beta_access")
    .select("user_id, daily_message_limit_override")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settings.accessMode === "allowlist" && !beta) return { ok: false, reason: "not_in_beta" };
  if (beta && typeof beta.daily_message_limit_override === "number") dailyMessageLimit = beta.daily_message_limit_override;

  return {
    ok: true,
    access: {
      workspace: { userId: user.id, profileId: ownProfile.id, username: ownProfile.username, actor: { kind: "owner" } },
      settings,
      provider,
      dailyMessageLimit,
      isPlatformAdmin: userRow.role === "admin",
    },
  };
}

export type AiQuotaResult =
  | { ok: true; remainingToday: number }
  | { ok: false; reason: AiLimitReason; remainingToday: number };

/**
 * Per-user daily requests, per-user monthly tokens and the global monthly
 * budget, in one RPC round trip. Fails CLOSED: if the snapshot can't be
 * read, the request is refused rather than allowed through unmetered.
 */
export async function checkAiQuota(access: AiAccess): Promise<AiQuotaResult> {
  const { data, error } = await createAdminClient().rpc("ai_quota_snapshot", { p_user_id: access.workspace.userId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    if (error) console.error("ai_quota_snapshot failed:", error.message);
    return { ok: false, reason: "quota_unavailable", remainingToday: 0 };
  }

  const used24h = Number(row.user_requests_24h) || 0;
  const remainingToday = Math.max(0, access.dailyMessageLimit - used24h);
  if (remainingToday <= 0) return { ok: false, reason: "daily_limit", remainingToday: 0 };

  if (Number(row.user_tokens_month) >= access.settings.monthlyUserTokenLimit) {
    return { ok: false, reason: "monthly_limit", remainingToday };
  }

  // The global budget is enforceable only when pricing is configured (cost
  // is null otherwise) — /admin/ai shows a warning in that state.
  if (hasPricing(access.settings) && Number(row.global_cost_month) >= access.settings.monthlyGlobalBudgetUsd) {
    return { ok: false, reason: "budget_reached", remainingToday };
  }

  return { ok: true, remainingToday };
}
