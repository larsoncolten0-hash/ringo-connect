"use client";

import { ArrowRight, Disc3, ShoppingBag } from "lucide-react";
import Rail from "@/components/ui/Rail";
import { hexToRgba, readableOn } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";
import OptImg from "@/components/ui/OptImg";

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
  fadeColor,
}: {
  t: Translations;
  releases: any[];
  username: string;
  accent: string;
  currency: string;
  /** The flat surface colour behind this section, for the rail's edge fades (omit on a gradient background). */
  fadeColor?: string;
}) {
  const available = releases.filter((r) => r.available !== false);
  if (available.length === 0) return null;
  const onAccent = readableOn(accent);
  // Editorial: with an odd number of releases the first one leads, full width, so the grid below it always fills evenly. The cards,
  // links, prices and order are exactly the creator's; only the first card's width changes.
  // three or more releases scroll sideways as a rail (the next cover peeks in) with a link to the full storefront; one or two keep the grid
  const asRail = available.length >= 3;
  const leadFirst = !asRail && available.length % 2 === 1;

  return (
    <div id="releases" className="flex flex-col gap-3 scroll-mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Disc3 size={17} style={{ color: accent }} />
          {t.music.releasesTitle}
        </h2>
        {asRail && (
          <a
            href={`/m/${username}`}
            className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-current/25 px-3.5 text-xs font-semibold"
          >
            {t.music.viewMusic}
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      {(() => {
        const cards = available.map((release, index) => (
          <a
            key={release.id}
            href={`/m/${username}/release/${release.id}`}
            className={`ringo-lift ringo-lift--flat block overflow-hidden rounded-ringo-lg ${asRail ? "w-[44vw] min-w-[150px] max-w-[200px] sm:w-[200px] sm:max-w-none" : ""} ${leadFirst && index === 0 ? "col-span-2" : ""}`}
            style={{ border: `1px solid ${hexToRgba(accent, 0.15)}` }}
          >
            {release.cover_image_url ? (
              <OptImg src={release.cover_image_url} widths={[200, 400, 800]} sizes={leadFirst && index === 0 ? "(min-width: 640px) 480px, 100vw" : "(min-width: 640px) 200px, 44vw"} priority={leadFirst && index === 0} className={`w-full object-cover ${leadFirst && index === 0 ? "aspect-[16/10]" : "aspect-square"}`} />
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
        ));
        return asRail ? (
          <Rail label={t.music.releasesTitle} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade={fadeColor}>
            {cards}
          </Rail>
        ) : (
          <div className="grid grid-cols-2 gap-3">{cards}</div>
        );
      })()}
    </div>
  );
}
