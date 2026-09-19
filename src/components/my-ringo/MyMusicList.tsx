"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { Download, Loader2, Pause, Play, Shuffle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { LibraryTrack } from "@/lib/customer/activity";
import { usePlayer } from "./player/MusicPlayerProvider";
import { Cover } from "./player/PlayerBits";

// The customer's purchased tracks. PLAYBACK is handled by the shared My Ringo
// player (queue, next/previous, shuffle, repeat, background playback — see
// ./player); tapping a track queues the whole list starting there. Both play
// and download use the EXISTING /api/music/tracks/[id]/audio route, which
// re-verifies on the server that the order is PAID and contains the track and
// returns only a short-lived signed URL. Nothing here holds a permanent audio
// URL, and the 10-second preview on artist pages is not involved.
export default function MyMusicList({ tracks }: { tracks: LibraryTrack[] }) {
  const { t, locale } = useLanguage();
  const player = usePlayer();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (track: LibraryTrack) => {
    if (downloadingKey) return;
    setDownloadError(null);
    setDownloadingKey(track.key);
    try {
      const res = await fetch(`/api/music/tracks/${track.trackId}/audio?order=${encodeURIComponent(track.orderId)}`, {
        headers: { "x-download": "1" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.url !== "string") {
        console.error("My Music: download refused:", res.status, data?.error);
        return setDownloadError(track.key);
      }
      window.open(data.url, "_blank");
    } catch (err) {
      console.error("My Music: download request failed:", err);
      setDownloadError(track.key);
    } finally {
      setDownloadingKey(null);
    }
  };

  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  return (
    <ul className="flex flex-col gap-2.5">
      {tracks.map((track, index) => {
        const isCurrent = player.current?.key === track.key;
        const playing = isCurrent && player.playing;
        const loading = isCurrent && player.loading;
        return (
          <li
            key={track.key}
            className={`rounded-2xl border bg-ringo-surface p-3.5 transition-colors ${
              isCurrent ? "border-ringo-indigo/40" : "border-ringo-border/70"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <Cover url={track.coverUrl} className="h-14 w-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${isCurrent ? "text-ringo-indigo" : "text-ringo-text"}`}>{track.title}</p>
                <p className="truncate text-xs text-ringo-muted">{track.artistName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                    {t.myRingo.library.paid}
                  </span>
                  <span className="text-[11px] text-ringo-muted" suppressHydrationWarning>
                    {t.myRingo.library.purchasedOn(
                      new Date(track.purchasedAt).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })
                    )}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {track.canDownload && (
                  <button
                    onClick={() => download(track)}
                    disabled={!!downloadingKey}
                    aria-label={`${t.myRingo.library.download}: ${track.title}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-ringo-muted transition hover:bg-ringo-muted/10 disabled:opacity-50"
                  >
                    {downloadingKey === track.key ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                  </button>
                )}
                <button
                  onClick={() => (isCurrent ? player.toggle() : player.playQueue(tracks, index))}
                  aria-label={`${playing ? t.myRingo.player.pause : t.myRingo.player.play}: ${track.title}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-ringo-indigo text-white transition active:scale-95"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
                </button>
              </div>
            </div>
            {downloadError === track.key && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {t.myRingo.library.downloadFailed}
              </p>
            )}
            {isCurrent && player.error && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {t.myRingo.library.playFailed}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// "Play all" / "Shuffle" for the whole library — sits above the list.
export function PlayAllBar({ tracks }: { tracks: LibraryTrack[] }) {
  const { t } = useLanguage();
  const player = usePlayer();
  if (tracks.length === 0) return null;

  return (
    <div className="mb-4 flex gap-2.5">
      <button
        onClick={() => player.playQueue(tracks, 0, { shuffle: false })}
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-ringo-indigo px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        <Play size={16} className="translate-x-px" />
        {t.myRingo.player.playAll}
      </button>
      <button
        onClick={() => player.playQueue(tracks, Math.floor(Math.random() * tracks.length), { shuffle: true })}
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-ringo-border bg-ringo-surface px-4 py-3 text-sm font-semibold text-ringo-text transition hover:bg-ringo-muted/10 active:scale-[0.98]"
      >
        <Shuffle size={16} />
        {t.myRingo.player.shuffleAll}
      </button>
    </div>
  );
}
