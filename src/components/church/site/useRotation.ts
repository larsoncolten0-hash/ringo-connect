"use client";

import { useCallback, useEffect, useState, type FocusEvent, type PointerEvent } from "react";

// Automatic rotation for the church site's slideshows (testimonies, announcements, groups). One behaviour, in one place:
//   * it advances every `intervalMs`, wrapping round, only when there is more than one slide;
//   * it never starts for a visitor who asked their device for reduced motion (they can still press Play, or use the arrows);
//   * it stops while a MOUSE is over the slideshow, while something inside it has KEYBOARD focus, while the browser tab is hidden, and while the slideshow is scrolled out of view (so a visitor who
//     scrolls down to it always meets the first slide, and nothing runs for nothing);
//   * the visitor can always Pause and Play (a visible button the slideshow draws from `playing` / `toggle`), and using the arrows or the dots restarts the timer from that slide;
//   * a screen reader is not interrupted while it rotates: the slide's live region is "off" while playing and "polite" once it is paused or moved by hand (`live`).
/** Only a real mouse holds the slideshow by hovering: on a phone a tap fires an emulated "hover" that never ends, which would freeze it for good. */
export const holdsOnPointer = (pointerType: string | undefined): boolean => pointerType === "mouse";

/** Only keyboard focus holds it: a mouse click leaves the clicked button focused, and pressing Play must not leave the slideshow stuck. Where `:focus-visible` is unknown, assume keyboard (the safe way: it holds). */
export function holdsOnFocus(target: { matches?: (selector: string) => boolean } | null | undefined): boolean {
  try {
    return target && typeof target.matches === "function" ? target.matches(":focus-visible") : true;
  } catch {
    return true;
  }
}

export function useRotation(count: number, intervalMs: number = 7000) {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  // true until the browser says otherwise (server render, and browsers without IntersectionObserver, simply keep rotating)
  const [inView, setInView] = useState(true);
  const [root, setRoot] = useState<Element | null>(null);
  // a visitor who prefers reduced motion starts paused; pressing Play is their explicit choice
  const [forcedPlay, setForcedPlay] = useState(false);

  useEffect(() => {
    const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!mq) return;
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener?.("change", read);
    return () => mq.removeEventListener?.("change", read);
  }, []);

  useEffect(() => {
    const read = () => setHidden(document.visibilityState === "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);

  useEffect(() => {
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1]?.isIntersecting ?? true), { threshold: 0.25 });
    io.observe(root);
    return () => io.disconnect();
  }, [root]);

  const current = count > 0 ? Math.min(index, count - 1) : 0;
  const wantsPlay = reduced ? forcedPlay : !userPaused;
  const running = count > 1 && wantsPlay && !hovered && !focused && !hidden && inView;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setIndex((i) => (count > 0 ? (Math.min(i, count - 1) + 1) % count : 0)), intervalMs);
    return () => window.clearInterval(id);
    // `current` is a dependency on purpose: moving by hand restarts the countdown from the new slide
  }, [running, count, intervalMs, current]);

  const go = useCallback((to: number) => setIndex(count > 0 ? ((to % count) + count) % count : 0), [count]);
  const toggle = useCallback(() => {
    if (reduced) setForcedPlay((p) => !p);
    else setUserPaused((p) => !p);
  }, [reduced]);

  return {
    index: current,
    go,
    next: () => go(current + 1),
    prev: () => go(current - 1),
    /** The visitor's setting: true when the slideshow is set to play (it may still be held still by hover, focus or a hidden tab). */
    playing: wantsPlay,
    toggle,
    /** "off" while it rotates by itself, "polite" otherwise, for the slide's `aria-live`. */
    live: (running ? "off" : "polite") as "off" | "polite",
    /** Put on the slideshow's root element (`ref={rotation.rootRef}`), so it only rotates while it is on screen. */
    rootRef: setRoot as (el: Element | null) => void,
    /** Spread on the slideshow's root element. */
    hold: {
      onPointerEnter: (e: PointerEvent<Element>) => setHovered(holdsOnPointer(e.pointerType)),
      onPointerLeave: () => setHovered(false),
      onFocus: (e: FocusEvent) => setFocused(holdsOnFocus(e.target as Element)),
      onBlur: (e: FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      },
    },
  };
}
