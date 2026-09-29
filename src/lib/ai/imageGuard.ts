import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveAiAccess, type AiAccess } from "./guard";
import type { AiDenyReason } from "./codes";
import { hasImagePricing } from "./settings";

// Ringo AI Image Generation access + quota. The single place the image
// route asks "can this caller generate an image right now" — no plan-name
// logic duplicated anywhere, every check either calls guard.ts's own
// resolveAiAccess() or reads the same admin-editable plan columns it does.
//
// Deliberately a NEW file rather than additions to guard.ts's own
// resolveAiAccess() — that function, and every control it already
// enforces (kill switch, provider configured, account status, profile
// ownership, staff-workspace rule, demo rule, the beta allowlist, and the
// text ai_enabled plan gate), stays completely untouched. This module only
// ever *calls* it and layers image-specific checks on top.
//
// Hierarchy: image access requires text access first — every real plan
// that has ai_image_enabled=true also has ai_enabled=true (see the
// migration), so resolveAiAccess() succeeding is a correct prerequisite,
// not a coincidence.
//
// Beta override: exactly like resolveAiAccess() already lets an
// ai_beta_access grant override the text plan gate, the same grant
// overrides the image plan gate here — a beta tester isn't blocked by
// their plan for either capability.

export type AiImageDenyReason = AiDenyReason | "image_not_eligible";
export type AiImageAccessResult = { ok: true; access: AiAccess } | { ok: false; reason: AiImageDenyReason };

export async function resolveAiImageAccess(): Promise<AiImageAccessResult> {
  const base = await resolveAiAccess();
  if (!base.ok) return base;

  const supabase = createClient();
  // Same users.plan_id -> plans embed pattern as guard.ts's own ai_enabled
  // check and getOrgTeamEnabled (src/lib/team/access.ts) — never a
  // hardcoded plan name.
  const { data: userRow } = await supabase.from("users").select("plans(ai_image_enabled)").eq("id", base.access.workspace.userId).maybeSingle();
  const imageEnabled = (userRow as any)?.plans?.ai_image_enabled === true;

  const { data: beta } = await createAdminClient().from("ai_beta_access").select("user_id").eq("user_id", base.access.workspace.userId).maybeSingle();
  if (!beta && !imageEnabled) return { ok: false, reason: "image_not_eligible" };

  return base;
}

export type AiImageLimitReason = "daily_limit" | "monthly_limit" | "budget_reached" | "quota_unavailable";

export type AiImageQuotaResult = { ok: true; remainingToday: number } | { ok: false; reason: AiImageLimitReason; remainingToday: number };

/**
 * Read-only image quota check — the counterpart to guard.ts's checkAiQuota,
 * counting image-generation ROWS (ai_image_usage_events / the
 * ai_image_quota_snapshot RPC), never text tokens. Fails CLOSED: if the
 * snapshot can't be read, the request is refused rather than allowed
 * through unmetered. For display/status use; reserveAiImageQuota below is
 * what the real generation route enforces (atomic, race-safe).
 */
export async function checkAiImageQuota(access: AiAccess): Promise<AiImageQuotaResult> {
  const { data, error } = await createAdminClient().rpc("ai_image_quota_snapshot", { p_user_id: access.workspace.userId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    if (error) console.error("ai_image_quota_snapshot failed:", error.message);
    return { ok: false, reason: "quota_unavailable", remainingToday: 0 };
  }

  const used24h = Number(row.user_images_24h) || 0;
  const remainingToday = Math.max(0, access.settings.dailyImageLimit - used24h);
  if (remainingToday <= 0) return { ok: false, reason: "daily_limit", remainingToday: 0 };

  if (Number(row.user_images_month) >= access.settings.monthlyImageLimit) {
    return { ok: false, reason: "monthly_limit", remainingToday };
  }

  if (hasImagePricing(access.settings) && Number(row.global_image_cost_month) >= access.settings.monthlyGlobalImageBudgetUsd) {
    return { ok: false, reason: "budget_reached", remainingToday };
  }

  return { ok: true, remainingToday };
}

// Longer than a reasonable image-generation request could take: a
// reservation outlives any request that could still be running, and a
// request that died without releasing stops holding quota shortly after.
const IMAGE_RESERVATION_TTL_SECONDS = 120;

export type AiImageReservationResult =
  | { ok: true; reservationId: string; remainingToday: number }
  | { ok: false; reason: AiImageLimitReason; remainingToday: number };

/**
 * The enforcing limit check for a real image-generation request — the
 * atomic counterpart to checkAiImageQuota, mirroring guard.ts's
 * reserveAiQuota exactly (same advisory-locked RPC pattern, see
 * ai_reserve_image_quota in the migration). Counting every other
 * in-flight request's reservation as already used, so simultaneous
 * requests (tabs, devices) can never all pass on the same remaining
 * quota/budget. The caller MUST release the reservation when the request
 * ends; the real usage is recorded separately (imageUsage.ts), so the
 * estimate never becomes the final accounting. Fails CLOSED.
 */
export async function reserveAiImageQuota(access: AiAccess, reserveCostUsd: number | null): Promise<AiImageReservationResult> {
  const { data, error } = await createAdminClient().rpc("ai_reserve_image_quota", {
    p_user_id: access.workspace.userId,
    p_daily_limit: access.settings.dailyImageLimit,
    p_monthly_limit: access.settings.monthlyImageLimit,
    // Budget enforceable only with pricing configured (same rule as checkAiImageQuota).
    p_global_budget_usd: hasImagePricing(access.settings) ? access.settings.monthlyGlobalImageBudgetUsd : null,
    p_reserve_cost_usd: reserveCostUsd,
    p_ttl_seconds: IMAGE_RESERVATION_TTL_SECONDS,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    if (error) console.error("ai_reserve_image_quota failed:", error.message);
    return { ok: false, reason: "quota_unavailable", remainingToday: 0 };
  }

  const remainingToday = Math.max(0, Number(row.remaining_today) || 0);
  if (typeof row.reservation_id === "string" && row.reservation_id) {
    return { ok: true, reservationId: row.reservation_id, remainingToday };
  }
  const reason: AiImageLimitReason =
    row.deny_reason === "daily_limit" || row.deny_reason === "monthly_limit" || row.deny_reason === "budget_reached" ? row.deny_reason : "quota_unavailable";
  return { ok: false, reason, remainingToday };
}

/**
 * Ends a reservation once the request's real usage has been recorded (or it
 * ended without calling the provider). Idempotent; if it fails, the
 * reservation simply expires after IMAGE_RESERVATION_TTL_SECONDS.
 */
export async function releaseAiImageQuota(reservationId: string): Promise<void> {
  const { error } = await createAdminClient().from("ai_image_quota_reservations").delete().eq("id", reservationId);
  if (error) console.error("releaseAiImageQuota failed:", error.message);
}
