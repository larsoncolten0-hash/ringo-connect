"use client";

import { Disc3, ShoppingBag } from "lucide-react";
import { hexToRgba, readableOn } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

// A compact teaser grid for EPs/Albums on the public profile — tapping a
// release opens its own detail page (tracklist, track count, description)
// at /m/[username]/release/[id]; the actual purchase (cart, checkout,
// receipt) still only happens from there, same as songs/merch/tickets.
// This section exists so a release is actually discoverable from the
// profile itself, not only reachable by someone who already clicked into
// the storefront.
export default function ReleasesSection({
  t,
  releases,
  username,
  accent,
  currency,
}: {
  t: Translations;
  releases: any[];
  username: string;
  accent: string;
  currency: string;
}) {
  const available = releases.filter((r) => r.available !== false);
  if (available.length === 0) return null;
  const onAccent = readableOn(accent);
  // Editorial: with an odd number of releases the first one leads, full width, so the grid below it always fills evenly. The cards,
  // links, prices and order are exactly the creator's; only the first card's width changes.
  const leadFirst = available.length % 2 === 1;

  return (
    <div id="releases" className="flex flex-col gap-3 scroll-mt-6">
      <h2 className="text-base font-bold flex items-center gap-2">
        <Disc3 size={17} style={{ color: accent }} />
        {t.music.releasesTitle}
      </h2>

      <div className="grid grid-cols-2 gap-3">
        {available.map((release, index) => (
          <a
            key={release.id}
            href={`/m/${username}/release/${release.id}`}
            className={`overflow-hidden rounded-ringo-lg transition hover:-translate-y-0.5 ${leadFirst && index === 0 ? "col-span-2" : ""}`}
            style={{ border: `1px solid ${hexToRgba(accent, 0.15)}` }}
          >
            {release.cover_image_url ? (
              <img src={release.cover_image_url} alt="" className={`w-full object-cover ${leadFirst && index === 0 ? "aspect-[16/10]" : "aspect-square"}`} />
            ) : (
              <div
                className={`w-full flex items-center justify-center ${leadFirst && index === 0 ? "aspect-[16/10]" : "aspect-square"}`}
                style={{ backgroundColor: hexToRgba(accent, 0.12) }}
              >
                <Disc3 size={28} style={{ color: accent }} />
              </div>
            )}
            <div className="p-3">
              <p className="text-sm font-semibold truncate">{release.title || t.music.untitledRelease}</p>
              <p className="text-xs mt-0.5 uppercase tracking-wide" style={{ opacity: 0.6 }}>
                {release.release_type === "album" ? t.music.buyAlbum : t.music.buyEp}
              </p>
              {release.price && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-semibold mt-2 px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: accent, color: onAccent }}
                >
                  <ShoppingBag size={12} />
                  {formatPrice(release.price, currency)}
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
