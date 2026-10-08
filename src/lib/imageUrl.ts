// Responsive delivery of the images people uploaded to Ringo's own public storage. The stored original is NEVER touched: for a public object of the `uploads` bucket the same path is
// also served by Supabase Image Transformations (/storage/v1/render/image/public/...) at a requested width, as WebP where the browser accepts it (negotiated by Supabase from the
// request's Accept header). A 3 MB avatar shown at 144 px becomes about 10 KB. Anything that is not exactly such an object (another host, another bucket, a signed or private URL, a
// data/blob URL, an SVG or GIF, a URL that already has a query) is returned unchanged, so this can only ever point the browser at our own project's public images.
const OBJECT_PATH = "/storage/v1/object/public/uploads/";
const RENDER_PATH = "/storage/v1/render/image/public/uploads/";
export const IMAGE_QUALITY = 75;

function projectOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** True only for a public object of this project's `uploads` bucket that is a still raster image the transformer can resize. */
export function isTransformableImage(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const origin = projectOrigin();
  if (!origin) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== origin || u.search || u.hash) return false;
  if (!u.pathname.startsWith(OBJECT_PATH)) return false;
  const rest = u.pathname.slice(OBJECT_PATH.length);
  if (!rest || rest.includes("..") || rest.endsWith("/")) return false;
  return !/\.(svg|gif)$/i.test(rest);
}

export type ImageVariant = { width: number; /** square crop (avatars): the same centred crop object-fit: cover gives */ square?: boolean; quality?: number };

/** The URL of the image at the given width, or the original URL when it cannot be transformed. */
export function transformedImageUrl(url: string | null | undefined, v: ImageVariant): string {
  if (!isTransformableImage(url)) return url || "";
  const u = new URL(url);
  const w = Math.max(16, Math.min(2000, Math.round(v.width)));
  const q = new URLSearchParams({ width: String(w) });
  if (v.square) {
    q.set("height", String(w));
    q.set("resize", "cover");
  }
  q.set("quality", String(v.quality ?? IMAGE_QUALITY));
  return `${u.origin}${RENDER_PATH}${u.pathname.slice(OBJECT_PATH.length)}?${q.toString()}`;
}

/** `srcset` for a fluid image: one candidate per width. Empty when the image cannot be transformed. */
export function imageSrcSet(url: string | null | undefined, widths: number[], opts: { square?: boolean; quality?: number } = {}): string {
  if (!isTransformableImage(url)) return "";
  return widths.map((w) => `${transformedImageUrl(url, { width: w, ...opts })} ${w}w`).join(", ");
}

/** `srcset` for an image shown at a fixed CSS size: 1x / 2x / 3x candidates. */
export function imageDensitySrcSet(url: string | null | undefined, cssWidth: number, opts: { square?: boolean; quality?: number } = {}): string {
  if (!isTransformableImage(url)) return "";
  return [1, 2, 3].map((d) => `${transformedImageUrl(url, { width: cssWidth * d, ...opts })} ${d}x`).join(", ");
}
