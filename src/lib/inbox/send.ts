import { MAX_TEXT_LENGTH, getWhatsAppAccessToken, sendWhatsAppText } from "@/lib/whatsapp/outbound";
import type { RpcClient } from "@/lib/whatsapp/ingest";
import { isUuid } from "./format";

// One human reply: ONE user action -> ONE intended outbound message.
//
//   1. validate the input (text only; the conversation id and the request id are UUIDs)
//   2. refuse early if the Meta token is not configured (before anything is stored)
//   3. inbox_prepare_outbound_text   -> ONE 'queued' row, idempotent on client_request_id; the recipient and the business phone number id
//                                       are read from the database (nothing recipient-like is ever accepted from the request)
//   4. send to Meta (server side only)
//   5. inbox_complete_outbound (accepted)  /  inbox_fail_outbound (definitively rejected)  /  leave 'queued' (outcome unknown)
//
// The caller has ALREADY authenticated the user; `userId` is the session user. The database re-checks that the conversation belongs to
// that user's profile, so a guessed conversation id finds nothing.
//
// Duplicate-send window (Meta has no idempotency key): if the process dies or the response is lost AFTER Meta accepted the message but
// BEFORE step 5, the row stays 'queued' with no wamid. It is reported as "unconfirmed" and is NEVER re-sent automatically; a replay with the
// same request id returns the existing row without contacting Meta. A user who types the message again creates a new, deliberate send.

export interface SendDeps {
  admin: RpcClient;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}
export interface SendInput {
  userId: string;
  conversationId: unknown;
  clientRequestId: unknown;
  text: unknown;
}
export type SendErrorCode = "empty" | "too_long" | "invalid" | "not_found" | "conflict" | "account_disabled" | "window_closed" | "rate_limited" | "send_failed" | "not_configured" | "server_error";
export type SendState = "sent" | "delivered" | "read" | "pending" | "unconfirmed" | "failed";
export interface SendResult {
  status: number;
  body: { ok: true; state: SendState; message_id: string } | { ok: false; error: SendErrorCode; state?: "failed"; message_id?: string };
}

const fail = (status: number, error: SendErrorCode, extra: { state?: "failed"; message_id?: string } = {}): SendResult => ({ status, body: { ok: false, error, ...extra } });
const okResult = (status: number, state: SendState, message_id: string): SendResult => ({ status, body: { ok: true, state, message_id } });

// Ids and categories only: never the text, the recipient, the token, a header or Meta's own error message.
function log(entry: Record<string, unknown>) {
  console.error(JSON.stringify({ scope: "whatsapp_send", ...entry }));
}

async function rpc(admin: RpcClient, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) return { ok: false, code: String(res.error.code || "rpc_error").slice(0, 20) };
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, code: "rpc_exception" };
  }
}

export async function sendReply(deps: SendDeps, input: SendInput): Promise<SendResult> {
  if (!isUuid(input.conversationId) || !isUuid(input.clientRequestId) || !isUuid(input.userId)) return fail(422, "invalid");
  if (typeof input.text !== "string") return fail(422, "empty");
  const text = input.text.trim();
  if (text === "") return fail(422, "empty");
  if (Array.from(text).length > MAX_TEXT_LENGTH) return fail(422, "too_long");

  const token = getWhatsAppAccessToken(deps.env);
  if (!token) {
    log({ result: "not_configured" });
    return fail(503, "not_configured");
  }

  const prep = await rpc(deps.admin, "inbox_prepare_outbound_text", {
    p_actor_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_client_request_id: input.clientRequestId,
    p_body: text,
  });
  if (!prep.ok) {
    log({ result: "prepare_failed", code: prep.code });
    return fail(500, "server_error");
  }
  const p = (prep.data && typeof prep.data === "object" ? prep.data : {}) as Record<string, unknown>;
  const messageId = typeof p.message_id === "string" ? p.message_id : "";

  switch (p.result) {
    case "not_found": return fail(404, "not_found");
    case "invalid": return fail(422, "invalid");
    case "conflict": return fail(409, "conflict");
    case "account_disabled": return fail(409, "account_disabled");
    case "window_closed": return fail(409, "window_closed");
    case "existing": {
      // A replay: the original row decides. Meta is NOT contacted again.
      const s = p.status;
      if (s === "sent" || s === "delivered" || s === "read") return okResult(200, s, messageId);
      if (s === "failed") return fail(422, "send_failed", { state: "failed", message_id: messageId });
      return okResult(202, "pending", messageId);
    }
    case "created": break;
    default:
      log({ result: "prepare_unexpected" });
      return fail(500, "server_error");
  }

  const phoneNumberId = typeof p.phone_number_id === "string" ? p.phone_number_id : "";
  const to = typeof p.to === "string" ? p.to : "";
  const outcome = await sendWhatsAppText({ phoneNumberId, to, body: text, token }, deps.fetchImpl);

  if (outcome.kind === "accepted") {
    const done = await rpc(deps.admin, "inbox_complete_outbound", { p_actor_user_id: input.userId, p_message_id: messageId, p_provider_message_id: outcome.providerMessageId });
    if (done.ok && (done.data === "ok" || done.data === "duplicate")) return okResult(200, "sent", messageId);
    // Meta accepted but the database could not record it: the wamid is logged (it is an id, not personal data) so it can be reconciled.
    log({ result: "complete_failed", message_id: messageId, provider_message_id: outcome.providerMessageId, code: done.ok ? String(done.data) : done.code });
    return okResult(202, "unconfirmed", messageId);
  }

  if (outcome.kind === "rejected") {
    const marked = await rpc(deps.admin, "inbox_fail_outbound", { p_actor_user_id: input.userId, p_message_id: messageId, p_error_codes: outcome.code === null ? [] : [outcome.code] });
    log({ result: "meta_rejected", message_id: messageId, http_status: outcome.httpStatus, meta_code: outcome.code, marked: marked.ok ? marked.data : marked.code });
    return fail(422, outcome.error === "rejected" ? "send_failed" : outcome.error, { state: "failed", message_id: messageId });
  }

  // Unknown outcome: leave the row 'queued'. Never retried automatically.
  log({ result: "outcome_unknown", message_id: messageId, reason: outcome.reason });
  return okResult(202, "unconfirmed", messageId);
}
