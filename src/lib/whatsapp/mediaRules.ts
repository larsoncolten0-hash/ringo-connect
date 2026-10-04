// Pure outbound-media rules shared by the SERVER (lib/whatsapp/media.ts) and the BROWSER (the composer's early check). No Node APIs, no network.
// The server re-validates everything (size, declared type, the file's actual bytes, extension, name): the browser check is only a convenience.
// See media.ts for the reasoning behind the limits (Meta's limits and the 4.5 MB serverless request body).

export const MEDIA_KINDS = ["image", "video", "audio", "document"] as const;
export type OutboundMediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_MAX_BYTES = 4 * 1024 * 1024;
export const MEDIA_CAPTION_MAX = 1024;
export const MEDIA_FILENAME_MAX = 100;
export const UPLOAD_TIMEOUT_MS = 30_000;
export const SEND_TIMEOUT_MS = 10_000;

interface Rule {
  kind: OutboundMediaKind;
  metaMaxBytes: number;
  extensions: readonly string[];
  /** Canonical extension used when a name has none. */
  ext: string;
}

// declared MIME type -> rule. A file must match BOTH its declared MIME type and its actual bytes (sniffMime) and carry an allowed extension.
export const MEDIA_TYPES: Record<string, Rule> = {
  "image/jpeg": { kind: "image", metaMaxBytes: 5 * 1024 * 1024, extensions: ["jpg", "jpeg"], ext: "jpg" },
  "image/png": { kind: "image", metaMaxBytes: 5 * 1024 * 1024, extensions: ["png"], ext: "png" },
  "video/mp4": { kind: "video", metaMaxBytes: 16 * 1024 * 1024, extensions: ["mp4"], ext: "mp4" },
  "video/3gpp": { kind: "video", metaMaxBytes: 16 * 1024 * 1024, extensions: ["3gp", "3gpp"], ext: "3gp" },
  "audio/aac": { kind: "audio", metaMaxBytes: 16 * 1024 * 1024, extensions: ["aac"], ext: "aac" },
  "audio/mp4": { kind: "audio", metaMaxBytes: 16 * 1024 * 1024, extensions: ["m4a"], ext: "m4a" },
  "audio/mpeg": { kind: "audio", metaMaxBytes: 16 * 1024 * 1024, extensions: ["mp3"], ext: "mp3" },
  "audio/amr": { kind: "audio", metaMaxBytes: 16 * 1024 * 1024, extensions: ["amr"], ext: "amr" },
  "audio/ogg": { kind: "audio", metaMaxBytes: 16 * 1024 * 1024, extensions: ["ogg", "opus"], ext: "ogg" },
  "application/pdf": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["pdf"], ext: "pdf" },
  "application/msword": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["doc"], ext: "doc" },
  "application/vnd.ms-excel": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["xls"], ext: "xls" },
  "application/vnd.ms-powerpoint": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["ppt"], ext: "ppt" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["docx"], ext: "docx" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["xlsx"], ext: "xlsx" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["pptx"], ext: "pptx" },
  "text/plain": { kind: "document", metaMaxBytes: 100 * 1024 * 1024, extensions: ["txt"], ext: "txt" },
};
export const ALLOWED_MIME_TYPES = Object.keys(MEDIA_TYPES);
export const ALLOWED_EXTENSIONS = Array.from(new Set(Object.values(MEDIA_TYPES).flatMap((r) => r.extensions)));

/** The effective maximum for a declared MIME type: Meta's limit, but never more than Ringo's upload route can receive. */
export const maxBytesFor = (mime: string): number => Math.min(MEDIA_TYPES[mime]?.metaMaxBytes ?? 0, MEDIA_MAX_BYTES);

/** Lower-case, parameters removed: "Audio/OGG; codecs=opus" -> "audio/ogg". */
export const normalizeMime = (raw: unknown): string => (typeof raw === "string" ? raw.split(";")[0].trim().toLowerCase() : "");

export const extensionOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
};

// ---- filename ---------------------------------------------------------------------------------------------------------------------
/**
 * A safe display/upload name: base name only (no directories), letters/digits/space/dot/underscore/hyphen/parentheses, no control characters, no leading
 * dots, at most 100 characters (the extension is kept). Returns null when nothing usable is left.
 */
export function sanitizeFilename(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw.normalize("NFKC").split(/[\\/]/).pop() ?? "";
  let name = base.replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/\s+/g, " ").replace(/_{2,}/g, "_").replace(/^[.\s_-]+/, "").trim();
  if (!name) return null;
  if (name.length > MEDIA_FILENAME_MAX) {
    const ext = extensionOf(name);
    const keep = ext ? ext.length + 1 : 0;
    name = name.slice(0, MEDIA_FILENAME_MAX - keep).replace(/[. ]+$/, "") + (ext ? `.${ext}` : "");
  }
  return name;
}


/** The canonical declared type for a file extension (used only when the browser sent no usable type). */
export const mimeFromExtension = (ext: string): string | null => {
  const e = ext.toLowerCase();
  for (const [mime, rule] of Object.entries(MEDIA_TYPES)) if (rule.extensions.includes(e)) return mime;
  return null;
};

export type AttachmentCheck = "ok" | "empty_file" | "too_large" | "unsupported_type" | "bad_filename" | "type_mismatch";

/**
 * The browser's early check on a chosen file (name, declared type, size): a convenience so a person hears about a problem before uploading.
 * It cannot see the file's bytes; the server re-validates everything, including the bytes (validateMediaFile in media.ts).
 */
export function checkAttachmentMeta(file: { name: string; type: string; size: number }): AttachmentCheck {
  if (!file.size) return "empty_file";
  let mime = normalizeMime(file.type);
  const safe = sanitizeFilename(file.name);
  if (!safe) return "bad_filename";
  const ext = extensionOf(safe);
  if (!MEDIA_TYPES[mime] && (mime === "" || mime === "application/octet-stream")) mime = mimeFromExtension(ext) ?? mime;
  const rule = MEDIA_TYPES[mime];
  if (!rule) return "unsupported_type";
  if (file.size > maxBytesFor(mime)) return "too_large";
  if (!rule.extensions.includes(ext)) return ext ? "type_mismatch" : "bad_filename";
  return "ok";
}
