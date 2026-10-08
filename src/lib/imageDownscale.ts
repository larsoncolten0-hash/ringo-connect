// Shrinks an oversized photo in the browser BEFORE it is uploaded, so the file Ringo stores and every visitor downloads is the size a phone screen can use.
//
// The problem it solves: the editors accept images up to 5 MB and uploaded them untouched, and public profile pages show them in plain <img> tags, so a
// 4000 px camera photo was downloaded in full by every visitor, on mobile data. Nothing about storage changes: the same bucket, the same path scheme, the
// same public URL. Only the bytes are smaller.
//
// Two modes:
//   * the general mode (no `kind`): unchanged from before. Only JPEG, PNG and WebP, only when the file is both heavy (over MIN_BYTES) and wide (over MAX_EDGE),
//     resized to MAX_EDGE, the same type out as in;
//   * the targeted mode (a `kind`, for the profile photo, the cover and the artwork / product photos): resized to that kind's size (see UPLOAD_TARGETS), and re-encoded
//     as JPEG when the picture has no transparency (a screenshot-style PNG becomes a fraction of its size), as WebP when it does (transparency is kept; the browser may refuse to
//     encode WebP, then the original type is kept), as JPEG when it was a JPEG. The aspect ratio is always preserved; this never crops.
// Deliberately conservative, because a wrong image is worse than a big one:
//   * GIF and SVG keep their animation and vectors; anything not JPEG / PNG / WebP is uploaded exactly as chosen;
//   * the result is used only if it is actually smaller; on ANY problem (no canvas, decode error, memory) the original file is uploaded unchanged, so this can
//     make an upload smaller but never make it fail;
//   * the returned file's name carries the extension of its real type.
// Browser only.

export const MAX_EDGE = 1600; // longest side in pixels: sharp on a retina phone, a fraction of a camera original
export const MIN_BYTES = 400 * 1024; // below this a photo is not worth re-encoding
const QUALITY = 0.85;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type UploadKind = "avatar" | "cover" | "art" | "product";
/** The longest edge (px) and the weight under which a file is left alone, per kind. Sized for the largest place each is shown (a retina phone, a 480 px column). */
export const UPLOAD_TARGETS: Record<UploadKind, { maxEdge: number; minBytes: number; quality: number }> = {
  avatar: { maxEdge: 512, minBytes: 60 * 1024, quality: 0.85 },
  cover: { maxEdge: 1280, minBytes: 150 * 1024, quality: 0.82 },
  art: { maxEdge: 1200, minBytes: 150 * 1024, quality: 0.82 },
  product: { maxEdge: 1200, minBytes: 150 * 1024, quality: 0.82 },
};

/** Which kind an editor upload folder is: only the folders that hold a profile photo, a cover, music artwork or a product photo are targeted; every other folder keeps the general mode. */
export function uploadKindForFolder(folder: string | null | undefined): UploadKind | null {
  switch (folder) {
    case "avatar":
      return "avatar";
    case "cover":
      return "cover";
    case "tracks":
    case "releases":
    case "events":
      return "art";
    case "products":
      return "product";
    default:
      return null;
  }
}

/** Pure: the size to draw at, or null when the file should be uploaded as it is. Exported for tests. */
export function planDownscale(
  file: { type: string; size: number },
  dims: { width: number; height: number },
  opts: { maxEdge?: number; minBytes?: number; reencode?: boolean } = {}
): { width: number; height: number } | null {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const minBytes = opts.minBytes ?? MIN_BYTES;
  if (!TYPES.has(file.type)) return null;
  if (file.size <= minBytes) return null;
  const { width, height } = dims;
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return opts.reencode ? { width, height } : null; // already small enough: only worth re-encoding in the targeted mode
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** True when any visible part of the canvas is transparent (judged on a small copy, so a thin transparent edge still counts). */
function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 32;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true; // cannot tell: assume it matters
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function renamed(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.${EXT[type] || "jpg"}`;
}

/** The photo to upload: a smaller one when that is safe and smaller, otherwise the original file, untouched. */
export async function downscaleImage(file: File, kind?: UploadKind | null): Promise<File> {
  try {
    if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
    const target = kind ? UPLOAD_TARGETS[kind] : null;
    if (!TYPES.has(file.type) || file.size <= (target?.minBytes ?? MIN_BYTES)) return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const plan = planDownscale(file, { width: bitmap.width, height: bitmap.height }, target ? { maxEdge: target.maxEdge, minBytes: target.minBytes, reencode: true } : {});
      if (!plan) return file;
      const canvas = document.createElement("canvas");
      canvas.width = plan.width;
      canvas.height = plan.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

      let outType = file.type;
      let quality = QUALITY;
      if (target) {
        quality = target.quality;
        if (file.type === "image/jpeg") outType = "image/jpeg";
        else outType = hasTransparency(canvas) ? "image/webp" : "image/jpeg";
      }
      let blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
      // a browser that cannot encode the type hands back PNG: for a transparent picture keep the original type instead
      if (blob && blob.type !== outType && target && outType === "image/webp") blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, quality));
      if (!blob || blob.size >= file.size) return file;
      if (!target && blob.type !== file.type) return file; // the general mode keeps the input's type or nothing
      return new File([blob], target ? renamed(file.name, blob.type) : file.name, { type: blob.type, lastModified: Date.now() });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}
