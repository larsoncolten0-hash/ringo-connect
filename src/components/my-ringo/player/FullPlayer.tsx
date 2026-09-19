"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ListMusic, Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { usePlayer, usePlayerTime } from "./MusicPlayerProvider";
import { Cover, formatTime } from "./PlayerBits";

// The full-screen player: large artwork, seek bar, transport controls,
// shuffle / repeat, volume (desktop — phones use the hardware buttons and
// browsers ignore script-set volume there) and the play queue.
export default function FullPlayer() {
  const { t } = useLanguage();
  const p = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const [showQueue, setShowQueue] = useState(false);
  const track = p.current;

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
      className="fixed inset-0 z-[55] flex flex-col bg-ringo-bg text-ringo-text"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* soft accent wash behind the artwork */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-ringo-indigo/15 to-transparent" aria-hidden="true" />

      <header className="relative flex items-center justify-between px-4 py-3">
        <button onClick={() => p.setExpanded(false)} aria-label={pl.minimize} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ringo-muted/10">
          <ChevronDown size={24} />
        </button>
        <p className="text-xs font-semibold uppercase tracking-wider text-ringo-muted">{pl.nowPlaying}</p>
        <button
          onClick={() => setShowQueue((v) => !v)}
          aria-label={pl.queue}
          aria-pressed={showQueue}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition ${showQueue ? active : idle}`}
        >
          <ListMusic size={20} />
        </button>
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
            <Cover url={track.coverUrl} className="aspect-square w-full max-w-[20rem] rounded-3xl shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)]" />
          </div>
        )}

        <div className="mt-5">
          <p className="truncate text-xl font-bold tracking-tight">{track.title}</p>
          <p className={`mt-0.5 truncate text-sm ${p.error ? "text-red-600" : "text-ringo-muted"}`}>{p.error ? t.myRingo.library.playFailed : track.artistName}</p>
        </div>

        <div className="mt-4">
          <input
            type="range"
            aria-label={pl.seek}
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => p.seek(Number(e.target.value))}
            disabled={!duration}
            className="h-1.5 w-full cursor-pointer accent-ringo-indigo disabled:opacity-40"
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ringo-muted">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button onClick={p.toggleShuffle} aria-label={pl.shuffle} aria-pressed={p.shuffle} className={`flex h-11 w-11 items-center justify-center rounded-full transition ${p.shuffle ? active : idle}`}>
            <Shuffle size={20} />
          </button>
          <button onClick={p.prev} aria-label={pl.previous} className="flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-ringo-muted/10 active:scale-95">
            <SkipBack size={26} />
          </button>
          <button
            onClick={p.toggle}
            aria-label={p.playing ? pl.pause : pl.play}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-ringo-indigo text-white shadow-lg shadow-ringo-indigo/30 transition active:scale-95"
          >
            {p.loading ? <Loader2 size={26} className="animate-spin" /> : p.playing ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
          </button>
          <button onClick={p.next} aria-label={pl.next} className="flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-ringo-muted/10 active:scale-95">
            <SkipForward size={26} />
          </button>
          <button
            onClick={p.cycleRepeat}
            aria-label={repeatLabel}
            aria-pressed={p.repeat !== "off"}
            title={repeatLabel}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition ${p.repeat !== "off" ? active : idle}`}
          >
            <RepeatIcon size={20} />
          </button>
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
