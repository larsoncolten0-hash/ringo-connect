import { GRAPH_VERSION } from "./outbound";

// Authenticated download of a WhatsApp media file for the Inbox (server only). A media id from the webhook (or from an upload Ringo made) is NOT a browser URL:
//   1. GET https://graph.facebook.com/<version>/<media-id>   (Bearer token)  -> { url, mime_type, file_size, sha256 }   (the url is short-lived and needs the token too)
//   2. GET <url>                                              (Bearer token)  -> the bytes
// The token never leaves the server and no Meta URL is ever returned to the browser: the Inbox route streams the bytes through, after its own authorization checks.
// Everything here is bounded: a numeric-id check, timeouts, a response-size cap checked BEFORE streaming, and a host check on the download url.

export const MEDIA_LOOKUP_TIMEOUT_MS = 8_000;
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 45_000;
/** Meta's largest inbound media is a 100 MB document; nothing larger is ever streamed. */
export const MEDIA_STREAM_MAX_BYTES = 100 * 1024 * 1024;

export type MediaLookup =
  | { kind: "ok"; url: string; mimeType: string | null; fileSize: number | null }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** A WhatsApp media id is a decimal string; anything else is refused before a request is made. */
export const isMediaId = (v: unknown): v is string => typeof v === "string" && /^[0-9]{5,40}$/.test(v);

/** The download url must be https and on a Meta/Facebook CDN host: a hostile response cannot point the server at an arbitrary address. */
export function isMetaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return host === "fbsbx.com" || host.endsWith(".fbsbx.com") || host === "facebook.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host === "whatsapp.net" || host.endsWith(".whatsapp.net");
  } catch {
    return false;
  }
}

export async function lookupWhatsAppMedia(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<MediaLookup> {
  if (!isMediaId(mediaId)) return { kind: "not_found" };
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MEDIA_LOOKUP_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 400 || res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "unavailable" };
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    return { kind: "unavailable" };
  }
  const url = typeof json?.url === "string" ? json.url : "";
  if (!url || !isMetaMediaUrl(url)) return { kind: "unavailable" };
  const size = Number(json?.file_size);
  return { kind: "ok", url, mimeType: typeof json?.mime_type === "string" ? json.mime_type : null, fileSize: Number.isFinite(size) && size >= 0 ? size : null };
}

export type MediaDownload = { kind: "ok"; response: Response } | { kind: "not_found" } | { kind: "too_large" } | { kind: "unavailable" };

/** Opens the download stream (optionally a byte range). The body is NOT read here; the caller streams it. */
export async function openWhatsAppMedia(url: string, token: string, range: string | null, fetchImpl: typeof fetch = fetch): Promise<MediaDownload> {
  if (!isMetaMediaUrl(url)) return { kind: "unavailable" };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS), redirect: "error", cache: "no-store" });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 404 || res.status === 410) return { kind: "not_found" };
  if (res.status !== 200 && res.status !== 206) return { kind: "unavailable" };
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MEDIA_STREAM_MAX_BYTES) return { kind: "too_large" };
  if (!res.body) return { kind: "unavailable" };
  return { kind: "ok", response: res };
}

// ---- what the browser is allowed to be told about the file -------------------------------------------------------------------------------
// The type sent to the browser is chosen HERE from a fixed list, never echoed from Meta or from the message: an unknown type is served as an opaque download.
const INLINE_TYPES: Record<string, string> = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "image",
  "video/mp4": "video", "video/3gpp": "video", "video/webm": "video",
  "audio/ogg": "audio", "audio/mpeg": "audio", "audio/mp4": "audio", "audio/aac": "audio", "audio/amr": "audio", "audio/webm": "audio", "audio/wav": "audio",
};

/** Lower-case, parameters removed: "audio/ogg; codecs=opus" -> "audio/ogg". */
export const baseMime = (raw: unknown): string => (typeof raw === "string" ? raw.split(";")[0].trim().toLowerCase() : "");

// Documents that keep their true type, always as a DOWNLOAD (never shown in the page). Anything else a customer sends (HTML, SVG, scripts, unknown) is an opaque download.
const DOCUMENT_TYPES = new Set([
  "application/pdf", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export interface Delivery {
  contentType: string;
  /** inline = shown in the page (image / video / audio of a matching kind); attachment = downloaded. */
  disposition: "inline" | "attachment";
}

/** The delivery for a stored media row: the declared kind and the stored/received MIME type must agree for inline use. */
export function deliveryFor(kind: string, storedMime: unknown, upstreamMime: unknown, download: boolean): Delivery {
  const mime = baseMime(storedMime) || baseMime(upstreamMime);
  const family = INLINE_TYPES[mime];
  const kindFamily = kind === "sticker" ? "image" : kind;
  if (!download && family && family === kindFamily) return { contentType: mime, disposition: "inline" };
  return { contentType: family || (kind === "document" && DOCUMENT_TYPES.has(mime)) ? mime : "application/octet-stream", disposition: "attachment" };
}

/** A header-safe download filename (ASCII fallback plus the RFC 5987 form). */
export function contentDisposition(disposition: "inline" | "attachment", filename: string | null): string {
  const safe = (filename || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f"\\/;]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!safe) return disposition;
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
