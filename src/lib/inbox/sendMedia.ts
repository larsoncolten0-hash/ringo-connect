import { getWhatsAppAccessToken } from "@/lib/whatsapp/outbound";
import { MEDIA_CAPTION_MAX, sendWhatsAppMedia, uploadWhatsAppMedia, validateMediaFile, type MediaProblem } from "@/lib/whatsapp/media";
import type { RpcClient } from "@/lib/whatsapp/ingest";
import { isUuid } from "./format";
import type { SendDeps, SendErrorCode, SendState } from "./send";

// One human media reply: ONE user action -> ONE intended outbound media message. Same security model as the text reply (lib/inbox/send.ts):
//   * the caller has authenticated the user; `userId` is the session user, and the database re-checks that the conversation is theirs
//   * the recipient, the business phone number id and the WABA are read from the database by the prepare function: never from the request
//   * the browser supplies only the file, an optional caption and a request id
//
//   1. validate the file (size, declared type, ACTUAL bytes, extension, name) and the caption          -> nothing is stored if it is refused
//   2. refuse early if the Meta token is not configured                                              -> nothing is stored
//   3. inbox_prepare_outbound_media  -> ONE 'queued' row (idempotent on client_request_id; ownership, 24-hour window, account)
//   4. upload the file to Meta, get a media id          -> any failure: the row is marked FAILED (nothing was sent), never left "sent"
//   5. send the message that references the media id    -> accepted: inbox_complete_outbound_media / rejected: inbox_fail_outbound /
//                                                           unknown: left 'queued' ("not confirmed"), NEVER resent automatically
//
// A replay with the same request id returns the stored row without uploading or sending again, so a double click, a browser retry or a lost
// response cannot produce a second media message. (As with text, Meta has no idempotency key: an unknown outcome after the send is the one
// window the database cannot close; it is reported honestly instead of being retried.)

export type MediaErrorCode = SendErrorCode | MediaProblem | "caption_not_allowed" | "upload_failed";
export interface MediaSendInput {
  userId: string;
  conversationId: unknown;
  clientRequestId: unknown;
  file: { name: unknown; type: unknown; bytes: Uint8Array | null };
  caption: unknown;
}
export interface MediaSendResult {
  status: number;
  body: { ok: true; state: SendState; message_id: string } | { ok: false; error: MediaErrorCode; state?: "failed"; message_id?: string };
}

const fail = (status: number, error: MediaErrorCode, extra: { state?: "failed"; message_id?: string } = {}): MediaSendResult => ({ status, body: { ok: false, error, ...extra } });
const ok = (status: number, state: SendState, message_id: string): MediaSendResult => ({ status, body: { ok: true, state, message_id } });

// Ids and categories only: never the file, its name, the caption, the recipient, the token or Meta's own text.
function log(entry: Record<string, unknown>) {
  console.error(JSON.stringify({ scope: "whatsapp_media", ...entry }));
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

export async function sendMediaReply(deps: SendDeps, input: MediaSendInput): Promise<MediaSendResult> {
  if (!isUuid(input.conversationId) || !isUuid(input.clientRequestId) || !isUuid(input.userId)) return fail(422, "invalid");

  const bytes = input.file.bytes;
  if (!bytes) return fail(422, "empty_file");
  const checked = validateMediaFile({ name: input.file.name, type: input.file.type, bytes });
  if (!checked.ok) return fail(checked.error === "too_large" ? 413 : 422, checked.error);

  let caption: string | null = null;
  if (input.caption !== undefined && input.caption !== null && input.caption !== "") {
    if (typeof input.caption !== "string") return fail(422, "invalid");
    caption = input.caption.trim() || null;
  }
  if (caption !== null) {
    if (Array.from(caption).length > MEDIA_CAPTION_MAX) return fail(422, "too_long");
    if (checked.kind === "audio") return fail(422, "caption_not_allowed");
  }

  const token = getWhatsAppAccessToken(deps.env);
  if (!token) {
    log({ result: "not_configured" });
    return fail(503, "not_configured");
  }

  const prep = await rpc(deps.admin, "inbox_prepare_outbound_media", {
    p_actor_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_client_request_id: input.clientRequestId,
    p_kind: checked.kind,
    p_caption: caption,
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
      // A replay: the stored row decides. Nothing is uploaded or sent again.
      const s = p.status;
      if (s === "sent" || s === "delivered" || s === "read") return ok(200, s, messageId);
      if (s === "failed") return fail(422, "send_failed", { state: "failed", message_id: messageId });
      return ok(202, "pending", messageId);
    }
    case "created": break;
    default:
      log({ result: "prepare_unexpected" });
      return fail(500, "server_error");
  }

  const phoneNumberId = typeof p.phone_number_id === "string" ? p.phone_number_id : "";
  const to = typeof p.to === "string" ? p.to : "";

  // 4. upload: nothing has reached the customer yet, so every failure here is a definite failure
  const upload = await uploadWhatsAppMedia({ phoneNumberId, token, bytes, mime: checked.mime, filename: checked.filename }, deps.fetchImpl);
  if (upload.kind !== "ok") {
    const marked = await rpc(deps.admin, "inbox_fail_outbound", { p_actor_user_id: input.userId, p_message_id: messageId, p_error_codes: upload.kind === "rejected" && upload.code !== null ? [upload.code] : [] });
    log({ result: "upload_failed", message_id: messageId, kind: upload.kind, meta_code: upload.kind === "rejected" ? upload.code : null, marked: marked.ok ? marked.data : marked.code });
    return fail(422, "upload_failed", { state: "failed", message_id: messageId });
  }

  // 5. send
  const outcome = await sendWhatsAppMedia({ phoneNumberId, to, kind: checked.kind, mediaId: upload.mediaId, caption, filename: checked.kind === "document" ? checked.filename : null, token }, deps.fetchImpl);

  if (outcome.kind === "accepted") {
    const done = await rpc(deps.admin, "inbox_complete_outbound_media", {
      p_actor_user_id: input.userId,
      p_message_id: messageId,
      p_provider_message_id: outcome.providerMessageId,
      p_media_id: upload.mediaId,
      p_mime_type: checked.mime,
      p_filename: checked.filename,
      p_sha256: checked.sha256,
    });
    if (done.ok && (done.data === "ok" || done.data === "duplicate")) return ok(200, "sent", messageId);
    // Meta accepted but the database could not record it: the wamid is logged (an id, not personal data) so it can be reconciled.
    log({ result: "complete_failed", message_id: messageId, provider_message_id: outcome.providerMessageId, code: done.ok ? String(done.data) : done.code });
    return ok(202, "unconfirmed", messageId);
  }

  if (outcome.kind === "rejected") {
    const marked = await rpc(deps.admin, "inbox_fail_outbound", { p_actor_user_id: input.userId, p_message_id: messageId, p_error_codes: outcome.code === null ? [] : [outcome.code] });
    log({ result: "meta_rejected", message_id: messageId, http_status: outcome.httpStatus, meta_code: outcome.code, marked: marked.ok ? marked.data : marked.code });
    return fail(422, outcome.error === "rejected" ? "send_failed" : outcome.error, { state: "failed", message_id: messageId });
  }

  log({ result: "outcome_unknown", message_id: messageId, reason: outcome.reason });
  return ok(202, "unconfirmed", messageId);
}
