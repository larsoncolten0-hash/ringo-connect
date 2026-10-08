"use client";

import { useRef, useState } from "react";
import OptImg from "@/components/ui/OptImg";

// A small horizontal, swipeable image gallery for anything that can carry
// up to 3 photos (products/menu items — see the image_urls column added in
// 2026-09-17_multi_image_catalog.sql). Renders a single plain <img> with no
// scroll chrome when there's zero or one photo, so nothing changes visually
// for the vast majority of listings that only ever had one.
//
// `className` sizes the gallery itself (e.g. "w-full aspect-square" or a
// fixed "w-20 h-20 rounded-xl") — pass it the same classes the old single
// <img> used. `imgClassName` is for photo styling only (e.g. "object-cover"),
// applied to every photo.
export default function ImageGallery({
  images,
  alt,
  className = "",
  imgClassName = "",
}: {
  images: (string | null | undefined)[] | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  const urls = (images || []).filter((u): u is string => !!u);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return <OptImg src={urls[0]} alt={alt} widths={[480, 800, 1200]} sizes="(min-width: 768px) 640px, 100vw" priority className={`${className} ${imgClassName}`} />;
  }

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <div className={`relative ${className}`}>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
      >
        {urls.map((url, i) => (
          // the first photo is what the visitor sees on arrival (eager, high priority); the others wait until the gallery is near them
          <OptImg
            key={url + i}
            src={url}
            alt={i === 0 ? alt : ""}
            widths={[480, 800, 1200]}
            sizes="(min-width: 768px) 640px, 100vw"
            priority={i === 0}
            className={`w-full h-full shrink-0 snap-center ${imgClassName}`}
          />
        ))}
      </div>
      <div className="absolute bottom-1 inset-x-0 flex items-center justify-center gap-1 pointer-events-none">
        {urls.map((_, i) => (
          <span
            key={i}
            className="rounded-full transition-all"
            style={{
              width: i === active ? 10 : 4,
              height: 4,
              backgroundColor: i === active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
