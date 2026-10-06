"use client";

import type { CSSProperties } from "react";
import { Disc3, Pause, Play } from "lucide-react";
import { hexToRgba, readableOn } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { LatestRelease } from "@/lib/latestRelease";
import type { Translations } from "@/lib/i18n/translations";

// The editorial lead of a Music profile when the artist has not pinned anything: their newest real release, as an object rather than a list row.
// Artwork first (with a 1px edge in the artist's own accent), then what it is, what it is called, what it costs, and one clear way in. Nothing is invented:
// no release and no single means nothing renders, and a release without artwork shows a tinted placeholder, never fake art.
//
// It does not change how anything is sold: Buy now goes to the release's or song's own page (where the cart, the 10-second preview and the purchase
// already live), the play button is the same preview toggle the rest of the page uses, and the prices are the artist's. The Ink card is the stage's player
// surface, so its colors come from the foundation tokens, not a palette of its own.
export default function LatestReleaseFeature({
  t,
  latest,
  artistName,
  accent,
  buttonStyle,
  radiusClass,
  player,
  currency,
  username,
  playingId,
  onTogglePlay,
}: {
  t: Translations;
  latest: LatestRelease;
  artistName: string;
  accent: string;
  buttonStyle: CSSProperties;
  radiusClass: string;
  player: { background: string; text: string };
  currency: string;
  username: string;
  playingId: string | null;
  onTogglePlay: (track: any) => void;
}) {
  const { kind, item } = latest;
  const isTrack = kind === "track";
  const href = isTrack ? `/m/${username}/track/${item.id}` : `/m/${username}/release/${item.id}`;
  const priced = item.price != null && Number(item.price) > 0;
  const typeLabel = isTrack ? t.music.typeSingle : item.release_type === "album" ? t.music.typeAlbum : t.music.typeEp;
  const credit = isTrack ? item.artist_name || artistName : artistName;
  // The same preview rule the rest of the page uses: a protected track plays only its short clip, never the full audio.
  const previewUrl = isTrack ? (item.protected_audio_path ? item.preview_audio_url : item.audio_url) : null;
  const playing = isTrack && playingId === item.id;
  const onAccent = readableOn(accent);

  return (
    <section
      aria-labelledby="latest-release-title"
      className="relative w-full overflow-hidden rounded-ringo-xl animate-fade-up"
      style={{ backgroundColor: player.background, color: player.text, animationDelay: "320ms" }}
    >
      <a href={href} className="relative block aspect-[4/3] w-full overflow-hidden" aria-label={item.title} tabIndex={-1}>
        {item.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${hexToRgba(accent, 0.45)}, ${hexToRgba(accent, 0.08)})` }}>
            <Disc3 size={44} strokeWidth={1.4} style={{ color: accent, opacity: 0.85 }} aria-hidden="true" />
          </div>
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 1px ${hexToRgba(accent, 0.4)}` }} />
      </a>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-wide" style={{ color: accent }}>
            {t.music.latestRelease}
          </p>
          <h2 id="latest-release-title" className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] [overflow-wrap:anywhere] sm:text-3xl">
            {item.title}
          </h2>
          <p className="text-sm" style={{ opacity: 0.75 }}>
            {typeLabel}
            {credit ? ` · ${credit}` : ""}
            {isTrack && item.duration ? ` · ${item.duration}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={href}
            className={`ringo-tactile inline-flex min-h-[44px] items-center justify-center px-5 text-sm font-semibold transition hover:brightness-95 ${radiusClass}`}
            style={buttonStyle}
          >
            {priced ? t.music.buyNowLabel : t.music.viewRelease}
            {priced && (
              <span className="ml-2 font-bold tabular-nums" suppressHydrationWarning>
                {formatPrice(item.price, currency)}
              </span>
            )}
          </a>
          {previewUrl && (
            <button
              type="button"
              onClick={() => onTogglePlay(item)}
              aria-label={playing ? t.music.pauseLabel : t.music.playLabel}
              className="ringo-tactile inline-flex h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: accent, color: onAccent }}
            >
              {playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} className="ml-0.5" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
