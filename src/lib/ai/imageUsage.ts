import { createAdminClient } from "@/lib/supabase/server";
import { hasImagePricing, type AiSettings } from "@/lib/ai/settings";

// One ai_image_usage_events row per attempted image generation. Mirrors
// usage.ts's shape and philosophy exactly, but token-based (image tokens,
// not chat tokens) and centered on real, current OpenAI pricing rather than
// an invented flat per-image number — see the migration's comment for the
// exact source figures.

export interface AiImageUsage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
}

export const EMPTY_IMAGE_USAGE: AiImageUsage = { inputTextTokens: 0, inputImageTokens: 0, outputTokens: 0 };

/** Real cost from the provider's own reported token usage — never a flat guess. */
export function estimateImageCostUsd(usage: AiImageUsage, settings: AiSettings): number | null {
  if (!hasImagePricing(settings)) return null;
  const p = settings.imagePricing;
  const cost =
    (usage.inputTextTokens * (p.inputTextPerMTok as number) +
      usage.inputImageTokens * (p.inputImagePerMTok as number) +
      usage.outputTokens * (p.outputPerMTok as number)) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * A pre-generation cost estimate for the atomic reservation
 * (ai_reserve_image_quota), used only to protect the global budget against
 * concurrent requests. Never invented: it's the average actual cost of the
 * last 20 successful generations with the SAME model/size/quality. Returns
 * null (budget unenforced for this one reservation, exactly like when
 * pricing isn't configured at all) when there's no history yet — e.g. the
 * very first generation for a given model/size/quality combination. This
 * self-calibrates from real recorded usage rather than guessing.
 */
export async function estimateImageReservationCost(model: string, size: string, quality: string): Promise<number | null> {
  const { data, error } = await createAdminClient()
    .from("ai_image_usage_events")
    .select("cost_usd")
    .eq("model", model)
    .eq("size", size)
    .eq("quality", quality)
    .eq("status", "ok")
    .not("cost_usd", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("estimateImageReservationCost failed:", error.message);
    return null;
  }
  const costs = (data || []).map((r: { cost_usd: unknown }) => Number(r.cost_usd)).filter((n: number) => Number.isFinite(n));
  if (!costs.length) return null;
  const avg = costs.reduce((a: number, b: number) => a + b, 0) / costs.length;
  return Math.round(avg * 1_000_000) / 1_000_000;
}

export interface ImageUsageEventInput {
  userId: string;
  profileId: string;
  conversationId: string | null;
  model: string;
  size: string;
  quality: string;
  status: "ok" | "error";
  errorCode: string | null;
  usage: AiImageUsage;
  costUsd: number | null;
  storagePath: string | null;
  providerRequestId: string | null;
}

export async function recordImageUsageEvent(input: ImageUsageEventInput): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_image_usage_events")
    .insert({
      user_id: input.userId,
      profile_id: input.profileId,
      conversation_id: input.conversationId,
      model: input.model.slice(0, 100),
      size: input.size.slice(0, 20),
      quality: input.quality.slice(0, 20),
      status: input.status,
      error_code: input.errorCode ? input.errorCode.slice(0, 60) : null,
      input_text_tokens: input.usage.inputTextTokens,
      input_image_tokens: input.usage.inputImageTokens,
      output_tokens: input.usage.outputTokens,
      cost_usd: input.costUsd,
      storage_path: input.storagePath,
      provider_request_id: input.providerRequestId ? input.providerRequestId.slice(0, 100) : null,
    });
  if (error) console.error("recordImageUsageEvent failed:", error.message);
}
