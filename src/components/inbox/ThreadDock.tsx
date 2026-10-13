"use client";

import { useEffect, useRef } from "react";

// The row directly above the reply box. On phones and tablets the page's two floating helpers (Ringo AI and Help) live in a fixed corner that would sit on the reply box and its
// Send button; while a conversation is open this row RESERVES that space (its right end is left empty) and tells the floating buttons where it is, so they dock into it instead.
// On large screens the Inbox keeps a free column at the right edge for them, so nothing is reserved here. Nothing else about the helpers changes, and they are removed from
// their docked place again as soon as the conversation closes.
export default function ThreadDock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    root.setAttribute("data-inbox-thread", "1");
    const update = () => {
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewportBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      root.style.setProperty("--ringo-inbox-dock-bottom", `${Math.max(0, Math.round(viewportBottom - r.bottom))}px`);
    };
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
      root.removeAttribute("data-inbox-thread");
      root.style.removeProperty("--ringo-inbox-dock-bottom");
    };
  }, []);

  return (
    <div ref={ref} className="flex min-h-[4.5rem] items-end lg:min-h-0 lg:block" data-testid="thread-dock">
      <div className="min-w-0 flex-1">{children}</div>
      {/* the reserved corner for the docked Ringo AI and Help buttons (phones and tablets only) */}
      <div className="h-[4.5rem] w-[9.5rem] shrink-0 lg:hidden" aria-hidden="true" data-dock-reserve="true" />
    </div>
  );
}
