import { createAdminClient } from "@/lib/supabase/server";
import { hasPricing, type AiSettings } from "@/lib/ai/settings";
import type { AiUsage } from "@/lib/ai/providers/types";

// One ai_usage_events row per chat request (all tool rounds aggregated).
// Holds counts, timings and codes only — never message text or tool data.

export function estimateCostUsd(usage: AiUsage, settings: AiSettings): number | null {
  if (!hasPricing(settings)) return null;
  const p = settings.pricing;
  const cost =
    (usage.inputTokens * (p.inputPerMTok as number) +
      usage.outputTokens * (p.outputPerMTok as number) +
      usage.cacheReadTokens * (p.cacheReadPerMTok as number) +
      usage.cacheWriteTokens * (p.cacheWritePerMTok as number)) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// Input tokens one model turn may send: shared prompt + tool definitions +
// context card are ~6k tokens today; the rest is headroom for history and
// accumulated tool results. Deliberately generous — a reservation only holds
// quota while the request runs and is replaced by the real usage at the end.
export const RESERVE_INPUT_TOKENS_PER_TURN = 20_000;

/**
 * Upper-bound estimate reserved (ai_reserve_quota) before a chat request
 * runs: every allowed model turn (tool rounds + the final answer) at the
 * input estimate plus the full output cap. Input is priced at the dearer of
 * the input and cache-write prices. Cost is null when pricing isn't set.
 */
export function estimateReservation(settings: AiSettings): { tokens: number; costUsd: number | null } {
  const turns = Math.max(0, settings.maxToolRounds) + 1;
  const inputTokens = turns * RESERVE_INPUT_TOKENS_PER_TURN;
  const outputTokens = turns * settings.maxOutputTokens;
  if (!hasPricing(settings)) return { tokens: inputTokens + outputTokens, costUsd: null };
  const p = settings.pricing;
  const inputPrice = Math.max(p.inputPerMTok as number, p.cacheWritePerMTok as number);
  const cost = (inputTokens * inputPrice + outputTokens * (p.outputPerMTok as number)) / 1_000_000;
  return { tokens: inputTokens + outputTokens, costUsd: Math.ceil(cost * 1_000_000) / 1_000_000 };
}

export interface UsageEventInput {
  userId: string;
  profileId: string;
  conversationId: string | null;
  provider: string;
  model: string;
  status: "ok" | "error";
  errorCode: string | null;
  usage: AiUsage;
  toolRounds: number;
  toolCalls: number;
  latencyMs: number;
  costUsd: number | null;
}

export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_usage_events")
    .insert({
      user_id: input.userId,
      profile_id: input.profileId,
      conversation_id: input.conversationId,
      provider: input.provider.slice(0, 40),
      model: input.model.slice(0, 100),
      status: input.status,
      error_code: input.errorCode ? input.errorCode.slice(0, 60) : null,
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      cache_read_tokens: input.usage.cacheReadTokens,
      cache_write_tokens: input.usage.cacheWriteTokens,
      tool_rounds: input.toolRounds,
      tool_calls: input.toolCalls,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      cost_usd: input.costUsd,
    });
  if (error) console.error("recordUsageEvent failed:", error.message);
}
