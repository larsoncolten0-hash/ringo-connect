import { createHash } from "crypto";
import { GRAPH_VERSION, classify, type SendOutcome } from "./outbound";
import { MEDIA_KINDS, MEDIA_MAX_BYTES, MEDIA_TYPES, SEND_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, extensionOf, maxBytesFor, mimeFromExtension, normalizeMime, sanitizeFilename, type OutboundMediaKind } from "./mediaRules";

// Outbound WhatsApp MEDIA (server only: it reads the access token through its callers and talks to Meta).
//
// Meta's flow: 1) upload the file  POST /<phone_number_id>/media  (multipart)  -> a Meta media id
//              2) send a message that REFERENCES that id          POST /<phone_number_id>/messages
// Ringo never exposes a Ringo storage URL to Meta, never keeps the file, never returns a Meta media URL to the browser, and the browser never
// chooses the recipient, business number, WABA, profile or token: they all come from the conversation, server side (see lib/inbox/sendMedia.ts).
//
// LIMITS. Meta's own limits (Cloud API, media messages) are image 5 MB (JPEG/PNG), video 16 MB (MP4/3GPP), audio 16 MB (AAC, M4A, MP3, AMR, OGG/Opus),
// document 100 MB (PDF, Word, Excel, PowerPoint, plain text). Vercel serverless functions accept a request body of about 4.5 MB, so Ringo's upload
// route accepts at most 4 MB per file: the effective limit is min(Meta's limit, 4 MB). Larger files need a direct-to-storage flow (not built).

export * from "./mediaRules";

// ---- content sniffing: the bytes decide, the declared type only has to agree -----------------------------------------------------
export type Sniffed = "jpeg" | "png" | "pdf" | "ole" | "zip" | "mp4" | "3gp" | "m4a" | "ogg-opus" | "ogg" | "mp3" | "aac" | "amr" | "text" | null;

const ascii = (b: Uint8Array, start: number, text: string) => {
  if (b.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[start + i] !== text.charCodeAt(i)) return false;
  return true;
};
const includesAscii = (b: Uint8Array, text: string, limit: number) => {
  const end = Math.min(b.length, limit) - text.length;
  for (let i = 0; i <= end; i++) if (ascii(b, i, text)) return true;
  return false;
};

export function sniffMime(b: Uint8Array): Sniffed {
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (includesAscii(b, "%PDF-", 1024)) return "pdf"; // the header may be preceded by a few bytes, within the first 1 KB (same tolerance as PDF readers)
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return "ole";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (ascii(b, 4, "ftyp") && b.length >= 12) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "M4A " || brand === "M4B ") return "m4a";
    if (/^3g[pe2g]/i.test(brand)) return "3gp";
    if (["isom", "iso2", "mp41", "mp42", "avc1", "dash", "MSNV", "M4V "].includes(brand)) return "mp4";
    return null; // QuickTime ('qt  ') and every other brand are not accepted
  }
  if (ascii(b, 0, "OggS")) return includesAscii(b, "OpusHead", 128) ? "ogg-opus" : "ogg";
  if (ascii(b, 0, "#!AMR")) return "amr";
  if (ascii(b, 0, "ID3")) return "mp3";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 0x03;
    return layer === 0 ? "aac" : "mp3"; // ADTS (AAC) has layer bits 00
  }
  // plain text: no NUL byte and valid UTF-8 in the sampled part
  const sample = b.subarray(0, 8192);
  if (!sample.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample.length < b.length ? sample.subarray(0, sample.length - 3) : sample);
      return "text";
    } catch {
      return null;
    }
  }
  return null;
}

