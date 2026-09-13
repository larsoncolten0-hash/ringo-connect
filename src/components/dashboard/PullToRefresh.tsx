"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useSound } from "@/components/SoundProvider";

// A from-scratch pull-to-refresh gesture for the dashboard — there was no
// custom one before this; mobile/PWA only got the OS/browser's own native
// pull-to-refresh (a full reload), which no web page can hook into for
// progress/threshold/completion feedback. This replaces that with our
// own: drag down from the top of the page, a small indicator reveals and
// tracks the pull, and past a threshold releasing triggers a real
// `router.refresh()` of the current dashboard page.
//
// Sound reuses the app's existing Web Audio tone system (see
// src/lib/sound/tones.ts, src/components/SoundProvider.tsx) rather than
// building new audio infrastructure — that already covers every
// requirement this needed: synthesized tones (nothing to preload — there
// is no audio file, so there is no load delay to begin with), silent
// unless `useSound()`'s `enabled` flag is on (the existing "Sound
// effects" toggle in AvatarMenu already turns this off too — the
// "disable it later" ask is satisfied by a switch that already exists
// today), a gesture-based unlock already wired at the root layout so
// autoplay restrictions are respected, and totally independent of any
// other audio the page might be playing (a separate Web Audio graph, not
// a shared/paused media element). Two distinct, one-shot tones — an
// almost-inaudible tick when the pull engages, a slightly clearer one
// when it crosses the release threshold — never a continuous sound tied
// to drag position, so ordinary scrolling never triggers anything.
//
// Only ever responds to touch events, so it's inherently a no-op on
// desktop/mouse input without needing a breakpoint check — this can only
// activate on an actual touchscreen.
//
// Strictly top-of-page only, by design: a gesture can only ever START
// when the page's scroll position is exactly 0 (see isAtTop() below,
// checked at touchstart), and is immediately abandoned — mid-gesture,
// before any refresh can fire — the instant that stops being true,
// whether that's detected by the gesture's own touchmove math or by the
// separate `scroll` listener that exists purely as a second, independent
// guarantee. Scrolling through the middle of a page, or scrolling
// downward through content, can never trigger this no matter how the
// finger moves — only starting the drag already sitting at the top does.
const ENGAGE_PX = 14;
const THRESHOLD_PX = 68;
const MAX_PULL_PX = 100;
// How much slower the indicator moves than the finger — the same
// "rubber band" feel iOS/Android use so it doesn't feel like the content
// is glued 1:1 to your thumb.
const DAMPING = 0.45;

// The single source of truth for "is the page at the very top" — checked
// three ways (window, and both documentElement/body scrollTop, whichever
// a given mobile browser actually keeps in sync) and required to be
// exactly 0, not just "close enough," so a sliver of residual scroll
// never reads as "at the top." Used both to decide whether a gesture is
// even allowed to start and, continuously, whether it's still allowed to
// continue — see the dedicated `scroll` listener below, which is what
// makes this robust to scroll position changing for reasons other than
// this component's own touchmove math (momentum still settling, a
// keyboard opening, etc.), not just the touch events it drives off of.
function isAtTop(): boolean {
  if (typeof window === "undefined") return false;
  const top = Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
  return top <= 0;
}

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { play } = useSound();
  const shouldReduceMotion = useReducedMotion();
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const engagedRef = useRef(false);
  const thresholdRef = useRef(false);
  const triggeredRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Immediately kills any gesture in progress the instant the page
    // isn't at the top anymore, independent of the touchmove handler's
    // own check — this is what guarantees "never mid-scroll, never
    // mid-page" holds even in edge cases touchmove alone might miss
    // (e.g. momentum from an earlier scroll still resolving under a new
    // touch, or anything else nudging scroll position programmatically).
    const onScroll = () => {
      if (touchStartY.current !== null && !isAtTop()) {
        touchStartY.current = null;
        setPull(0);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing || !isAtTop()) {
        touchStartY.current = null;
        return;
      }
      touchStartY.current = e.touches[0].clientY;
      engagedRef.current = false;
      thresholdRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - touchStartY.current;
      // Only take over once we're both still at the top AND actually
      // pulling down — anything else (pulling up, or having scrolled
      // away from the top mid-gesture) hands the touch back to normal
      // scrolling immediately and for the rest of this gesture (once
      // nulled, touchStartY never gets reassigned until the next
      // touchstart, so a gesture that lost "at the top" status can't
      // silently regain pull-to-refresh partway through).
      if (delta <= 0 || !isAtTop()) {
        touchStartY.current = null;
        setPull(0);
        return;
      }
      e.preventDefault();
      const damped = Math.min(MAX_PULL_PX, delta * DAMPING);
      setPull(damped);

      if (!engagedRef.current && damped > ENGAGE_PX) {
        engagedRef.current = true;
        play("pullEngage");
      }
      if (damped > THRESHOLD_PX) {
        if (!thresholdRef.current) {
          thresholdRef.current = true;
          play("pullThreshold");
        }
      } else {
        // Reset so pulling past the threshold again in the same gesture
        // (drag back, then past it again) re-confirms with the tone
        // rather than staying silent — still only ever one play per
        // actual crossing, never continuous.
        thresholdRef.current = false;
      }
    };

    const onTouchEnd = () => {
      if (touchStartY.current === null) return;
      touchStartY.current = null;
      if (pull > THRESHOLD_PX) {
        setRefreshing(true);
        setPull(THRESHOLD_PX);
        triggeredRef.current = true;
        startTransition(() => {
          router.refresh();
        });
      } else {
        setPull(0);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull, refreshing]);

  // Fires once the refresh transition genuinely finishes (isPending flips
  // back to false) — not on a fixed timer, so the completion chime and
  // the indicator's disappearance always match when the new data actually
  // landed, however long that took.
  useEffect(() => {
    if (triggeredRef.current && !isPending) {
      triggeredRef.current = false;
      play("success");
      setRefreshing(false);
      setPull(0);
    }
  }, [isPending, play]);

  const progress = Math.min(1, pull / THRESHOLD_PX);

  return (
    <div ref={containerRef} style={{ overscrollBehaviorY: "contain" }}>
      <div
        aria-hidden="true"
        className="flex items-center justify-center overflow-hidden pointer-events-none"
        style={{ height: pull, transition: pull === 0 || refreshing ? "height 0.2s ease-out" : undefined }}
      >
        <motion.span
          animate={refreshing && !shouldReduceMotion ? { rotate: 360 } : { rotate: progress * 180 }}
          transition={refreshing && !shouldReduceMotion ? { repeat: Infinity, duration: 0.7, ease: "linear" } : { duration: 0 }}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            progress >= 1 || refreshing ? "bg-ringo-indigo text-white" : "bg-ringo-muted/10 text-ringo-muted"
          }`}
        >
          <RefreshCw size={14} />
        </motion.span>
      </div>
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: pull === 0 ? "transform 0.2s ease-out" : undefined }}>
        {children}
      </div>
    </div>
  );
}
