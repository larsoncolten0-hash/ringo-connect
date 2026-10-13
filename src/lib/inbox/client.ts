// Browser-side helper for sending a reply. It only ever calls OUR route (/api/inbox/conversations/<id>/messages); it never talks to Meta and
// never sees a token. The request carries the text and a client_request_id, nothing else: the conversation (in the URL) decides the recipient.

export const MAX_REPLY_LENGTH = 4096;
export const replyUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;

export type ReplyResponse = { ok: true; state: string; message_id?: string } | { ok: false; error: string; state?: string; message_id?: string; /** client-side hint: the file was a video (picks the video size message) */ video?: boolean };
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

export type ErrorKey =
  | "emptyMessage" | "messageTooLong" | "sendFailedMessage" | "windowClosed" | "notConfigured" | "accountDisabled" | "rateLimited"
  | "mediaTooLarge" | "mediaVideoTooLarge" | "mediaUnsupported" | "mediaMismatch" | "mediaEmpty" | "mediaFailed" | "captionNone"
  | "mediaStagingUnavailable" | "mediaStagedGone" | "mediaUploadFailed" | "mediaCodecUnsupported";
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

// ---- media replies: same rules as text. The browser sends the FILE, an optional caption and a request id to OUR route, nothing else ----
export const mediaUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/media`;

export async function postMedia(conversationId: string, file: File, caption: string, clientRequestId: string, fetchImpl: typeof fetch = fetch): Promise<PostResult> {
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("client_request_id", clientRequestId);
    if (caption.trim()) form.append("caption", caption.trim());
    const res = await fetchImpl(mediaUrl(conversationId), {
      method: "POST",
      // a custom header a cross-site form post cannot set (the route refuses a request without it)
      headers: { "x-ringo-upload": "1" },
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as ReplyResponse | null;
    if (!body || typeof body !== "object" || typeof (body as any).ok !== "boolean") return { kind: "network" };
    return { kind: "response", status: res.status, body };
  } catch {
    return { kind: "network" };
  }
}

export interface MediaEffect {
  /** Drop the attachment and the caption (the message was stored: sent, pending or unconfirmed). */
  clearAttachment: boolean;
  /** Keep the SAME client_request_id for the next attempt (the outcome is unknown, so a retry must be idempotent). */
  keepRequestId: boolean;
  error: ErrorKey | null;
  refresh: boolean;
}

/**
 * What the composer does with the server's answer to a media send. Pure, so the retry/idempotency rules are testable.
 * A DEFINITE failure (nothing reached the customer) keeps the attachment so the person can simply press Send again: that is a new, deliberate send
 * with a new request id. An UNKNOWN outcome (network error, server error) keeps both the attachment and the request id: pressing Send again replays
 * the same request, which the server answers from its stored row without uploading or sending a second time.
 */
export function interpretMedia(r: PostResult): MediaEffect {
  if (r.kind === "network") return { clearAttachment: false, keepRequestId: true, error: "sendFailedMessage", refresh: false };
  const b = r.body;
  if (b.ok) return { clearAttachment: true, keepRequestId: false, error: null, refresh: true };
  if (b.state === "failed") return { clearAttachment: false, keepRequestId: false, error: b.error === "window_closed" ? "windowClosed" : b.error === "rate_limited" ? "rateLimited" : "mediaFailed", refresh: true };
  const keep = (error: ErrorKey): MediaEffect => ({ clearAttachment: false, keepRequestId: false, error, refresh: false });
  switch (b.error) {
    case "too_large": return keep(b.video ? "mediaVideoTooLarge" : "mediaTooLarge");
    case "unsupported_type":
    case "not_stageable": return keep("mediaUnsupported");
    // WhatsApp takes H.264 video and AAC audio only
    case "unsupported_codec": return keep("mediaCodecUnsupported");
    // large video staging: not enabled on this deployment yet / the staged copy was already consumed by an earlier attempt that reached the server
    case "staging_unavailable": return keep("mediaStagingUnavailable");
    case "staged_missing": return { clearAttachment: true, keepRequestId: false, error: "mediaStagedGone", refresh: true };
    case "upload_failed_client": return { clearAttachment: false, keepRequestId: true, error: "mediaUploadFailed", refresh: false };
    case "type_mismatch":
    case "bad_filename": return keep("mediaMismatch");
    case "empty_file": return keep("mediaEmpty");
    case "caption_not_allowed": return keep("captionNone");
    case "too_long": return keep("messageTooLong");
    case "window_closed": return { clearAttachment: false, keepRequestId: false, error: "windowClosed", refresh: true };
    case "not_configured": return keep("notConfigured");
    case "account_disabled": return keep("accountDisabled");
    case "rate_limited": return keep("rateLimited");
    case "server_error": return { clearAttachment: false, keepRequestId: true, error: "sendFailedMessage", refresh: false };
    default: return keep("sendFailedMessage");
  }
}

/** "1.4 MB" / "320 KB" for the attachment chip. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
export const settingsUrl = "/api/inbox/settings";
export const salesBotSwitchUrl = "/api/inbox/sales-bot";
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

// ---- AI assistance: the browser asks OUR route to summarize or draft; it sends only the action and the language, never any message text ----
export type AssistAction = "summarize" | "suggest_reply";
export const assistUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/assist`;
export type AssistResponse =
  | { ok: true; action: "summarize"; summary: string; context: string | null; nextAction: string | null }
  | { ok: true; action: "suggest_reply"; reply: string }
  | { ok: false; error: string; reason?: string };
