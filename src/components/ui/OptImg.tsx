"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { imageDensitySrcSet, imageSrcSet, isTransformableImage, transformedImageUrl } from "@/lib/imageUrl";

// A plain <img> that asks for a right-sized copy of Ringo's own public uploads (lib/imageUrl.ts) instead of the multi-megapixel original, and falls back to the original file if the
// resized copy cannot be loaded (so a transformation problem can make a page heavier, never broken). Everything else stays an ordinary <img>: same class, style, alt and layout.
//   fluid image:      widths={[240, 480, 720]} sizes="(min-width: 640px) 240px, 50vw"
//   fixed-size image: cssWidth={96}            (1x / 2x / 3x candidates)
//   priority:         the one above-the-fold (LCP) image: eager + high fetch priority. Everything else is lazy.
export default function OptImg({
  src,
  alt = "",
  widths,
  sizes,
  cssWidth,
  square = false,
  priority = false,
  className,
  style,
  width,
  height,
  draggable,
  "aria-hidden": ariaHidden,
}: {
  src: string | null | undefined;
  alt?: string;
  widths?: number[];
  sizes?: string;
  cssWidth?: number;
  square?: boolean;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  draggable?: boolean;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  const transformable = isTransformableImage(src);
  const useOptimized = transformable && !failed;

  // An image can fail before React has attached onError (server-rendered markup): check once after mount.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0 && transformable) setFailed(true);
  }, [transformable, src]);
  useEffect(() => setFailed(false), [src]);
  const setRef = useCallback((el: HTMLImageElement | null) => {
    ref.current = el;
  }, []);

  if (!src) return null;
  const fallbackWidth = cssWidth ? cssWidth * 2 : widths && widths.length ? widths[Math.floor(widths.length / 2)] : 640;
  const srcAttr = useOptimized ? transformedImageUrl(src, { width: fallbackWidth, square }) : src;
  const srcSet = useOptimized ? (cssWidth ? imageDensitySrcSet(src, cssWidth, { square }) : widths ? imageSrcSet(src, widths, { square }) : undefined) : undefined;
  // `fetchpriority` is spread lowercase: React 18 forwards it as the real HTML attribute (the camelCase prop is not known to it and logs a warning).
  const hints = priority ? ({ fetchpriority: "high" } as Record<string, string>) : {};

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={setRef}
      src={srcAttr}
      srcSet={srcSet || undefined}
      sizes={srcSet && !cssWidth ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={draggable}
      aria-hidden={ariaHidden}
      className={className}
      style={style}
      onError={() => {
        if (transformable) setFailed(true);
      }}
      {...hints}
    />
  );
}
