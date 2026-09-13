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
const ENGAGE_PX = 14;
const THRESHOLD_PX = 68;
const MAX_PULL_PX = 100;
// How much slower the indicator moves than the finger — the same
// "rubber band" feel iOS/Android use so it doesn't feel like the content
// is glued 1:1 to your thumb.
const DAMPING = 0.45;

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

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing || window.scrollY > 0) {
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
      // scrolling immediately.
      if (delta <= 0 || window.scrollY > 0) {
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

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
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
