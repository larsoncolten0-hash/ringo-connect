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
import type { DraftView } from "@/lib/ai/drafts/view";
import type { ContentView } from "@/lib/ai/content/view";

// The one Ringo AI orchestrator. Setup help, advice, content and support are
// behaviours of this same loop (driven by the prompt, knowledge and tools),
// not separate bots. Per request:
//   conversation → snapshot + diagnostics → prompt → model ⇄ read-only tools
//   (capped rounds) → store reply → record usage.

export type ChatEvent =
  | { type: "start"; conversationId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "draft"; draft: DraftView }
  | { type: "content"; content: ContentView }
  | { type: "done"; messageId: string; toolsUsed: string[]; truncated: boolean }
  | { type: "error"; code: AiRuntimeError };

export interface ChatRequest {
  access: AiAccess;
  locale: AiLocale;
  conversationId: string | null;
  message: string;
  /** A URL already verified (by the chat route) to be this caller's own upload. */
  imageUrl?: string | null;
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

// Model work is aborted after this long so the request always reaches
// finishUsage (and its tokens count toward limits) before the platform kills
// the function at the chat route's maxDuration (60s).
const CHAT_DEADLINE_MS = 50_000;

export async function runChat({ access, locale, conversationId, message, imageUrl, emit, signal: clientSignal }: ChatRequest): Promise<void> {
  const { workspace, settings, provider } = access;
  const started = Date.now();
  const deadline = new AbortController();
  let deadlineHit = false;
  const deadlineTimer = setTimeout(() => {
    deadlineHit = true;
    deadline.abort();
  }, CHAT_DEADLINE_MS);
  const onClientAbort = () => deadline.abort();
  if (clientSignal?.aborted) deadline.abort();
  else clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  const signal = deadline.signal;
  let usage: AiUsage = EMPTY_USAGE;
  let toolRounds = 0;
  let toolCalls = 0;
  let convId: string | null = null;

  // Exactly one usage row per request, even if a later step throws into the
  // catch below after usage was already recorded.
  let usageRecorded = false;
  const finishUsage = async (status: "ok" | "error", errorCode: string | null) => {
    if (usageRecorded) return;
    usageRecorded = true;
    await recordUsageEvent({
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
  };

  // 1. Conversation (ownership + workspace re-checked server-side).
  let history: AiMessage[] = [];
  if (conversationId) {
    const conv = await getOwnConversation(workspace.userId, conversationId);
    if (!conv || conv.profile_id !== workspace.profileId) {
      clearTimeout(deadlineTimer);
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
  // Persisted content stays plain text, by design (see the module comment):
  // an attached image is recorded as a literal `[image: <url>]` marker, the
  // same ground truth later draft provenance checks (imageUrlFromOwner) look
  // for — the image itself is never replayed on later turns.
  await appendMessage(activeConversationId, "user", imageUrl ? `${message}\n[image: ${imageUrl}]` : message);

  try {
    // 2. Verified context.
    const snapshot = await loadWorkspaceSnapshot(workspace);
    const findings = runDiagnostics(snapshot);
    const contextCard = buildUserContext(workspace, snapshot, findings, locale);
    const toolCtx: AiToolContext = {
      workspace,
      snapshot,
      locale,
      conversationId: activeConversationId,
      emitDraft: (draft) => emit({ type: "draft", draft }),
      emitContent: (content) => emit({ type: "content", content }),
    };
    const tools = settings.maxToolRounds > 0 ? getAvailableTools(toolCtx) : [];
    const system = {
      stable: buildStableSystemPrompt(),
      dynamic: buildDynamicSystemPrompt(contextCard, [snapshot.profile.category, ...snapshot.profile.categories].filter((c): c is string => !!c)),
    };

    // The image is included on THIS turn only (never replayed from history —
    // stored messages are text-only, see above).
    const userParts: AiContentPart[] = [{ type: "text", text: message }, ...(imageUrl ? [{ type: "image" as const, url: imageUrl }] : [])];
    const messages: AiMessage[] = [...history, { role: "user", parts: userParts }];
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
    if (error instanceof AiProviderError && error.partialUsage) usage = addUsage(usage, error.partialUsage);
    const errorCode = deadlineHit ? "timeout" : error instanceof AiProviderError ? `provider_${error.code}` : "internal";
    await finishUsage("error", errorCode);
    emit({ type: "error", code });
  } finally {
    clearTimeout(deadlineTimer);
    clientSignal?.removeEventListener("abort", onClientAbort);
  }
}
