"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ListMusic, Moon, Sun, Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { usePlayer, usePlayerTime } from "./MusicPlayerProvider";
import { Cover } from "./PlayerBits";
import Waveform from "./Waveform";
import { usePlayerTheme } from "./playerTheme";
import { BAR_COUNT, cachedPeaks, loadPeaks, seededPeaks } from "./waveformPeaks";

// The full-screen player: large artwork, seek bar, transport controls,
// shuffle / repeat, volume (desktop — phones use the hardware buttons and
// browsers ignore script-set volume there) and the play queue.
export default function FullPlayer() {
  const { t } = useLanguage();
  const p = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const [showQueue, setShowQueue] = useState(false);
  const { theme, toggle: toggleTheme } = usePlayerTheme();
  const track = p.current;
  const trackKey = track?.key ?? null;
  const getSourceUrl = p.sourceUrl;

  // Real waveform peaks: shown from cache instantly, otherwise a stable
  // placeholder shape until the file (already resolved by the player) has been
  // analysed once. Analysis waits for the duration, i.e. for a loaded source.
  const [peaks, setPeaks] = useState<number[]>(() => (trackKey && cachedPeaks(trackKey)) || seededPeaks(trackKey || ""));
  const hasDuration = duration > 0;
  useEffect(() => {
    if (!trackKey) return;
    const known = cachedPeaks(trackKey);
    setPeaks(known || seededPeaks(trackKey));
    if (known || !hasDuration) return;
    const url = getSourceUrl();
    if (!url) return;
    const ctl = new AbortController();
    void loadPeaks(trackKey, url, ctl.signal).then((real) => {
      if (real && !ctl.signal.aborted && real.length === BAR_COUNT) setPeaks(real);
    });
    return () => ctl.abort();
  }, [trackKey, hasDuration, getSourceUrl]);

  // Subtle audio-reactive response: the real amplitude at the playhead nudges
  // the artwork's scale and glow (written straight to styles, no re-render).
  const artRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const onEnergy = useCallback((e: number) => {
    if (artRef.current) artRef.current.style.transform = `scale(${1 + e * 0.028})`;
    if (glowRef.current) {
      glowRef.current.style.opacity = String(0.12 + e * 0.5);
      glowRef.current.style.transform = `scale(${0.96 + e * 0.1})`;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.setExpanded(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!track) return null;

  const pl = t.myRingo.player;
  const repeatLabel = p.repeat === "off" ? pl.repeatOff : p.repeat === "all" ? pl.repeatAll : pl.repeatOne;
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;
  const active = "text-ringo-indigo bg-ringo-indigo/10";
  const idle = "text-ringo-muted hover:bg-ringo-muted/10";
  const queueTracks = p.order.map((qi) => p.queue[qi]);

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 340, damping: 36 }}
      role="dialog"
      aria-modal="true"
      aria-label={pl.nowPlaying}
      className={`${theme === "dark" ? "dark " : ""}fixed inset-0 z-[55] flex flex-col bg-ringo-bg text-ringo-text`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* the cover, heavily blurred, as an ambient backdrop (static, no animation cost) */}
      {track.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={track.coverUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-3/5 w-full scale-125 object-cover opacity-20 blur-3xl" />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-ringo-indigo/10 via-ringo-bg/60 to-ringo-bg" aria-hidden="true" />

      <header className="relative flex items-center justify-between px-4 py-3">
        <button onClick={() => p.setExpanded(false)} aria-label={pl.minimize} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ringo-muted/10">
          <ChevronDown size={24} />
        </button>
        <p className="text-xs font-semibold uppercase tracking-wider text-ringo-muted">{pl.nowPlaying}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? pl.switchToLight : pl.switchToDark}
            title={theme === "dark" ? pl.switchToLight : pl.switchToDark}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${idle}`}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            onClick={() => setShowQueue((v) => !v)}
            aria-label={pl.queue}
            aria-pressed={showQueue}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${showQueue ? active : idle}`}
          >
            <ListMusic size={20} />
          </button>
        </div>
      </header>

      <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-6 pb-6">
        {showQueue ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <h2 className="mb-2 mt-1 text-sm font-semibold">
              {pl.queue} · {pl.queueCount(queueTracks.length)}
            </h2>
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-ringo-border/70 bg-ringo-surface">
              {queueTracks.map((q, pos) => {
                const isCurrent = pos === p.pos;
                return (
                  <li key={`${q.key}-${pos}`} className="border-b border-ringo-border/60 last:border-0">
                    <button
                      onClick={() => p.jumpToPos(pos)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ringo-muted/[0.06] ${isCurrent ? "bg-ringo-indigo/10" : ""}`}
                    >
                      <Cover url={q.coverUrl} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${isCurrent ? "font-semibold text-ringo-indigo" : "font-medium"}`}>{q.title}</span>
                        <span className="block truncate text-xs text-ringo-muted">{q.artistName}</span>
                      </span>
                      {isCurrent && (p.loading ? <Loader2 size={15} className="animate-spin text-ringo-indigo" /> : p.playing ? <Volume2 size={15} className="text-ringo-indigo" /> : null)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center py-2">
            <div className="relative w-full max-w-[19rem]">
              <div ref={glowRef} className="pointer-events-none absolute inset-3 rounded-3xl bg-ringo-indigo blur-2xl" style={{ opacity: 0.12 }} aria-hidden="true" />
              <div ref={artRef} className="relative will-change-transform">
                <Cover url={track.coverUrl} className="aspect-square w-full rounded-3xl shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)]" />
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 text-center">
          <p className="truncate text-xl font-bold tracking-tight">{track.title}</p>
          <p className={`mt-0.5 truncate text-sm ${p.error ? "text-red-600" : "text-ringo-muted"}`}>{p.error ? t.myRingo.library.playFailed : track.artistName}</p>
        </div>

        <div className="mt-5">
          <Waveform
            peaks={peaks}
            currentTime={currentTime}
            duration={duration}
            playing={p.playing}
            loading={p.loading}
            label={pl.seek}
            onSeek={p.seek}
            onEnergy={onEnergy}
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <motion.button whileTap={{ scale: 0.88 }} onClick={p.toggleShuffle} aria-label={pl.shuffle} aria-pressed={p.shuffle} className={`flex h-11 w-11 items-center justify-center rounded-full transition ${p.shuffle ? active : idle}`}>
            <Shuffle size={20} />
          </motion.button>
          <motion.button whileTap={{ scale: 0.86 }} onClick={p.prev} aria-label={pl.previous} className="flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:bg-ringo-muted/10">
            <SkipBack size={26} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={p.toggle}
            aria-label={p.playing ? pl.pause : pl.play}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-ringo-indigo text-white shadow-lg shadow-ringo-indigo/25"
          >
            {p.loading ? <Loader2 size={26} className="animate-spin" /> : p.playing ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
          </motion.button>
          <motion.button whileTap={{ scale: 0.86 }} onClick={p.next} aria-label={pl.next} className="flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:bg-ringo-muted/10">
            <SkipForward size={26} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={p.cycleRepeat}
            aria-label={repeatLabel}
            aria-pressed={p.repeat !== "off"}
            title={repeatLabel}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition ${p.repeat !== "off" ? active : idle}`}
          >
            <RepeatIcon size={20} />
          </motion.button>
        </div>

        <div className="mt-4 hidden items-center gap-2.5 sm:flex">
          {p.volume === 0 ? <VolumeX size={17} className="text-ringo-muted" /> : <Volume2 size={17} className="text-ringo-muted" />}
          <input
            type="range"
            aria-label={pl.volume}
            min={0}
            max={1}
            step={0.02}
            value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
            className="h-1 w-full cursor-pointer accent-ringo-indigo"
          />
        </div>
      </div>
    </motion.div>
  );
}
