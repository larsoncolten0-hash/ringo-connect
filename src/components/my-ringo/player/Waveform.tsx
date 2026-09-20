"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "./PlayerBits";

// The player's signature element: an interactive waveform that doubles as the
// seek bar. Two identical bar layers are stacked — a muted one, and an accent
// one revealed with clip-path up to the playhead — so progress is a single
// GPU-friendly style write per frame rather than a React re-render.
//
// Time between the ~4Hz `timeupdate` events is extrapolated from the last
// known media time, so the playhead glides instead of stepping, and is
// re-synced whenever the real time arrives (or after a seek).
//
// The same animation frame reports a smoothed "energy" value (the real
// amplitude of the track at the playhead) to `onEnergy`, which the parent
// uses for the subtle artwork response. It settles to 0 when paused/buffering.

const Bars = memo(function Bars({ peaks }: { peaks: number[] }) {
  return (
    <div className="flex h-full w-full items-center gap-[2px]" aria-hidden="true">
      {peaks.map((v, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-full bg-current transition-[height] duration-500 ease-out"
          style={{ height: `${Math.max(8, v * 100)}%` }}
        />
      ))}
    </div>
  );
});

export default function Waveform({
  peaks,
  currentTime,
  duration,
  playing,
  loading,
  label,
  onSeek,
  onEnergy,
}: {
  peaks: number[];
  currentTime: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  label: string;
  onSeek: (seconds: number) => void;
  onEnergy?: (energy: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const playedRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);

  // Everything the animation loop reads lives in refs so the loop never restarts.
  const live = useRef({ duration, playing, loading, peaks, onEnergy });
  live.current = { duration, playing, loading, peaks, onEnergy };
  const clock = useRef({ t: currentTime, at: 0 });
  const scrub = useRef<number | null>(null);
  const energy = useRef(0);
  const raf = useRef(0);
  const reduced = useRef(false);

  const frame = useCallback(() => {
    raf.current = 0;
    const { duration: d, playing: pl, loading: ld, peaks: pk } = live.current;
    const now = performance.now();
    const advancing = pl && !ld;
    let t = clock.current.t + (advancing ? (now - clock.current.at) / 1000 : 0);
    if (d > 0) t = Math.min(Math.max(t, 0), d);
    const frac = scrub.current ?? (d > 0 ? t / d : 0);

    if (playedRef.current) playedRef.current.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
    if (headRef.current) headRef.current.style.left = `${frac * 100}%`;

    let target = 0;
    if (advancing && scrub.current === null && !reduced.current && pk.length) {
      const x = frac * (pk.length - 1);
      const lo = Math.floor(x);
      const hi = Math.min(pk.length - 1, lo + 1);
      target = pk[lo] + (pk[hi] - pk[lo]) * (x - lo);
    }
    energy.current += (target - energy.current) * (target > energy.current ? 0.35 : 0.1);
    if (Math.abs(target - energy.current) < 0.004) energy.current = target;
    live.current.onEnergy?.(energy.current);

    // Keep going only while something is still moving.
    if (advancing || energy.current > 0 || scrub.current !== null) raf.current = requestAnimationFrame(frame);
  }, []);

  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  // Re-sync to the real playback time and (re)start the loop when state changes.
  useEffect(() => {
    clock.current = { t: currentTime, at: performance.now() };
    kick();
  }, [currentTime, duration, playing, loading, peaks, kick]);

  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  const fracFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fracFromEvent(e);
    scrub.current = f;
    setScrubFrac(f);
    kick();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrub.current === null) return;
    const f = fracFromEvent(e);
    scrub.current = f;
    setScrubFrac(f);
  };
  const endScrub = (commit: boolean) => {
    const f = scrub.current;
    scrub.current = null;
    setScrubFrac(null);
    if (commit && f !== null && duration) {
      // Hold the playhead at the target until the audio confirms the new time.
      clock.current = { t: f * duration, at: performance.now() };
      onSeek(f * duration);
    }
    kick();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!duration) return;
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : 0;
    if (step) {
      e.preventDefault();
      onSeek(Math.min(duration, Math.max(0, currentTime + step)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(Math.max(0, duration - 1));
    }
  };

  const scrubbing = scrubFrac !== null;
  const shownTime = scrubbing ? scrubFrac * duration : currentTime;

  return (
    <div>
      <div
        ref={wrapRef}
        role="slider"
        tabIndex={duration ? 0 : -1}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shownTime)}
        aria-valuetext={`${formatTime(shownTime)} / ${formatTime(duration)}`}
        aria-disabled={!duration}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endScrub(true)}
        onPointerCancel={() => endScrub(false)}
        onKeyDown={onKeyDown}
        // touch-action:none keeps a horizontal drag on the waveform from scrolling the page.
        style={{ touchAction: "none" }}
        className={`relative h-[4.5rem] w-full select-none py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 rounded-lg ${
          duration ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="relative h-full w-full">
          <div className={`absolute inset-0 text-ringo-muted/30 ${loading ? "animate-pulse" : ""}`}>
            <Bars peaks={peaks} />
          </div>
          <div ref={playedRef} className="absolute inset-0 text-ringo-indigo" style={{ clipPath: "inset(0 100% 0 0)" }}>
            <Bars peaks={peaks} />
          </div>
          <div
            ref={headRef}
            className={`pointer-events-none absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-ringo-indigo shadow-sm transition-[opacity,scale] duration-200 ${
              duration ? "opacity-100" : "opacity-0"
            } ${scrubbing ? "scale-x-[2]" : ""}`}
            style={{ left: "0%" }}
          />
          {scrubbing && (
            <div
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-ringo-text px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ringo-bg"
              style={{ left: `${Math.min(0.9, Math.max(0.1, scrubFrac)) * 100}%` }}
            >
              {formatTime(shownTime)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] font-medium tabular-nums text-ringo-muted">
        <span>{formatTime(shownTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
