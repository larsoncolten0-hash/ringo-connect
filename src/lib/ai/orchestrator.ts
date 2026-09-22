import type { AiAccess } from "@/lib/ai/guard";
import type { AiLocale } from "@/lib/ai/types";
import type { AiRuntimeError } from "@/lib/ai/codes";
import { AiProviderError, EMPTY_USAGE, addUsage, type AiContentPart, type AiMessage, type AiUsage } from "@/lib/ai/providers/types";
import { loadWorkspaceSnapshot } from "@/lib/ai/context/snapshot";
import { buildUserContext } from "@/lib/ai/context/buildUserContext";
import { runDiagnostics } from "@/lib/ai/diagnostics";
import { buildDynamicSystemPrompt, buildStableSystemPrompt } from "@/lib/ai/prompts/system";
import { executeTool, getAvailableTools, toToolSpecs } from "@/lib/ai/tools/registry";
import type { AiToolContext } from "@/lib/ai/tools/types";
import { appendMessage, createConversation, getOwnConversation, listConversationMessages } from "@/lib/ai/conversations";
import { estimateCostUsd, recordUsageEvent } from "@/lib/ai/usage";

// The one Ringo AI orchestrator. Setup help, advice, content and support are
// behaviours of this same loop (driven by the prompt, knowledge and tools),
// not separate bots. Per request:
//   conversation → snapshot + diagnostics → prompt → model ⇄ read-only tools
//   (capped rounds) → store reply → record usage.

export type ChatEvent =
  | { type: "start"; conversationId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "done"; messageId: string; toolsUsed: string[]; truncated: boolean }
  | { type: "error"; code: AiRuntimeError };

export interface ChatRequest {
  access: AiAccess;
  locale: AiLocale;
  conversationId: string | null;
  message: string;
  emit: (event: ChatEvent) => void;
  signal?: AbortSignal;
}

function mapProviderError(error: unknown): AiRuntimeError {
  if (error instanceof AiProviderError) {
    return error.code === "rate_limited" || error.code === "overloaded" ? "provider_busy" : "provider_unavailable";
  }
  return "internal";
}

const TOOL_BUDGET_NOTE = "Tool limit for this message reached. Answer now using what you already have; do not call more tools.";

export async function runChat({ access, locale, conversationId, message, emit, signal }: ChatRequest): Promise<void> {
  const { workspace, settings, provider } = access;
  const started = Date.now();
  let usage: AiUsage = EMPTY_USAGE;
  let toolRounds = 0;
  let toolCalls = 0;
  let convId: string | null = null;

  const finishUsage = (status: "ok" | "error", errorCode: string | null) =>
    recordUsageEvent({
      userId: workspace.userId,
      profileId: workspace.profileId,
      conversationId: convId,
      provider: provider.id,
      model: settings.modelChat,
      status,
      errorCode,
      usage,
      toolRounds,
      toolCalls,
      latencyMs: Date.now() - started,
      costUsd: estimateCostUsd(usage, settings),
    });

  // 1. Conversation (ownership + workspace re-checked server-side).
  let history: AiMessage[] = [];
  if (conversationId) {
    const conv = await getOwnConversation(workspace.userId, conversationId);
    if (!conv || conv.profile_id !== workspace.profileId) {
      emit({ type: "error", code: "conversation_not_found" });
      return;
    }
    convId = conv.id;
    const stored = await listConversationMessages(conv.id, settings.historyMessageLimit);
    history = stored.map((m) => ({ role: m.role, parts: [{ type: "text", text: m.content }] }));
    // The provider requires the conversation to start with a user turn.
    while (history.length && history[0].role !== "user") history.shift();
  }
  const activeConversationId: string = convId ?? (await createConversation(workspace.userId, workspace.profileId, locale, message));
  convId = activeConversationId;
  emit({ type: "start", conversationId: activeConversationId });
  await appendMessage(activeConversationId, "user", message);

  try {
    // 2. Verified context.
    const snapshot = await loadWorkspaceSnapshot(workspace);
    const findings = runDiagnostics(snapshot);
    const contextCard = buildUserContext(workspace, snapshot, findings, locale);
    const toolCtx: AiToolContext = { workspace, snapshot, locale };
    const tools = settings.maxToolRounds > 0 ? getAvailableTools(toolCtx) : [];
    const system = {
      stable: buildStableSystemPrompt(),
      dynamic: buildDynamicSystemPrompt(contextCard, [snapshot.profile.category, ...snapshot.profile.categories].filter((c): c is string => !!c)),
    };

    const messages: AiMessage[] = [...history, { role: "user", parts: [{ type: "text", text: message }] }];
    const replyParts: string[] = [];
    const toolsUsed = new Set<string>();
    let truncated = false;

    // 3. Model ⇄ tools loop.
    for (;;) {
      let turnText = "";
      const turn = await provider.runTurn(
        {
          model: settings.modelChat,
          system,
          messages,
          tools: toToolSpecs(tools),
          maxOutputTokens: settings.maxOutputTokens,
          effort: settings.effort,
          signal,
        },
        {
          onTextDelta: (delta) => {
            turnText += delta;
            emit({ type: "text", delta });
          },
        }
      );
      usage = addUsage(usage, turn.usage);
      if (turnText.trim()) replyParts.push(turnText.trim());

      if (turn.stopReason === "refusal") {
        await finishUsage("error", "refusal");
        emit({ type: "error", code: "response_blocked" });
        return;
      }
      if (turn.stopReason === "max_tokens") {
        truncated = true;
        break;
      }

      const calls = turn.message.parts.filter((p): p is Extract<AiContentPart, { type: "tool_call" }> => p.type === "tool_call");
      if (turn.stopReason !== "tool_calls" || calls.length === 0) break;

      if (toolRounds >= settings.maxToolRounds) {
        // Budget spent and the model still wants tools: stop here with what we have.
        truncated = replyParts.length === 0;
        break;
      }

      toolRounds += 1;
      toolCalls += calls.length;
      messages.push(turn.message);
      for (const call of calls) {
        toolsUsed.add(call.name);
        emit({ type: "tool", name: call.name });
      }
      const results = await Promise.all(calls.map((call) => executeTool(call.name, call.input, toolCtx, tools)));
      const resultParts: AiContentPart[] = calls.map((call, i) => ({
        type: "tool_result",
        toolCallId: call.id,
        content: results[i].content,
        isError: results[i].isError,
      }));
      if (toolRounds >= settings.maxToolRounds) resultParts.push({ type: "text", text: TOOL_BUDGET_NOTE });
      messages.push({ role: "user", parts: resultParts });
    }

    const reply = replyParts.join("\n\n").trim();
    if (!reply) {
      await finishUsage("error", truncated ? "empty_truncated" : "empty_reply");
      emit({ type: "error", code: truncated ? "response_truncated" : "internal" });
      return;
    }

    const messageId = await appendMessage(activeConversationId, "assistant", reply, Array.from(toolsUsed));
    await finishUsage("ok", truncated ? "truncated" : null);
    emit({ type: "done", messageId, toolsUsed: Array.from(toolsUsed), truncated });
  } catch (error) {
    const code = mapProviderError(error);
    console.error("ringo ai chat failed:", error instanceof Error ? `${error.name}: ${error.message}` : error);
    await finishUsage("error", error instanceof AiProviderError ? `provider_${error.code}` : "internal");
    emit({ type: "error", code });
  }
}
