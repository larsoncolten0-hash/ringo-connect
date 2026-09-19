"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Music, Pause, Play } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { LibraryTrack } from "@/lib/customer/activity";

// The customer's purchased tracks. Playing and downloading go through the
// EXISTING /api/music/tracks/[id]/audio route — the same call the store's
// own order confirmation makes — which re-verifies, server-side, that the
// order is PAID and contains this track, and returns only a short-lived
// (10 minute) signed URL. Nothing here holds or builds a permanent audio URL,
// and the 10-second preview mechanism on artist pages is not involved.
export default function MyMusicList({ tracks }: { tracks: LibraryTrack[] }) {
  const { t, locale } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.onended = () => setPlayingKey(null);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  const signedUrl = async (track: LibraryTrack, download: boolean) => {
    const res = await fetch(`/api/music/tracks/${track.trackId}/audio?order=${encodeURIComponent(track.orderId)}`, {
      headers: download ? { "x-download": "1" } : undefined,
    });
    const data = await res.json().catch(() => null);
    return res.ok && typeof data?.url === "string" ? (data.url as string) : null;
  };

  const togglePlay = async (track: LibraryTrack) => {
    const audio = audioRef.current;
    if (!audio || busyKey) return;
    setError(null);

    if (playingKey === track.key) {
      audio.pause();
      setPlayingKey(null);
      return;
    }

    setBusyKey(track.key);
    const url = await signedUrl(track, false);
    setBusyKey(null);
    if (!url) return setError({ key: track.key, message: t.myRingo.library.playFailed });

    audio.src = url;
    try {
      await audio.play();
      setPlayingKey(track.key);
    } catch {
      setError({ key: track.key, message: t.myRingo.library.playFailed });
    }
  };

  const download = async (track: LibraryTrack) => {
    if (busyKey) return;
    setError(null);
    setBusyKey(`${track.key}:dl`);
    const url = await signedUrl(track, true);
    setBusyKey(null);
    if (!url) return setError({ key: track.key, message: t.myRingo.library.downloadFailed });
    window.open(url, "_blank");
  };

  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  return (
    <ul className="flex flex-col gap-2.5">
      {tracks.map((track) => {
        const playing = playingKey === track.key;
        return (
          <li key={track.key} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3.5">
            <div className="flex items-center gap-3.5">
              {track.coverUrl ? (
                <img src={track.coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover bg-ringo-muted/10" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
                  <Music size={22} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ringo-text">{track.title}</p>
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
                    disabled={!!busyKey}
                    aria-label={`${t.myRingo.library.download}: ${track.title}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-ringo-muted transition hover:bg-ringo-muted/10 disabled:opacity-50"
                  >
                    {busyKey === `${track.key}:dl` ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                  </button>
                )}
                <button
                  onClick={() => togglePlay(track)}
                  disabled={!!busyKey && busyKey !== track.key}
                  aria-label={`${playing ? t.myRingo.library.pause : t.myRingo.library.play}: ${track.title}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-ringo-indigo text-white transition active:scale-95 disabled:opacity-50"
                >
                  {busyKey === track.key ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : playing ? (
                    <Pause size={18} />
                  ) : (
                    <Play size={18} className="translate-x-px" />
                  )}
                </button>
              </div>
            </div>
            {error?.key === track.key && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {error.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
