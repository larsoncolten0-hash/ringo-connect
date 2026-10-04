"use client";

import { useEffect, useRef } from "react";

// A restrained scroll-reveal: fade and a small rise, once, the first time a block below the fold scrolls into view (420ms, the
// foundation's ease: see [data-reveal] in globals.css). Used for the landing page's section blocks, never for every card.
//
// How it stays safe:
//  - The server (and anyone without JavaScript) renders the content visible. Nothing is hidden until the browser has hydrated,
//    has confirmed the person has not asked for reduced motion, and has seen that the block is still below the fold.
//  - Reduced motion: the block is never hidden and never animated. (The previous version rendered a framer-motion element on the
//    server with an inline opacity:0 and a plain <div> on the client when reduced motion was on, so React kept the server's
//    opacity:0 and the whole page stayed invisible for those visitors, and hydration warned about it.)
//  - Blocks already on screen at load are left alone: there is nothing to hide, so nothing flashes.
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    el.dataset.reveal = "armed";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.reveal = "in";
        io.disconnect();
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={delay ? { transitionDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}
