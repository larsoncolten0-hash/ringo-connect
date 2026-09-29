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
  /**
   * Image generation. Configured separately from the text model above;
   * never hardcoded in the image provider code. See src/lib/ai/imageGuard.ts
   * and src/lib/ai/imageUsage.ts.
   */
  imageModel: string;
  imageDefaultSize: string;
  imageDefaultQuality: string;
  dailyImageLimit: number;
  monthlyImageLimit: number;
  monthlyGlobalImageBudgetUsd: number;
  pricing: {
    inputPerMTok: number | null;
    outputPerMTok: number | null;
    cacheReadPerMTok: number | null;
    cacheWritePerMTok: number | null;
  };
  /**
   * Image pricing — token-based, mirroring how OpenAI actually bills the
   * GPT image models (confirmed against current OpenAI pricing docs, not
   * a flat per-image rate): separate rates for text tokens in the prompt,
   * image tokens in the input, and output image tokens. Null until an
   * admin fills them in; cost (and the image budget) can't be computed
   * until then — same rule the text pricing above already follows.
   */
  imagePricing: {
    inputTextPerMTok: number | null;
    inputImagePerMTok: number | null;
    outputPerMTok: number | null;
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
  imageModel: "gpt-image-2.5-flare",
  imageDefaultSize: "auto",
  imageDefaultQuality: "auto",
  dailyImageLimit: 0,
  monthlyImageLimit: 0,
  monthlyGlobalImageBudgetUsd: 0,
  pricing: { inputPerMTok: null, outputPerMTok: null, cacheReadPerMTok: null, cacheWritePerMTok: null },
  imagePricing: { inputTextPerMTok: null, inputImagePerMTok: null, outputPerMTok: null },
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
    imageModel: typeof row.image_model === "string" ? row.image_model : FAIL_CLOSED.imageModel,
    imageDefaultSize: typeof row.image_default_size === "string" ? row.image_default_size : FAIL_CLOSED.imageDefaultSize,
    imageDefaultQuality: typeof row.image_default_quality === "string" ? row.image_default_quality : FAIL_CLOSED.imageDefaultQuality,
    dailyImageLimit: num(row.daily_image_limit) ?? 0,
    monthlyImageLimit: num(row.monthly_image_limit) ?? 0,
    monthlyGlobalImageBudgetUsd: num(row.monthly_global_image_budget_usd) ?? 0,
    pricing: {
      inputPerMTok: num(row.price_input_per_mtok_usd),
      outputPerMTok: num(row.price_output_per_mtok_usd),
      cacheReadPerMTok: num(row.price_cache_read_per_mtok_usd),
      cacheWritePerMTok: num(row.price_cache_write_per_mtok_usd),
    },
    imagePricing: {
      inputTextPerMTok: num(row.image_price_input_text_per_mtok_usd),
      inputImagePerMTok: num(row.image_price_input_image_per_mtok_usd),
      outputPerMTok: num(row.image_price_output_per_mtok_usd),
    },
  };
}

export const AI_SETTINGS_COLUMNS =
  "enabled, access_mode, provider, model_chat, effort, daily_message_limit, monthly_user_token_limit, monthly_global_budget_usd, max_tool_rounds, max_output_tokens, history_message_limit, price_input_per_mtok_usd, price_output_per_mtok_usd, price_cache_read_per_mtok_usd, price_cache_write_per_mtok_usd, image_model, image_default_size, image_default_quality, daily_image_limit, monthly_image_limit, monthly_global_image_budget_usd, image_price_input_text_per_mtok_usd, image_price_input_image_per_mtok_usd, image_price_output_per_mtok_usd, updated_at";

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

/** True when every image price is set, so image cost (and the image budget) can be computed. */
export function hasImagePricing(settings: AiSettings): boolean {
  const p = settings.imagePricing;
  return p.inputTextPerMTok !== null && p.inputImagePerMTok !== null && p.outputPerMTok !== null;
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
  // Same shape as priceIn, named separately only for readability at the call site.
  const imagePriceIn = priceIn;

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
  // Shape only — whether this id is an actually-registered provider is
  // checked by the route handler (which has the provider registry), keeping
  // this function's validation generic like every other field here.
  if (b.provider !== undefined) {
    const p = typeof b.provider === "string" ? b.provider.trim() : "";
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(p)) return null;
    patch.provider = p;
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
  // Image generation. Same model-id shape as modelChat. Size/quality are
  // restricted to the values the current GPT image model family (the
  // configured default is gpt-image-2.5-flare) actually supports, per
  // current OpenAI documentation — 'xhigh'/'max' quality and arbitrary
  // WIDTHxHEIGHT sizes exist too but are deliberately not offered here to
  // keep cost predictable (see imageGuard.ts / the Phase implementation
  // report's cost-safety section).
  if (b.imageModel !== undefined) {
    const m = typeof b.imageModel === "string" ? b.imageModel.trim() : "";
    if (!/^[a-z0-9][a-z0-9.\-_]{0,99}$/i.test(m)) return null;
    patch.image_model = m;
  }
  if (b.imageDefaultSize !== undefined) {
    if (!["auto", "1024x1024", "1536x1024", "1024x1536"].includes(b.imageDefaultSize as string)) return null;
    patch.image_default_size = b.imageDefaultSize;
  }
  if (b.imageDefaultQuality !== undefined) {
    if (!["auto", "low", "medium", "high"].includes(b.imageDefaultQuality as string)) return null;
    patch.image_default_quality = b.imageDefaultQuality;
  }
  if (b.monthlyGlobalImageBudgetUsd !== undefined) {
    if (blank(b.monthlyGlobalImageBudgetUsd)) return null;
    const v = Number(b.monthlyGlobalImageBudgetUsd);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return null;
    patch.monthly_global_image_budget_usd = v;
  }

  const ok =
    intIn("dailyMessageLimit", "daily_message_limit", 0, 1000) &&
    intIn("monthlyUserTokenLimit", "monthly_user_token_limit", 0, 1_000_000_000) &&
    intIn("maxToolRounds", "max_tool_rounds", 0, 8) &&
    intIn("maxOutputTokens", "max_output_tokens", 512, 16000) &&
    intIn("historyMessageLimit", "history_message_limit", 2, 40) &&
    intIn("dailyImageLimit", "daily_image_limit", 0, 1000) &&
    intIn("monthlyImageLimit", "monthly_image_limit", 0, 100000) &&
    priceIn("priceInputPerMTok", "price_input_per_mtok_usd") &&
    priceIn("priceOutputPerMTok", "price_output_per_mtok_usd") &&
    priceIn("priceCacheReadPerMTok", "price_cache_read_per_mtok_usd") &&
    priceIn("priceCacheWritePerMTok", "price_cache_write_per_mtok_usd") &&
    imagePriceIn("imagePriceInputTextPerMTok", "image_price_input_text_per_mtok_usd") &&
    imagePriceIn("imagePriceInputImagePerMTok", "image_price_input_image_per_mtok_usd") &&
    imagePriceIn("imagePriceOutputPerMTok", "image_price_output_per_mtok_usd");
  if (!ok) return null;

  return patch;
}