const SNIFF_OK: Record<string, readonly Sniffed[]> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "video/mp4": ["mp4"],
  "video/3gpp": ["3gp"],
  "audio/aac": ["aac"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/mpeg": ["mp3"],
  "audio/amr": ["amr"],
  "audio/ogg": ["ogg-opus"], // WhatsApp accepts OGG only with the Opus codec
  "application/pdf": ["pdf"],
  "application/msword": ["ole"],
  "application/vnd.ms-excel": ["ole"],
  "application/vnd.ms-powerpoint": ["ole"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["zip"],
  "text/plain": ["text"],
};

// ---- validation ---------------------------------------------------------------------------------------------------------------------
export type MediaProblem = "empty_file" | "too_large" | "unsupported_type" | "type_mismatch" | "bad_filename";
export type ValidatedMedia = { ok: true; kind: OutboundMediaKind; mime: string; filename: string; size: number; sha256: string } | { ok: false; error: MediaProblem };

/** The ONE gate every outbound file passes: size, declared type, actual bytes, extension and name. Pure (no network, no database). */
export function validateMediaFile(input: { name: unknown; type: unknown; bytes: Uint8Array }): ValidatedMedia {
  const { bytes } = input;
  if (!bytes || bytes.length === 0) return { ok: false, error: "empty_file" };
  // Some browsers send no type (or application/octet-stream) for files such as .amr: the extension then proposes one. It still has to agree with
  // the file's actual bytes below, so this cannot smuggle anything in.
  let mime = normalizeMime(input.type);
  if (!MEDIA_TYPES[mime] && (mime === "" || mime === "application/octet-stream")) mime = mimeFromExtension(extensionOf(sanitizeFilename(input.name) ?? "")) ?? mime;
  const rule = MEDIA_TYPES[mime];
  if (!rule) return { ok: false, error: "unsupported_type" };
  if (bytes.length > maxBytesFor(mime)) return { ok: false, error: "too_large" };

  const sniffed = sniffMime(bytes);
  if (!sniffed || !SNIFF_OK[mime]?.includes(sniffed)) return { ok: false, error: "type_mismatch" };

  const safe = sanitizeFilename(input.name);
  if (!safe) return { ok: false, error: "bad_filename" };
  const ext = extensionOf(safe);
  // the extension must belong to the declared type: "invoice.pdf.exe", "photo.html" or "a.pdf" declared as a video are refused, never renamed
  if (!rule.extensions.includes(ext)) return { ok: false, error: ext ? "type_mismatch" : "bad_filename" };

  return { ok: true, kind: rule.kind, mime, filename: safe, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

// ---- Meta calls ---------------------------------------------------------------------------------------------------------------------
export type UploadOutcome = { kind: "ok"; mediaId: string } | { kind: "rejected"; code: number | null } | { kind: "unavailable" };

/**
 * Step 1: give the file to Meta and get a media id. NOTHING has been sent to the customer at this point, so ANY failure here (rejected, timeout, 5xx,
 * unreadable answer) is safe to record as failed. The Meta error text is never kept: only a numeric code.
 */
export async function uploadWhatsAppMedia(
  args: { phoneNumberId: string; token: string; bytes: Uint8Array; mime: string; filename: string },
  fetchImpl: typeof fetch = fetch,
): Promise<UploadOutcome> {
  if (!/^[0-9]{5,32}$/.test(args.phoneNumberId) || !MEDIA_TYPES[args.mime] || args.bytes.length === 0) return { kind: "rejected", code: null };
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", args.mime);
  form.append("file", new Blob([args.bytes as BlobPart], { type: args.mime }), args.filename);
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${args.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) {
    const id = json?.id;
    return typeof id === "string" && id.trim() && id.length <= 256 ? { kind: "ok", mediaId: id } : { kind: "unavailable" };
  }
  if (res.status >= 500 || res.status === 408) return { kind: "unavailable" };
  return { kind: "rejected", code: typeof json?.error?.code === "number" && Number.isInteger(json.error.code) ? (json.error.code as number) : null };
}

/**
 * Step 2: send a message that references the uploaded media id. Same three-way outcome as the text sender (accepted / rejected / unknown), same
 * rule: an unknown outcome is never resent automatically.
 */
export async function sendWhatsAppMedia(
  args: { phoneNumberId: string; to: string; kind: OutboundMediaKind; mediaId: string; caption: string | null; filename: string | null; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  if (!/^[0-9]{5,32}$/.test(args.phoneNumberId) || !/^[0-9]{6,20}$/.test(args.to) || !args.mediaId || !MEDIA_KINDS.includes(args.kind)) {
    return { kind: "rejected", error: "rejected", code: null, httpStatus: 0 };
  }
  // audio cannot carry a caption; only documents carry a filename
  const media: Record<string, string> = { id: args.mediaId };
  if (args.caption && args.kind !== "audio") media.caption = args.caption;
  if (args.filename && args.kind === "document") media.filename = args.filename;
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${args.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: args.to, type: args.kind, [args.kind]: media }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { kind: "unknown", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) {
    const id = json?.messages?.[0]?.id;
    return typeof id === "string" && id.trim() && id.length <= 256 ? { kind: "accepted", providerMessageId: id } : { kind: "unknown", reason: "bad_response" };
  }
  if (res.status >= 500 || res.status === 408) return { kind: "unknown", reason: "server_error" };
  const code = typeof json?.error?.code === "number" && Number.isInteger(json.error.code) ? (json.error.code as number) : null;
  return { kind: "rejected", error: classify(res.status, code), code, httpStatus: res.status };
}
