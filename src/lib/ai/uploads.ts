// Shared helpers for Ringo AI's one upload surface (POST /api/ai/uploads/image).
// Images the model can reference live in the existing "uploads" Supabase
// Storage bucket, under a new path prefix scoped to the caller:
//   ${userId}/ai-uploads/${uuid}.${ext}
// This never touches the avatar/links/products/menu-items folders or their
// policies. Both the upload route (to build the path) and the chat route
// (to verify an inbound imageUrl actually belongs to the caller before it's
// ever sent to the model provider) use these.

export const AI_UPLOAD_MAX_SIZE_BYTES = 5 * 1024 * 1024;

const BUCKET = "uploads";
const FOLDER = "ai-uploads";

function publicUrlPrefix(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/${BUCKET}/`;
}

export function aiUploadPath(userId: string, ext: string): string {
  return `${userId}/${FOLDER}/${crypto.randomUUID()}.${ext}`;
}

/**
 * True only when `url` is a public URL for a file under this caller's own
 * `${userId}/ai-uploads/` prefix in the `uploads` bucket — never an
 * arbitrary or another user's URL. The chat route checks this before an
 * inbound `imageUrl` is ever included as image content sent to the model
 * provider (which would otherwise fetch whatever URL it's given).
 */
export function isOwnAiUploadUrl(url: string, userId: string): boolean {
  const prefix = publicUrlPrefix();
  if (!prefix.startsWith("http") || !url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  return rest.startsWith(`${userId}/${FOLDER}/`) && !rest.includes("..") && !/[?#]/.test(rest);
}

const IMAGE_SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // WEBP: "RIFF" .... "WEBP" — check the two fixed runs, skip the 4-byte size field.
];

/** Sniffs the first bytes so a spoofed Content-Type can't smuggle a non-image file through. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.bytes.every((b, i) => bytes[i] === b)) return true;
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return true;
  }
  return false;
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}
