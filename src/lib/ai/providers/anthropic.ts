import Anthropic from "@anthropic-ai/sdk";
import {
  AiProviderError,
  type AiContentPart,
  type AiMessage,
  type AiProvider,
  type AiStopReason,
  type AiTurnHandlers,
  type AiTurnRequest,
  type AiTurnResult,
} from "./types";

// Anthropic (Claude) adapter — the ONLY file in the codebase that imports
// @anthropic-ai/sdk. Server-only: ANTHROPIC_API_KEY is read from the
// environment here and never leaves the server.
//
// Caching: tools render before system, so the cache breakpoint on the
// stable system block covers the tool definitions too; the per-user
// `dynamic` block sits after it and never invalidates the shared prefix.
//
// Tool inputs are small enums here, so fine-grained (eager) input streaming
// is deliberately NOT enabled — that keeps server-side `strict` schema
// validation, and every input is re-validated in tools/registry.ts anyway.

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  }
  return client;
}

function toAnthropicContent(parts: AiContentPart[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: part.text });
    } else if (part.type === "tool_call") {
      blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input as Record<string, unknown> });
    } else {
      blocks.push({ type: "tool_result", tool_use_id: part.toolCallId, content: part.content, is_error: part.isError || undefined });
    }
  }
  return blocks;
}

function toAnthropicMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    // An assistant turn from THIS request's tool loop is replayed exactly as
    // the API returned it (thinking blocks included), as the API requires.
    if (m.role === "assistant" && Array.isArray(m.providerState)) {
      return { role: "assistant", content: m.providerState as Anthropic.ContentBlockParam[] };
    }
    return { role: m.role, content: toAnthropicContent(m.parts) };
  });
}

function mapStopReason(reason: Anthropic.StopReason | null): AiStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function mapError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Anthropic.RateLimitError) return new AiProviderError("rate_limited", "Provider rate limit");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError("auth", "Provider credentials rejected");
  }
  if (error instanceof Anthropic.BadRequestError) return new AiProviderError("bad_request", "Provider rejected the request");
  if (error instanceof Anthropic.InternalServerError) return new AiProviderError("overloaded", "Provider overloaded");
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError("unavailable", "Provider unreachable");
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(error.status === 529 ? "overloaded" : "unknown", `Provider error ${error.status ?? ""}`.trim());
  }
  return new AiProviderError("unknown", "Unexpected provider failure");
}

export const anthropicProvider: AiProvider = {
  id: "anthropic",

  isConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async runTurn(request: AiTurnRequest, handlers?: AiTurnHandlers): Promise<AiTurnResult> {
    const system: Anthropic.TextBlockParam[] = [{ type: "text", text: request.system.stable, cache_control: { type: "ephemeral" } }];
    if (request.system.dynamic) system.push({ type: "text", text: request.system.dynamic });

    const tools: Anthropic.Tool[] = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      strict: true,
    }));

    let stream: ReturnType<Anthropic["messages"]["stream"]> | null = null;
    try {
      stream = getClient().messages.stream(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system,
          messages: toAnthropicMessages(request.messages),
          ...(tools.length > 0 ? { tools } : {}),
          thinking: { type: "adaptive" },
          output_config: { effort: request.effort },
        },
        { signal: request.signal }
      );
      if (handlers?.onTextDelta) stream.on("text", handlers.onTextDelta);

      const final = await stream.finalMessage();

      const parts: AiContentPart[] = [];
      for (const block of final.content) {
        if (block.type === "text") parts.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") parts.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
      }

      return {
        message: { role: "assistant", parts, providerState: final.content },
        stopReason: mapStopReason(final.stop_reason),
        usage: {
          inputTokens: final.usage.input_tokens ?? 0,
          outputTokens: final.usage.output_tokens ?? 0,
          cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (error) {
      // An aborted or failed stream may already have consumed (billed) input
      // and output tokens; report them so usage limits still count them.
      const mapped = mapError(error);
      const u = stream?.currentMessage?.usage;
      if (!u) throw mapped;
      throw new AiProviderError(mapped.code, mapped.message, {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      });
    }
  },
};
