"use client";

import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import type { Translations } from "@/lib/i18n/translations";

// The way into the artist's whole store from the profile: one calm card and one button, so the commerce layer (songs, EPs and albums, merch, tickets) reads
// as a destination of its own rather than a few modules among others. The store page itself (/m/[username]) is unchanged; this only links to it and says
// what is in it, with the artist's real counts (a count of zero is simply not mentioned).
export default function MusicStoreEntry({
  t,
  username,
  counts,
  buttonStyle,
  radiusClass,
  borderTint,
  preview = false,
}: {
  t: Translations;
  username: string;
  counts: { songs: number; releases: number; merch: number; events: number };
  buttonStyle: CSSProperties;
  radiusClass: string;
  borderTint: string;
  /** Inside the dashboard editor's preview nothing navigates away. */
  preview?: boolean;
}) {
  const M = t.music;
  const parts = [
    counts.songs > 0 ? M.storeCountSongs(counts.songs) : null,
    counts.releases > 0 ? M.storeCountReleases(counts.releases) : null,
    counts.merch > 0 ? M.storeCountMerch(counts.merch) : null,
    counts.events > 0 ? M.storeCountEvents(counts.events) : null,
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return null;

  return (
    <section aria-labelledby="music-store-title" className="flex flex-col gap-3 rounded-ringo-lg border p-4 sm:p-5" style={{ borderColor: borderTint }}>
      <div className="flex flex-col gap-1">
        <h2 id="music-store-title" className="font-display text-xl font-bold tracking-[-0.01em]">
          {M.storeTitle}
        </h2>
        <p className="text-sm leading-relaxed" style={{ opacity: 0.7 }}>
          {M.storeBody}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium" style={{ opacity: 0.85 }}>
          {parts.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </p>
      </div>
      <a
        href={`/m/${username}`}
        onClick={preview ? (e) => e.preventDefault() : undefined}
        className={`ringo-tactile inline-flex min-h-[44px] w-full items-center justify-center gap-2 px-5 text-sm font-semibold transition hover:brightness-95 ${radiusClass}`}
        style={buttonStyle}
      >
        {M.storeCta}
        <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );
}
