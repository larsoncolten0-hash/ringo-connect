// Provider-neutral contract between Ringo AI and whichever model provider
// backs it. The orchestrator, tools, knowledge and UI only ever see these
// types — switching providers means writing one new adapter next to
// anthropic.ts and pointing ai_settings.provider at it, nothing else.

import type { AiEffort } from "@/lib/ai/settings";

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object). Adapters pass it through as-is. */
  inputSchema: Record<string, unknown>;
}

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: "user" | "assistant";
  parts: AiContentPart[];
  /**
   * Opaque, provider-specific copy of an assistant turn produced inside the
   * current tool loop (e.g. Anthropic thinking blocks that must be replayed
   * unchanged). Only the adapter that produced it reads it; it is never
   * persisted or sent to the browser.
   */
  providerState?: unknown;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export interface AiTurnRequest {
  model: string;
  /**
   * `stable` is identical for every user (identity, rules, core knowledge,
   * tool catalog) and is what providers may cache; `dynamic` is this
   * user's context card and category knowledge and comes after it.
   */
  system: { stable: string; dynamic: string };
  messages: AiMessage[];
  tools: AiToolSpec[];
  maxOutputTokens: number;
  effort: AiEffort;
  signal?: AbortSignal;
}

export type AiStopReason = "end" | "tool_calls" | "max_tokens" | "refusal" | "other";

export interface AiTurnResult {
  message: AiMessage;
  stopReason: AiStopReason;
  usage: AiUsage;
}

export interface AiTurnHandlers {
  onTextDelta?: (delta: string) => void;
}

export type AiProviderErrorCode = "rate_limited" | "overloaded" | "unavailable" | "auth" | "bad_request" | "unknown";

/** The only error type an adapter may throw — never a raw SDK/HTTP error. */
export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    /** Tokens the provider reported before the turn failed or was aborted, so they still count toward limits. */
    public readonly partialUsage?: AiUsage
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiProvider {
  readonly id: string;
  /** True when the server has the credentials this provider needs. */
  isConfigured(): boolean;
  runTurn(request: AiTurnRequest, handlers?: AiTurnHandlers): Promise<AiTurnResult>;
}
