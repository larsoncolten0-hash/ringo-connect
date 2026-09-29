import OpenAI, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { FunctionTool, ResponseInputItem, ResponseOutputItem, Response as OpenAIResponse } from "openai/resources/responses/responses";
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

// OpenAI adapter — the ONLY file in the codebase that imports the `openai`
// package. Server-only: OPENAI_API_KEY is read from the environment here and
// never leaves the server. Uses the Responses API (client.responses.stream),
// OpenAI's current unified interface for text, tool calls and streaming.
//
// Continuation state: unlike Anthropic's single `content` array, a Responses
// API tool-call turn is a list of separate `output` items (a `message` item
// plus one `function_call` item per call, each with its own `call_id`). That
// whole array is stashed in `providerState` and replayed verbatim on the next
// turn — exactly mirroring how the Anthropic adapter replays `thinking`
// blocks — see toOpenAIInput below. The API requires the original
// `function_call` item to be replayed alongside its `function_call_output`;
// discarding it would break the tool loop.
//
// Effort: `reasoning.effort` only applies to reasoning-tier models and errors
// on plain chat models. `text.verbosity` is the closest knob that works
// across the whole model line without erroring, so AiEffort maps there
// instead — the values (low/medium/high) match exactly.
//
// Partial usage on abort/failure: unlike the Anthropic SDK (which exposes a
// public `stream.currentMessage` snapshot), this version of the OpenAI SDK
// keeps its in-flight response snapshot private on `ResponseStream`, with no
// public accessor. Partial usage genuinely can't be recovered here — the
// request's already-accumulated usage from earlier tool rounds still counts.
//
// providerState sanitization: `final.output` items are OUTPUT items, and the
// SDK enriches them with convenience-only fields (e.g. `parsed_arguments` on
// a function_call, `parsed` on an output_text part) that exist purely for
// reading a response — the API's INPUT schema for replaying those same items
// back rejects unrecognized fields outright ("Unknown parameter:
// 'input[1].parsed_arguments'", confirmed against the live API). Every
// providerState item is therefore rebuilt through an explicit allow-list
// before replay, keeping only the fields the Responses API documents as
// valid input. Ringo only ever produces "message" and "function_call" output
// items (no reasoning-tier model, no built-in tools) — any other item type
// is passed through unchanged rather than guessed at.

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 60_000 });
  }
  return client;
}

type MessageContentPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" };

/**
 * Rebuilds one `final.output` item through an explicit allow-list of the
 * fields the Responses API's INPUT schema actually accepts, dropping every
 * SDK-added output-only convenience field. See the module comment above.
 */
function sanitizeProviderStateItem(item: ResponseOutputItem): ResponseInputItem {
  if (item.type === "function_call") {
    return { type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments, id: item.id, status: item.status };
  }
  if (item.type === "message") {
    return {
      id: item.id,
      type: "message",
      role: item.role,
      status: item.status,
      content: item.content.map((c) =>
        c.type === "output_text" ? { type: "output_text" as const, text: c.text, annotations: c.annotations } : { type: "refusal" as const, refusal: c.refusal }
      ),
    };
  }
  return item as unknown as ResponseInputItem;
}

