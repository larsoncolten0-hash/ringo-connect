// Browser-side helper for sending a reply. It only ever calls OUR route (/api/inbox/conversations/<id>/messages); it never talks to Meta and
// never sees a token. The request carries the text and a client_request_id, nothing else: the conversation (in the URL) decides the recipient.

export const MAX_REPLY_LENGTH = 4096;
export const replyUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;

export type ReplyResponse = { ok: true; state: string; message_id?: string } | { ok: false; error: string; state?: string; message_id?: string };
export type PostResult = { kind: "response"; status: number; body: ReplyResponse } | { kind: "network" };

export async function postReply(conversationId: string, text: string, clientRequestId: string, fetchImpl: typeof fetch = fetch): Promise<PostResult> {
  try {
    const res = await fetchImpl(replyUrl(conversationId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, client_request_id: clientRequestId }),
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as ReplyResponse | null;
    if (!body || typeof body !== "object" || typeof (body as any).ok !== "boolean") return { kind: "network" };
    return { kind: "response", status: res.status, body };
  } catch {
    return { kind: "network" };
  }
}

export type ErrorKey = "emptyMessage" | "messageTooLong" | "sendFailedMessage" | "windowClosed" | "notConfigured" | "accountDisabled" | "rateLimited";
export interface ReplyEffect {
  /** Empty the text box (the message was stored: sent, pending, unconfirmed or failed-and-visible-in-the-thread). */
  clearText: boolean;
  /** Keep using the SAME client_request_id on the next attempt (the outcome is unknown, so a retry must be idempotent). */
  keepRequestId: boolean;
  error: ErrorKey | null;
  /** Reload the server-rendered thread. */
  refresh: boolean;
}

/** What the composer does with the server's answer. Pure, so the retry/idempotency rules are testable. */
export function interpretReply(r: PostResult): ReplyEffect {
  if (r.kind === "network") return { clearText: false, keepRequestId: true, error: "sendFailedMessage", refresh: false };
  const b = r.body;
  if (b.ok) return { clearText: true, keepRequestId: false, error: null, refresh: true };
  // A definite failure that was stored: the failed bubble (with its Retry button) is now in the thread.
  if (b.state === "failed") return { clearText: true, keepRequestId: false, error: null, refresh: true };
  switch (b.error) {
    case "empty": return { clearText: false, keepRequestId: false, error: "emptyMessage", refresh: false };
    case "too_long": return { clearText: false, keepRequestId: false, error: "messageTooLong", refresh: false };
    case "window_closed": return { clearText: false, keepRequestId: false, error: "windowClosed", refresh: true };
    case "not_configured": return { clearText: false, keepRequestId: false, error: "notConfigured", refresh: false };
    case "account_disabled": return { clearText: false, keepRequestId: false, error: "accountDisabled", refresh: false };
    case "rate_limited": return { clearText: false, keepRequestId: false, error: "rateLimited", refresh: false };
    case "server_error": return { clearText: false, keepRequestId: true, error: "sendFailedMessage", refresh: false };
    default: return { clearText: false, keepRequestId: false, error: "sendFailedMessage", refresh: false };
  }
}

export const newRequestId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");

// ---- owner actions (saved replies, close / reopen): same rule as replies, the browser only calls OUR routes with the few fields below ----
export type ToolResponse = { ok: true; id?: string; state?: string } | { ok: false; error: string };
export type ToolCall = { kind: "response"; status: number; body: ToolResponse } | { kind: "network" };

export async function callInboxTool(method: "POST" | "PATCH" | "DELETE", url: string, body: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<ToolCall> {
  try {
    const res = await fetchImpl(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = (await res.json().catch(() => null)) as ToolResponse | null;
    if (!data || typeof data !== "object" || typeof (data as any).ok !== "boolean") return { kind: "network" };
    return { kind: "response", status: res.status, body: data };
  } catch {
    return { kind: "network" };
  }
}

export const savedRepliesUrl = (id?: string) => (id ? `/api/inbox/saved-replies/${encodeURIComponent(id)}` : "/api/inbox/saved-replies");
export const statusUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/status`;

export type ToolErrorKey = "replyTitleTaken" | "replyLimit" | "replyInvalid" | "savedReplyFailed" | "savedReplyGone" | "statusUpdateFailed";
/** Maps the server's answer to the message the person should see. */
export function toolErrorKey(c: ToolCall, kind: "saved" | "status"): ToolErrorKey | null {
  if (c.kind === "response" && c.body.ok) return null;
  const fallback: ToolErrorKey = kind === "status" ? "statusUpdateFailed" : "savedReplyFailed";
  if (c.kind === "network") return fallback;
  const e = (c.body as { error?: string }).error;
  if (kind === "saved") {
    if (e === "duplicate_title") return "replyTitleTaken";
    if (e === "limit_reached") return "replyLimit";
    if (e === "invalid") return "replyInvalid";
    if (e === "not_found") return "savedReplyGone";
  }
  return fallback;
}
