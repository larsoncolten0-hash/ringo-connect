"use client";

import { Children, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// A horizontal collection: the first items of something bigger, laid out so the next card is always partly visible (that sliver is the
// "there is more" cue, no scrollbar needed). A plain native scroller: momentum scrolling, NO snapping, and nothing about a card is
// ever tied to the scroll position (no scale, tilt, parallax or scroll-linked transform), so the shelf stays still while it slides. On a
// mouse, quiet previous / next buttons appear on hover or keyboard focus. Soft edge fades appear only on a side that has more to show.
//
// Presentation only. Every child keeps its own link or button, so the items stay individually focusable and operable; the scroll
// container itself is focusable (a labelled region) so a keyboard user can also move it with the arrow keys.
export default function Rail({
  label,
  prevLabel,
  nextLabel,
  fade,
  className = "",
  children,
}: {
  /** Names the region for assistive technology (for example the section title). */
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** The surface colour behind the rail, for the edge fades. Omit when the surface is not a flat colour: the fades are then skipped. */
  fade?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  // Scroll events fire many times a frame: read them once per frame, and only re-render when an edge actually flips.
  const frame = useRef(0);
  const measureNow = useCallback(() => {
    frame.current = 0;
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft < max - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  const measure = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(measureNow);
  }, [measureNow]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [measure, Children.count(children)]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 200), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const arrow =
    "ringo-tactile pointer-events-auto absolute top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white/95 text-neutral-800 shadow-[0_6px_18px_-6px_rgba(15,14,38,0.35)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover/rail:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:flex";

  return (
    <div
      className={`group/rail ringo-rail-wrap ${className}`}
      data-more-start={edges.start}
      data-more-end={edges.end}
      style={fade ? ({ ["--rail-fade" as string]: fade } as CSSProperties) : undefined}
    >
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowRight") { e.preventDefault(); page(1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); page(-1); }
        }}
        className="ringo-rail rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--ringo-accent))]"
      >
        {children}
      </div>
      {edges.start && (
        <button type="button" aria-label={prevLabel} onClick={() => page(-1)} className={`${arrow} left-1`}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      )}
      {edges.end && (
        <button type="button" aria-label={nextLabel} onClick={() => page(1)} className={`${arrow} right-1`}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
