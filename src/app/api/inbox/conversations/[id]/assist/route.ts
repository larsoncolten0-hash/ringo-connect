import { NextResponse } from "next/server";
import { releaseAiQuota, reserveAiQuota, resolveAiAccess } from "@/lib/ai/guard";
import { estimateCostUsd, recordUsageEvent } from "@/lib/ai/usage";
import { isAiLocale } from "@/lib/ai/types";
import { createClient } from "@/lib/supabase/server";
import { guardConversationAction, recordMemberActivity } from "@/lib/inbox/actorRoute";
import { resolveOrganizationAiAccess } from "@/lib/ai/inboxStaffAccess";
import { loadThread } from "@/lib/inbox/data";
import { isUuid } from "@/lib/inbox/format";
import { ASSIST_DEADLINE_MS, ASSIST_MAX_MESSAGES, isAssistAction, runAssist, type AssistError } from "@/lib/inbox/aiAssist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inbox/conversations/<id>/assist   JSON { action: "summarize" | "suggest_reply", locale: "en" | "fr" }
// Writes text for the owner (or a team member holding inbox.ai) to READ. It sends nothing, changes nothing and has no tools. The browser decides what to do with the text (show it,
// or put it in the reply box); a person still has to press Send. Only action + locale are read from the body: the conversation (URL) is checked
// against the signed-in user's relation to the organization that owns it (owner, or an active team member with inbox.ai, decided by the database), and the
// messages are loaded here on the server from the database, never accepted from the browser. For a team member, Ringo AI eligibility (plan, ai_enabled,
// demo, beta) and the QUOTA are the ORGANIZATION OWNER'S: the usage is charged to the owner's shared pool, and the staff member is only the actor.
// The same gates as Ringo AI apply (kill switch, plan/beta, per-user limits, atomic quota reservation, one usage row, no message text stored).
// An AI failure never affects replying: this route is separate from the reply routes and the composer works without it.
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const DENY_STATUS: Record<string, number> = { not_authenticated: 401, disabled: 403, not_configured: 503 };
const LIMIT_STATUS: Record<string, number> = { daily_limit: 429, monthly_limit: 429, budget_reached: 429, quota_unavailable: 503 };
const ERROR_STATUS: Record<AssistError, number> = {
  empty_conversation: 422, window_closed: 409, provider_busy: 503, provider_unavailable: 503, response_blocked: 422, response_truncated: 502, empty_answer: 502, internal: 500,
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ ok: false, error: "invalid" }, 415);
  const guard = await guardConversationAction(params.id, "inbox.ai");
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);
  if (!isUuid(params.id)) return json({ ok: false, error: "invalid" }, 422);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !isAssistAction((body as any).action)) return json({ ok: false, error: "invalid" }, 422);
  const action = (body as any).action;
  const locale = isAiLocale((body as any).locale) ? (body as any).locale : "en";

  if (!guard.profileId) return json({ ok: false, error: "not_found" }, 404);
  // the user's own session: RLS (owner read, or the staff read policy for inbox.view) AND the server-resolved organization id both apply
  const thread = await loadThread(createClient(), guard.profileId, params.id, ASSIST_MAX_MESSAGES);
  if (!thread.ok) return json({ ok: false, error: thread.reason === "not_found" ? "not_found" : "internal" }, thread.reason === "not_found" ? 404 : 500);
  if (action === "suggest_reply" && !thread.thread.conversation.replyWindowOpen) return json({ ok: false, error: "window_closed" }, 409);

  let access: Awaited<ReturnType<typeof resolveAiAccess>>;
  if (guard.kind === "owner") {
    access = await resolveAiAccess();
    if (!access.ok) return json({ ok: false, error: "ai_unavailable", reason: access.reason }, DENY_STATUS[access.reason] ?? 403);
    // the AI workspace must be this same owner's own profile
    if (access.access.workspace.profileId !== guard.profileId || access.access.workspace.userId !== guard.userId) return json({ ok: false, error: "ai_unavailable", reason: "staff_workspace" }, 403);
  } else {
    // a team member: the ORGANIZATION OWNER'S eligibility and quota (the member was authorized for inbox.ai by the database above)
    access = await resolveOrganizationAiAccess({ ownerProfileId: guard.profileId, staffUserId: guard.userId });
    if (!access.ok) return json({ ok: false, error: "ai_unavailable", reason: access.reason }, DENY_STATUS[access.reason] ?? 403);
  }

  const quota = await reserveAiQuota(access.access);
  if (!quota.ok) return json({ ok: false, error: "ai_unavailable", reason: quota.reason }, LIMIT_STATUS[quota.reason] ?? 429);

  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), ASSIST_DEADLINE_MS);
  request.signal?.addEventListener("abort", () => deadline.abort(), { once: true });
  try {
    const result = await runAssist(
      { provider: access.access.provider, settings: access.access.settings, signal: deadline.signal },
      { action, locale, messages: thread.thread.messages },
    );
    await recordUsageEvent({
      userId: access.access.workspace.userId,
      profileId: access.access.workspace.profileId,
      conversationId: null,
      provider: access.access.provider.id,
      model: access.access.settings.modelChat,
      status: result.ok ? "ok" : "error",
      errorCode: result.ok ? null : `inbox_assist_${result.error}`,
      usage: result.usage,
      toolRounds: 0,
      toolCalls: 0,
      latencyMs: Date.now() - started,
      costUsd: estimateCostUsd(result.usage, access.access.settings),
    });
    if (!result.ok) return json({ ok: false, error: result.error }, ERROR_STATUS[result.error]);
    // internal attribution for a team member (ids and the action only: never the conversation text or the AI answer)
    await recordMemberActivity(guard, "inbox_ai_assist", { conversationId: params.id, action });
    return json({ ok: true, ...result.output }, 200);
  } catch {
    console.error(JSON.stringify({ scope: "inbox_assist", result: "failed" }));
    return json({ ok: false, error: "internal" }, 500);
  } finally {
    clearTimeout(timer);
    await releaseAiQuota(quota.reservationId);
  }
}