export type AssistPost = { kind: "response"; status: number; body: AssistResponse } | { kind: "network" };

export async function postAssist(conversationId: string, action: AssistAction, locale: "en" | "fr", fetchImpl: typeof fetch = fetch): Promise<AssistPost> {
  try {
    const res = await fetchImpl(assistUrl(conversationId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, locale }),
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as AssistResponse | null;
    if (!body || typeof body !== "object" || typeof (body as any).ok !== "boolean") return { kind: "network" };
    return { kind: "response", status: res.status, body };
  } catch {
    return { kind: "network" };
  }
}

export type AssistErrorKey = "aiUnavailable" | "aiLimit" | "aiBusy" | "aiFailed" | "aiEmpty" | "aiWindowClosed" | "aiBlocked";
export type AssistView =
  | { state: "summary"; summary: string; context: string | null; nextAction: string | null }
  | { state: "reply"; reply: string }
  | { state: "error"; error: AssistErrorKey };

/** What the panel shows for the server's answer. Pure: any failure is a calm message, and none of them affects the reply box. */
export function interpretAssist(r: AssistPost): AssistView {
  if (r.kind === "network") return { state: "error", error: "aiFailed" };
  const b = r.body;
  if (b.ok) {
    if (b.action === "summarize" && typeof b.summary === "string" && b.summary.trim()) return { state: "summary", summary: b.summary, context: typeof b.context === "string" ? b.context : null, nextAction: typeof b.nextAction === "string" ? b.nextAction : null };
    if (b.action === "suggest_reply" && typeof b.reply === "string" && b.reply.trim()) return { state: "reply", reply: b.reply };
    return { state: "error", error: "aiEmpty" };
  }
  if (b.error === "ai_unavailable") return { state: "error", error: b.reason === "daily_limit" || b.reason === "monthly_limit" || b.reason === "budget_reached" ? "aiLimit" : "aiUnavailable" };
  switch (b.error) {
    case "window_closed": return { state: "error", error: "aiWindowClosed" };
    case "empty_conversation": case "empty_answer": return { state: "error", error: "aiEmpty" };
    case "provider_busy": return { state: "error", error: "aiBusy" };
    case "response_blocked": return { state: "error", error: "aiBlocked" };
    default: return { state: "error", error: "aiFailed" };
  }
}

// ---- sending an attachment WITH progress ----------------------------------------------------------------------------------------------------
// A file up to what the upload route can receive (about 4 MB) is posted straight to it. A VIDEO above that (up to Meta's 16 MB) is first uploaded to a private staging object
// with a one-time signed url from /media/stage, then the send route is told which staged object to send. In both cases ONE client_request_id covers the whole send, so a
// retry after an unknown outcome can never create a second customer message (see interpretMedia), and a staged upload that already succeeded is reused, not repeated.
export const stageUrl = (conversationId: string) => `${mediaUrl(conversationId)}/stage`;
/** The URL that serves one stored media file of a message to a signed-in person who may read the conversation (see the GET route). */
export const messageMediaUrl = (conversationId: string, messageId: string, download = false) => `${mediaUrl(conversationId)}/${encodeURIComponent(messageId)}${download ? "?download=1" : ""}`;

export interface SendProgress {
  phase: "uploading" | "sending";
  /** 0..1 while the file is being uploaded; null when unknown (the server is working). */
  fraction: number | null;
}

type XhrOutcome = { status: number; body: unknown } | null;

/** One XMLHttpRequest (the only browser API that reports UPLOAD progress). null = a network failure or abort. */
export function xhrRequest(method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string>, onUploadProgress?: (fraction: number) => void, XHR: typeof XMLHttpRequest | undefined = typeof XMLHttpRequest === "undefined" ? undefined : XMLHttpRequest): Promise<XhrOutcome> {
  return new Promise((resolve) => {
    if (!XHR) return resolve(null);
    try {
      const xhr = new XHR();
      xhr.open(method, url);
      xhr.withCredentials = false;
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0 && onUploadProgress) onUploadProgress(Math.min(1, e.loaded / e.total)); };
      xhr.onerror = () => resolve(null);
      xhr.onabort = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.onload = () => {
        let parsed: unknown = null;
        try { parsed = JSON.parse(xhr.responseText); } catch { parsed = null; }
        resolve({ status: xhr.status, body: parsed });
      };
      xhr.send(body);
    } catch {
      resolve(null);
    }
  });
}

