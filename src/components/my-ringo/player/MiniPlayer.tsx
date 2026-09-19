"use client";

import { Loader2, Pause, Play, SkipForward } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { usePlayer, usePlayerTime } from "./MusicPlayerProvider";
import { Cover } from "./PlayerBits";

// The persistent "now playing" bar. On phones it floats just above the bottom
// tab bar; from `sm` up it sits along the bottom edge next to the sidebar.
// Tapping the track opens the full player.
export default function MiniPlayer() {
  const { t } = useLanguage();
  const p = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const track = p.current;
  if (!track) return null;

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      role="region"
      aria-label={t.myRingo.player.nowPlaying}
      className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 px-3 sm:bottom-0 sm:left-60 sm:px-6 sm:pb-4"
    >
      <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface/95 shadow-[0_8px_30px_-6px_rgba(15,23,42,0.25)] backdrop-blur">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-ringo-muted/15" aria-hidden="true">
          <div className="h-full bg-ringo-indigo transition-[width] duration-200 ease-linear" style={{ width: `${progress}%` }} />
        </div>

        <div className="flex items-center gap-3 p-2.5">
          <button
            onClick={() => p.setExpanded(true)}
            aria-label={t.myRingo.player.expand}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <Cover url={track.coverUrl} className="h-11 w-11 shrink-0 rounded-xl" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ringo-text">{track.title}</span>
              <span className={`block truncate text-xs ${p.error ? "text-red-600" : "text-ringo-muted"}`}>
                {p.error ? t.myRingo.library.playFailed : track.artistName}
              </span>
            </span>
          </button>

          <button
            onClick={p.toggle}
            aria-label={p.playing ? t.myRingo.player.pause : t.myRingo.player.play}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ringo-indigo text-white transition active:scale-95"
          >
            {p.loading ? <Loader2 size={18} className="animate-spin" /> : p.playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
          </button>
          <button
            onClick={p.next}
            aria-label={t.myRingo.player.next}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ringo-text transition hover:bg-ringo-muted/10 active:scale-95"
          >
            <SkipForward size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
