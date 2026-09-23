import { NextResponse } from "next/server";
import { releaseAiQuota, reserveAiQuota, resolveAiAccess } from "@/lib/ai/guard";
import { runChat, type ChatEvent } from "@/lib/ai/orchestrator";
import { AI_MAX_USER_MESSAGE_CHARS } from "@/lib/ai/codes";
import { isAiLocale } from "@/lib/ai/types";
import { isUuid } from "@/lib/customer/connect";
import { isOwnAiUploadUrl } from "@/lib/ai/uploads";

// POST /api/ai/chat — one Ringo AI turn, streamed as NDJSON (one ChatEvent
// per line). Everything that decides WHO and WHAT (identity, workspace,
// beta access, limits) happens before the stream starts, from the caller's
// own session; the body only carries the message, the UI locale and an
// optional conversation id (which is re-checked for ownership).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_BY_REASON: Record<string, number> = {
  not_authenticated: 401,
  daily_limit: 429,
  monthly_limit: 429,
  budget_reached: 429,
  quota_unavailable: 503,
  not_configured: 503,
  disabled: 403,
};

export async function POST(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const locale = isAiLocale(body?.locale) ? body.locale : "fr";
  const conversationId = body?.conversationId == null ? null : body.conversationId;
  if (!message || message.length > AI_MAX_USER_MESSAGE_CHARS || (conversationId !== null && !isUuid(conversationId))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  // Only a URL this same caller actually got back from POST /api/ai/uploads/image
  // is ever used — anything else (an arbitrary or another user's URL) is
  // silently dropped rather than sent to the model provider to fetch.
  const rawImageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : null;
  const imageUrl = rawImageUrl && isOwnAiUploadUrl(rawImageUrl, access.access.workspace.userId) ? rawImageUrl : null;

  // Atomic check-and-reserve (see guard.ts): concurrent requests can't all
  // pass on the same remaining quota. Released in `finally` below — after
  // runChat has recorded the real usage — on every path: success, error,
  // timeout, client abort.
  const quota = await reserveAiQuota(access.access);
  if (!quota.ok) return NextResponse.json({ error: quota.reason }, { status: STATUS_BY_REASON[quota.reason] ?? 429 });
  const reservationId = quota.reservationId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await runChat({ access: access.access, locale, conversationId, message, imageUrl, emit, signal: request.signal });
      } catch (error) {
        console.error("ai chat route failed:", error instanceof Error ? error.message : error);
        emit({ type: "error", code: "internal" });
      } finally {
        await releaseAiQuota(reservationId);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed (client went away)
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