const asReply = (o: XhrOutcome, video: boolean): PostResult => {
  if (!o || !o.body || typeof o.body !== "object" || typeof (o.body as any).ok !== "boolean") return { kind: "network" };
  const body = o.body as ReplyResponse;
  return { kind: "response", status: o.status, body: body.ok ? body : { ...body, video } };
};

export interface SendAttachmentArgs {
  conversationId: string;
  file: File;
  caption: string;
  clientRequestId: string;
  /** A staged copy a previous attempt already uploaded (same file, same request): it is reused instead of uploading again. */
  staged?: { path: string } | null;
  onProgress?: (p: SendProgress) => void;
  onStaged?: (path: string) => void;
  xhr?: typeof XMLHttpRequest;
  fetchImpl?: typeof fetch;
  /** Whether the file must go through staging (a video over the direct limit). */
  staging: boolean;
}

export async function sendAttachment(a: SendAttachmentArgs): Promise<PostResult> {
  const fetchImpl = a.fetchImpl ?? fetch;
  const isVideo = a.staging || /^video\//i.test(a.file.type);
  const note = (p: SendProgress) => a.onProgress?.(p);
  if (!a.staging) {
    const form = new FormData();
    form.append("file", a.file, a.file.name);
    form.append("client_request_id", a.clientRequestId);
    if (a.caption.trim()) form.append("caption", a.caption.trim());
    note({ phase: "uploading", fraction: 0 });
    const out = await xhrRequest("POST", mediaUrl(a.conversationId), form, { "x-ringo-upload": "1" }, (f) => note({ phase: f >= 1 ? "sending" : "uploading", fraction: f >= 1 ? null : f }), a.xhr);
    return asReply(out, isVideo);
  }

  // 1. a signed upload url for a private staging object (skipped when an earlier attempt of THIS send already uploaded the file)
  let path = a.staged?.path ?? null;
  if (!path) {
    note({ phase: "uploading", fraction: 0 });
    let stageRes: Response;
    try {
      stageRes = await fetchImpl(stageUrl(a.conversationId), { method: "POST", headers: { "Content-Type": "application/json", "x-ringo-upload": "1" }, body: JSON.stringify({ name: a.file.name, type: a.file.type, size: a.file.size, client_request_id: a.clientRequestId }), credentials: "same-origin" });
    } catch {
      return { kind: "network" };
    }
    const stage = (await stageRes.json().catch(() => null)) as { ok?: boolean; error?: string; path?: string; upload_url?: string; headers?: Record<string, string> } | null;
    if (!stage || typeof stage.ok !== "boolean") return { kind: "network" };
    if (!stage.ok || !stage.path || !stage.upload_url) return { kind: "response", status: stageRes.status, body: { ok: false, error: stage.error || "staging_unavailable", video: true } };

    // 2. the file goes straight to storage (a signed url: no session needed, no size limit of ours in the way)
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", a.file);
    // the headers the server says the signed upload url needs, forwarded as they are
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(stage.headers ?? {})) if (typeof v === "string") headers[k] = v;
    const up = await xhrRequest("PUT", stage.upload_url, body, headers, (f) => note({ phase: "uploading", fraction: f }), a.xhr);
    // Supabase answers a second upload to the same path with a "Duplicate" (HTTP 400, statusCode 409): the staged file from an earlier attempt of THIS send is already there, which is what we want
    const duplicate = !!up && up.status === 400 && !!up.body && typeof up.body === "object" && ((up.body as any).statusCode === "409" || (up.body as any).error === "Duplicate");
    if (!duplicate && (!up || up.status < 200 || up.status >= 300)) {
      return { kind: "response", status: up?.status ?? 0, body: { ok: false, error: up && up.status === 413 ? "too_large" : "upload_failed_client", video: true } };
    }
    path = stage.path;
    a.onStaged?.(path);
  }

  // 3. ask the server to send the staged video
  note({ phase: "sending", fraction: null });
  const sent = await xhrRequest("POST", mediaUrl(a.conversationId), JSON.stringify({ staged_path: path, name: a.file.name, type: a.file.type, client_request_id: a.clientRequestId, caption: a.caption.trim() || undefined }), { "Content-Type": "application/json", "x-ringo-upload": "1" }, undefined, a.xhr);
  return asReply(sent, true);
}