function toOpenAIInput(messages: AiMessage[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  for (const m of messages) {
    // An assistant turn from THIS request's tool loop is replayed exactly as
    // the API returned it (the message + function_call items), as the
    // Responses API requires for multi-turn tool calling — sanitized first
    // (see sanitizeProviderStateItem) since the raw SDK items aren't
    // themselves valid input.
    if (m.role === "assistant" && Array.isArray(m.providerState)) {
      items.push(...(m.providerState as ResponseOutputItem[]).map(sanitizeProviderStateItem));
      continue;
    }
    let content: MessageContentPart[] = [];
    const flush = () => {
      if (content.length) {
        items.push({ role: m.role, type: "message", content });
        content = [];
      }
    };
    for (const part of m.parts) {
      if (part.type === "text") {
        if (part.text) content.push({ type: "input_text", text: part.text });
      } else if (part.type === "image") {
        content.push({ type: "input_image", image_url: part.url, detail: "auto" });
      } else if (part.type === "tool_call") {
        // Defensive only — assistant tool-call turns always carry
        // providerState (set by this same adapter below) and are handled by
        // the branch above, so this is never reached in practice.
        flush();
        items.push({ type: "function_call", call_id: part.id, name: part.name, arguments: JSON.stringify(part.input ?? {}) });
      } else if (part.type === "tool_result") {
        flush();
        items.push({ type: "function_call_output", call_id: part.toolCallId, output: part.content });
      }
    }
    flush();
  }
  return items;
}

function mapStopReason(final: OpenAIResponse, hasToolCall: boolean, hasRefusal: boolean): AiStopReason {
  if (hasRefusal) return "refusal";
  if (hasToolCall) return "tool_calls";
  if (final.status === "incomplete") {
    return final.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "other";
  }
  return "end";
}

function mapError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof RateLimitError) return new AiProviderError("rate_limited", "Provider rate limit");
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AiProviderError("auth", "Provider credentials rejected");
  }
  if (error instanceof BadRequestError) return new AiProviderError("bad_request", "Provider rejected the request");
  if (error instanceof InternalServerError) return new AiProviderError("overloaded", "Provider overloaded");
  if (error instanceof APIUserAbortError) return new AiProviderError("unavailable", "Request aborted");
  if (error instanceof APIConnectionError) return new AiProviderError("unavailable", "Provider unreachable");
  if (error instanceof APIError) return new AiProviderError("unknown", `Provider error ${error.status ?? ""}`.trim());
  return new AiProviderError("unknown", "Unexpected provider failure");
}

export const openaiProvider: AiProvider = {
  id: "openai",

  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  },

  async runTurn(request: AiTurnRequest, handlers?: AiTurnHandlers): Promise<AiTurnResult> {
    const instructions = request.system.dynamic ? `${request.system.stable}\n\n${request.system.dynamic}` : request.system.stable;

    const tools: FunctionTool[] = request.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: true,
    }));

    try {
      const stream = getClient().responses.stream(
        {
          model: request.model,
          instructions,
          input: toOpenAIInput(request.messages),
          ...(tools.length > 0 ? { tools } : {}),
          max_output_tokens: request.maxOutputTokens,
          text: { verbosity: request.effort },
          // Ringo replays full history itself on every turn (like the
          // Anthropic adapter); nothing here relies on OpenAI-side
          // conversation state, so it isn't retained server-side either.
          store: false,
        },
        { signal: request.signal }
      );
      if (handlers?.onTextDelta) stream.on("response.output_text.delta", (event) => handlers.onTextDelta!(event.delta));

      const final = await stream.finalResponse();

      // A failed or cancelled response must never be read as a successful
      // final answer — its `output` may be empty or stale.
      if (final.status === "failed" || final.status === "cancelled") {
        throw new AiProviderError("unknown", final.error?.message || `Provider response ${final.status}`);
      }

      const parts: AiContentPart[] = [];
      let hasToolCall = false;
      let hasRefusal = false;
      for (const item of final.output) {
        if (item.type === "message") {
          for (const c of item.content) {
            if (c.type === "output_text") parts.push({ type: "text", text: c.text });
            else if (c.type === "refusal") hasRefusal = true;
          }
        } else if (item.type === "function_call") {
          hasToolCall = true;
          let input: unknown = {};
          try {
            input = JSON.parse(item.arguments || "{}");
          } catch {
            input = {};
          }
          parts.push({ type: "tool_call", id: item.call_id, name: item.name, input });
        }
      }

      const usage = final.usage;
      return {
        message: { role: "assistant", parts, providerState: final.output },
        stopReason: mapStopReason(final, hasToolCall, hasRefusal),
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
        },
      };
    } catch (error) {
      throw mapError(error);
    }
  },
};
