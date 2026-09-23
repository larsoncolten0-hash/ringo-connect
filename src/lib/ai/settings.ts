import { createAdminClient } from "@/lib/supabase/server";

// Ringo AI runtime configuration — the single ai_settings row (see
// supabase/migrations/2026-10-25_ringo_ai_foundation.sql). Read with the
// service-role client because it's a system-level decision (kill switch,
// limits) made before any per-user data is touched, and the row is
// admin-read-only under RLS.

export type AiEffort = "low" | "medium" | "high";
export type AiAccessMode = "allowlist" | "all_owners";

export interface AiSettings {
  enabled: boolean;
  accessMode: AiAccessMode;
  provider: string;
  modelChat: string;
  effort: AiEffort;
  dailyMessageLimit: number;
  monthlyUserTokenLimit: number;
  monthlyGlobalBudgetUsd: number;
  maxToolRounds: number;
  maxOutputTokens: number;
  historyMessageLimit: number;
  pricing: {
    inputPerMTok: number | null;
    outputPerMTok: number | null;
    cacheReadPerMTok: number | null;
    cacheWritePerMTok: number | null;
  };
}

// Fail-closed fallback: used only when the row can't be read, and always
// with `enabled: false`, so a missing/unreadable settings row can never
// silently turn Ringo AI on.
const FAIL_CLOSED: AiSettings = {
  enabled: false,
  accessMode: "allowlist",
  provider: "anthropic",
  modelChat: "claude-sonnet-5",
  effort: "medium",
  dailyMessageLimit: 0,
  monthlyUserTokenLimit: 0,
  monthlyGlobalBudgetUsd: 0,
  maxToolRounds: 0,
  maxOutputTokens: 2048,
  historyMessageLimit: 6,
  pricing: { inputPerMTok: null, outputPerMTok: null, cacheReadPerMTok: null, cacheWritePerMTok: null },
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function mapAiSettingsRow(row: Record<string, unknown> | null | undefined): AiSettings {
  if (!row) return FAIL_CLOSED;
  return {
    enabled: row.enabled === true,
    accessMode: row.access_mode === "all_owners" ? "all_owners" : "allowlist",
    provider: typeof row.provider === "string" ? row.provider : "anthropic",
    modelChat: typeof row.model_chat === "string" ? row.model_chat : FAIL_CLOSED.modelChat,
    effort: row.effort === "low" || row.effort === "high" ? row.effort : "medium",
    dailyMessageLimit: num(row.daily_message_limit) ?? 0,
    monthlyUserTokenLimit: num(row.monthly_user_token_limit) ?? 0,
    monthlyGlobalBudgetUsd: num(row.monthly_global_budget_usd) ?? 0,
    maxToolRounds: num(row.max_tool_rounds) ?? 0,
    maxOutputTokens: num(row.max_output_tokens) ?? 2048,
    historyMessageLimit: num(row.history_message_limit) ?? 6,
    pricing: {
      inputPerMTok: num(row.price_input_per_mtok_usd),
      outputPerMTok: num(row.price_output_per_mtok_usd),
      cacheReadPerMTok: num(row.price_cache_read_per_mtok_usd),
      cacheWritePerMTok: num(row.price_cache_write_per_mtok_usd),
    },
  };
}

export const AI_SETTINGS_COLUMNS =
  "enabled, access_mode, provider, model_chat, effort, daily_message_limit, monthly_user_token_limit, monthly_global_budget_usd, max_tool_rounds, max_output_tokens, history_message_limit, price_input_per_mtok_usd, price_output_per_mtok_usd, price_cache_read_per_mtok_usd, price_cache_write_per_mtok_usd, updated_at";

export async function getAiSettings(): Promise<AiSettings> {
  const { data, error } = await createAdminClient().from("ai_settings").select(AI_SETTINGS_COLUMNS).eq("id", 1).maybeSingle();
  if (error) {
    console.error("getAiSettings failed:", error.message);
    return FAIL_CLOSED;
  }
  return mapAiSettingsRow(data as Record<string, unknown> | null);
}

/** True when every price is set, so cost (and the global budget) can be computed. */
export function hasPricing(settings: AiSettings): boolean {
  const p = settings.pricing;
  return p.inputPerMTok !== null && p.outputPerMTok !== null && p.cacheReadPerMTok !== null && p.cacheWritePerMTok !== null;
}

/**
 * Validates an admin's settings update (PUT /api/admin/ai/settings) into a
 * DB patch. Unknown keys are ignored; any invalid value rejects the whole
 * update (returns null) rather than half-applying it. Ranges mirror the
 * table's CHECK constraints.
 */
export function parseAiSettingsPatch(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  // A blank limit is rejected, not coerced: Number(null) and Number("") are 0,
  // which would silently block every user (daily limit 0, budget $0).
  const blank = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");

  const intIn = (key: string, col: string, min: number, max: number) => {
    if (b[key] === undefined) return true;
    if (blank(b[key])) return false;
    const v = Number(b[key]);
    if (!Number.isInteger(v) || v < min || v > max) return false;
    patch[col] = v;
    return true;
  };
  const priceIn = (key: string, col: string) => {
    if (b[key] === undefined) return true;
    if (b[key] === null || b[key] === "") {
      patch[col] = null;
      return true;
    }
    const v = Number(b[key]);
    if (!Number.isFinite(v) || v < 0 || v > 10000) return false;
    patch[col] = v;
    return true;
  };

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return null;
    patch.enabled = b.enabled;
  }
  if (b.accessMode !== undefined) {
    if (b.accessMode !== "allowlist" && b.accessMode !== "all_owners") return null;
    patch.access_mode = b.accessMode;
  }
  if (b.modelChat !== undefined) {
    const m = typeof b.modelChat === "string" ? b.modelChat.trim() : "";
    if (!/^[a-z0-9][a-z0-9.\-_]{0,99}$/i.test(m)) return null;
    patch.model_chat = m;
  }
  if (b.effort !== undefined) {
    if (b.effort !== "low" && b.effort !== "medium" && b.effort !== "high") return null;
    patch.effort = b.effort;
  }
  if (b.monthlyGlobalBudgetUsd !== undefined) {
    if (blank(b.monthlyGlobalBudgetUsd)) return null;
    const v = Number(b.monthlyGlobalBudgetUsd);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return null;
    patch.monthly_global_budget_usd = v;
  }

  const ok =
    intIn("dailyMessageLimit", "daily_message_limit", 0, 1000) &&
    intIn("monthlyUserTokenLimit", "monthly_user_token_limit", 0, 1_000_000_000) &&
    intIn("maxToolRounds", "max_tool_rounds", 0, 8) &&
    intIn("maxOutputTokens", "max_output_tokens", 512, 16000) &&
    intIn("historyMessageLimit", "history_message_limit", 2, 40) &&
    priceIn("priceInputPerMTok", "price_input_per_mtok_usd") &&
    priceIn("priceOutputPerMTok", "price_output_per_mtok_usd") &&
    priceIn("priceCacheReadPerMTok", "price_cache_read_per_mtok_usd") &&
    priceIn("priceCacheWritePerMTok", "price_cache_write_per_mtok_usd");
  if (!ok) return null;

  return patch;
}
