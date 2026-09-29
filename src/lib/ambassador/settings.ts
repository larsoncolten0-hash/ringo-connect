// Ambassador Program — payout policy setting.
//
// The minimum payout lives in exactly one place: the
// platform_settings.ambassador_min_payout_xaf column (default 500, defined once
// in 2026-11-24_ambassador_min_payout_setting.sql). It is ENFORCED inside the
// ambassador_request_payout() SQL function. This module only READS it (for
// display) and lets an admin CHANGE it — it never decides whether a payout is
// allowed, and it deliberately has no fallback number of its own: if the value
// can't be read (e.g. the migration isn't applied yet) callers get `null` and
// simply show nothing.
import { fapshiMinDisbursementXaf } from "@/lib/ambassador/fapshiLimits";

const MAX_MINIMUM_XAF = 10_000_000;

export async function getAmbassadorPayoutMinimum(admin: any): Promise<number | null> {
  try {
    const { data, error } = await admin.from("platform_settings").select("ambassador_min_payout_xaf").limit(1).maybeSingle();
    if (error || data?.ambassador_min_payout_xaf == null) return null;
    const n = Number(data.ambassador_min_payout_xaf);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Admin-only (the route checks assertAdmin). The floor is Fapshi's own
 *  disbursement minimum — an external technical limit, not a business number. */
export async function setAmbassadorPayoutMinimum(admin: any, actorId: string, value: unknown): Promise<{ ok: true; minimum: number } | { ok: false; code: "invalid_minimum" | "failed" }> {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < fapshiMinDisbursementXaf() || n > MAX_MINIMUM_XAF) return { ok: false, code: "invalid_minimum" };
  const minimum = Math.round(n * 100) / 100;

  const { data: row } = await admin.from("platform_settings").select("id, ambassador_min_payout_xaf").limit(1).maybeSingle();
  if (!row) return { ok: false, code: "failed" };
  const before = row.ambassador_min_payout_xaf; // captured now, before the update can change anything
  const { error } = await admin.from("platform_settings").update({ ambassador_min_payout_xaf: minimum, updated_at: new Date().toISOString(), updated_by: actorId }).eq("id", row.id);
  if (error) {
    console.error("ambassador min payout update failed:", error.message);
    return { ok: false, code: "failed" };
  }
  try {
    await admin.rpc("ambassador_log_action", {
      p_actor_user_id: actorId,
      p_action: "min_payout_changed",
      p_target_table: "platform_settings",
      p_target_id: row.id,
      p_before: { ambassador_min_payout_xaf: before },
      p_after: { ambassador_min_payout_xaf: minimum },
      p_reason: null,
    });
  } catch (err: any) {
    console.error("ambassador_log_action threw:", err?.message);
  }
  return { ok: true, minimum };
}
