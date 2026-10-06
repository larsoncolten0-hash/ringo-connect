// Shrinks an oversized photo in the browser BEFORE it is uploaded, so the file Ringo stores and every visitor downloads is the size a phone screen can use.
//
// The problem it solves: the editors accept images up to 5 MB and uploaded them untouched, and public profile pages show them in plain <img> tags, so a
// 4000 px camera photo was downloaded in full by every visitor, on mobile data. Nothing about storage changes: the same bucket, the same path scheme, the
// same public URL. Only the bytes are smaller.
//
// Deliberately conservative, because a wrong image is worse than a big one:
//   * only JPEG, PNG and WebP, and only when the file is both heavy (over MIN_BYTES) and wide (over MAX_EDGE); everything else is uploaded exactly as chosen
//     (GIF and SVG keep their animation and vectors; a small image is already fine);
//   * the output keeps the INPUT's type, so a PNG's transparency is never turned into a black JPEG background and the file extension stays true;
//   * the result is used only if it is actually smaller; on ANY problem (no canvas, decode error, memory) the original file is uploaded unchanged, so this can
//     make an upload smaller but never make it fail.
// Browser only.

export const MAX_EDGE = 1600; // longest side in pixels: sharp on a retina phone, a fraction of a camera original
export const MIN_BYTES = 400 * 1024; // below this a photo is not worth re-encoding
const QUALITY = 0.85;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Pure: the size to draw at, or null when the file should be uploaded as it is. Exported for tests. */
export function planDownscale(file: { type: string; size: number }, dims: { width: number; height: number }): { width: number; height: number } | null {
  if (!TYPES.has(file.type)) return null;
  if (file.size <= MIN_BYTES) return null;
  const { width, height } = dims;
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return null;
  const scale = MAX_EDGE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The photo to upload: a smaller one of the same type when that is safe and smaller, otherwise the original file, untouched. */
export async function downscaleImage(file: File): Promise<File> {
  try {
    if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
    if (!TYPES.has(file.type) || file.size <= MIN_BYTES) return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const target = planDownscale(file, { width: bitmap.width, height: bitmap.height });
      if (!target) return file;
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, file.type, QUALITY));
      if (!blob || blob.type !== file.type || blob.size >= file.size) return file;
      return new File([blob], file.name, { type: file.type, lastModified: Date.now() });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}
