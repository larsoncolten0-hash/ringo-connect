// Where /api/profile/avatar-icons may read an avatar from, and how it reads it.
//
// The route used to run fetch(avatarUrl) on whatever URL the browser sent: any signed-in user could make the server request
// internal addresses (a blind SSRF probe) or fetch an attacker-hosted file and hand it to sharp. The dashboard only ever sends the
// public URL of the image it has just uploaded to Ringo's own "uploads" storage bucket, so that is the only thing accepted:
//
//   https://<this project>.supabase.co/storage/v1/object/public/uploads/<path>
//
// - The origin must equal NEXT_PUBLIC_SUPABASE_URL's origin exactly (no other host, no credentials, no other port).
// - The path must stay inside /storage/v1/object/public/uploads/ (no "..", no encoded dots, slashes or backslashes, no control characters).
// - The request never follows a redirect, times out, and cannot read more than the size limit.
// - The bytes must really be a PNG, JPEG, WebP or GIF (magic bytes, not the Content-Type header). SVG, HEIC / HEIF and AVIF are
//   refused on purpose: they go through librsvg / libheif, where sharp has had advisories, and an avatar never needs them.
// Pure and dependency-free so it can be tested without a network.

export const AVATAR_SOURCE_MAX_BYTES = 6 * 1024 * 1024; // the dashboard itself limits uploads to 5 MB
export const AVATAR_SOURCE_TIMEOUT_MS = 8000;
const BUCKET_PATH = "/storage/v1/object/public/uploads/";

/** The URL to fetch, or null when the input is not an image in this project's public "uploads" bucket. */
export function avatarSourceUrl(input: unknown, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 2048 || !supabaseUrl) return null;
  if (/[\u0000- \u007f\\]/.test(input)) return null; // spaces, control characters and backslashes never appear in a storage URL
  let url: URL;
  let allowed: URL;
  try {
    url = new URL(input);
    allowed = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (url.origin !== allowed.origin || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  // http is accepted only where the project itself is configured over http (local development), never for a hosted project.
  if (url.protocol === "http:" && allowed.protocol !== "http:") return null;
  const path = url.pathname;
  if (!path.startsWith(BUCKET_PATH) || path.length === BUCKET_PATH.length) return null;
  if (/%2e|%2f|%5c|%00/i.test(path) || path.split("/").some((s) => s === ".." || s === ".")) return null;
  url.hash = "";
  return url.toString();
}

/** The real type of the bytes, or null if they are not one of the four raster formats an avatar may be. */
export function sniffAvatarImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  return null;
}

export type AvatarReadResult = { ok: true; bytes: Buffer } | { ok: false; reason: "fetch_failed" | "timeout" | "too_large" | "not_an_image" };

/** Reads the (already validated) URL with a timeout, no redirects, a hard size cap, and a magic-byte check. */
export async function readAvatarSource(url: string, fetchImpl: typeof fetch = fetch, timeoutMs: number = AVATAR_SOURCE_TIMEOUT_MS): Promise<AvatarReadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { redirect: "error", signal: controller.signal, cache: "no-store" });
    if (!res.ok) return { ok: false, reason: "fetch_failed" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > AVATAR_SOURCE_MAX_BYTES) return { ok: false, reason: "too_large" };

    // Read in pieces and stop at the cap: a missing or lying Content-Length must not let a huge body into memory.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "fetch_failed" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AVATAR_SOURCE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    if (!sniffAvatarImage(bytes)) return { ok: false, reason: "not_an_image" };
    return { ok: true, bytes };
  } catch (err: any) {
    return { ok: false, reason: err?.name === "AbortError" ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}
