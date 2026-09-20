"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { Check, Download, HardDriveDownload, Loader2, Pause, Play, Shuffle, WifiOff } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { LibraryTrack } from "@/lib/customer/activity";
import { usePlayer } from "./player/MusicPlayerProvider";
import { Cover } from "./player/PlayerBits";
import { useOffline } from "./player/useOffline";

// The customer's purchased tracks. PLAYBACK is handled by the shared My Ringo
// player (queue, next/previous, shuffle, repeat, background playback — see
// ./player); tapping a track queues the whole list starting there.
//
// Play, download and "save for offline" all use the EXISTING
// /api/music/tracks/[id]/audio route, which re-verifies on the server that the
// order is PAID and contains the track and returns only a short-lived signed
// URL. Nothing here holds a permanent audio URL, and the 10-second preview on
// artist pages is not involved. Saving for offline is only offered for tracks
// the artist allows to be downloaded.
export default function MyMusicList({ tracks }: { tracks: LibraryTrack[] }) {
  const { t, locale } = useLanguage();
  const player = usePlayer();
  const offline = useOffline();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Briefly shows a check on the download button once the file has been
  // handed to the browser, so it never looks like "nothing happened".
  const [downloadedKey, setDownloadedKey] = useState<string | null>(null);

  // Keep only files that belong to THIS customer's library on the device. (Skipped
  // for an empty list so a transient load problem can never wipe saved music.)
  const { prune } = offline;
  useEffect(() => {
    if (tracks.length > 0) void prune(new Set(tracks.map((tr) => tr.key)));
  }, [tracks, prune]);

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
      // The signed URL carries a Content-Disposition: attachment header (the
      // route signs it with the download flag), so navigating to it saves the
      // file to the device. This has to be an anchor click rather than
      // window.open: browsers block a window opened after an awaited request
      // (it is no longer inside the tap that started it), which is why the
      // button used to do nothing.
      const a = document.createElement("a");
      a.href = data.url;
      a.download = `${track.title}.mp3`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDownloadedKey(track.key);
      setTimeout(() => setDownloadedKey((k) => (k === track.key ? null : k)), 2500);
    } catch (err) {
      console.error("My Music: download request failed:", err);
      setDownloadError(track.key);
    } finally {
      setDownloadingKey(null);
    }
  };

  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  return (
    <div className="flex flex-col gap-2.5">
      {!offline.online && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
          <WifiOff size={14} className="shrink-0" />
          {t.myRingo.offline.banner}
        </p>
      )}

      <ul className="flex flex-col gap-2.5">
        {tracks.map((track, index) => {
          const isCurrent = player.current?.key === track.key;
          const playing = isCurrent && player.playing;
          const loading = isCurrent && player.loading;
          const saved = offline.isSaved(track.key);
          const progress = offline.progress(track.key);
          const saving = progress !== null;
          // With no connection only a track saved on this device can play.
          const unavailable = !offline.online && !saved;

          return (
            <li
              key={track.key}
              className={`rounded-2xl border bg-ringo-surface p-3.5 transition-colors ${
                isCurrent ? "border-ringo-indigo/40" : "border-ringo-border/70"
              }`}
            >
              <div className="flex items-center gap-3">
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
                <div className="flex shrink-0 items-center gap-0.5">
                  {offline.supported && track.canDownload && (
                    <button
                      onClick={() => (saving ? offline.cancel(track.key) : saved ? offline.remove(track.key) : offline.save(track))}
                      disabled={!saving && !saved && !offline.online}
                      aria-label={`${saving ? t.myRingo.offline.cancel : saved ? t.myRingo.offline.remove : t.myRingo.offline.save}: ${track.title}`}
                      title={saving ? t.myRingo.offline.saving(Math.round((progress ?? 0) * 100)) : saved ? t.myRingo.offline.remove : t.myRingo.offline.save}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-[10px] font-semibold transition hover:bg-ringo-muted/10 disabled:opacity-40 ${
                        saved ? "text-emerald-600" : saving ? "text-ringo-indigo" : "text-ringo-muted"
                      }`}
                    >
                      {saving ? (
                        <span className="relative flex h-7 w-7 items-center justify-center">
                          <Loader2 size={26} className="absolute animate-spin opacity-30" />
                          <span>{Math.round((progress ?? 0) * 100)}</span>
                        </span>
                      ) : saved ? (
                        <Check size={18} />
                      ) : (
                        <HardDriveDownload size={17} />
                      )}
                    </button>
                  )}
                  {track.canDownload && (
                    <button
                      onClick={() => download(track)}
                      disabled={!!downloadingKey || !offline.online}
                      aria-label={`${t.myRingo.library.download}: ${track.title}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-ringo-muted transition hover:bg-ringo-muted/10 disabled:opacity-40"
                    >
                      {downloadingKey === track.key ? <Loader2 size={17} className="animate-spin" /> : downloadedKey === track.key ? <Check size={17} className="text-emerald-600" /> : <Download size={17} />}
                    </button>
                  )}
                  <button
                    onClick={() => (isCurrent ? player.toggle() : player.playQueue(tracks, index))}
                    disabled={unavailable}
                    aria-label={`${playing ? t.myRingo.player.pause : t.myRingo.player.play}: ${track.title}`}
                    className="ml-1 flex h-11 w-11 items-center justify-center rounded-full bg-ringo-indigo text-white transition active:scale-95 disabled:opacity-40"
                  >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
                  </button>
                </div>
              </div>
              {unavailable && <p className="mt-2 text-xs text-ringo-muted">{t.myRingo.offline.needsSave}</p>}
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

      {offline.error && (
        <p role="alert" className="text-xs text-red-600">
          {offline.error === "quota" ? t.myRingo.offline.quota : t.myRingo.offline.failed}
        </p>
      )}
    </div>
  );
}

// "Play all" / "Shuffle" plus the offline controls for the whole library.
export function PlayAllBar({ tracks }: { tracks: LibraryTrack[] }) {
  const { t } = useLanguage();
  const player = usePlayer();
  const offline = useOffline();
  if (tracks.length === 0) return null;

  const savable = tracks.filter((tr) => tr.canDownload);
  const allSaved = savable.length > 0 && savable.every((tr) => offline.isSaved(tr.key));
  const anySaving = savable.some((tr) => offline.progress(tr.key) !== null);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex gap-2.5">
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

      {offline.supported && savable.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-3.5 py-2.5">
          <p className="min-w-0 text-xs text-ringo-muted">
            {t.myRingo.offline.save}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {offline.savedCount > 0 && (
              <button
                onClick={() => void offline.removeAll(tracks)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ringo-muted transition hover:bg-red-500/10 hover:text-red-600"
              >
                {t.myRingo.offline.removeAll}
              </button>
            )}
            {!allSaved && (
              <button
                onClick={() => void offline.saveAll(tracks)}
                disabled={!offline.online || anySaving}
                className="flex items-center gap-1.5 rounded-lg bg-ringo-indigo/10 px-2.5 py-1.5 text-xs font-semibold text-ringo-indigo transition hover:bg-ringo-indigo/15 disabled:opacity-50"
              >
                {anySaving ? <Loader2 size={13} className="animate-spin" /> : <HardDriveDownload size={13} />}
                {t.myRingo.offline.saveAll}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
