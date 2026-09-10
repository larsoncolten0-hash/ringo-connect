"use client";

import { Disc3, ShoppingBag } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

// A compact teaser grid for EPs/Albums on the public profile — the actual
// purchase (cart, checkout, receipt) only happens on the dedicated Buy Now
// storefront (/m/[username]), same as songs/merch/tickets; this section
// exists so a release is actually discoverable from the profile itself,
// not only reachable by someone who already clicked into the storefront.
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

  return (
    <div id="releases" className="flex flex-col gap-3 scroll-mt-6">
      <p className="text-base font-bold flex items-center gap-2">
        <Disc3 size={17} style={{ color: accent }} />
        {t.music.releasesTitle}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {available.map((release) => (
          <a
            key={release.id}
            href={`/m/${username}`}
            className="overflow-hidden rounded-2xl transition hover:-translate-y-0.5"
            style={{ border: `1px solid ${hexToRgba(accent, 0.15)}` }}
          >
            {release.cover_image_url ? (
              <img src={release.cover_image_url} alt="" className="w-full aspect-square object-cover" />
            ) : (
              <div
                className="w-full aspect-square flex items-center justify-center"
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
                  style={{ backgroundColor: accent, color: "#fff" }}
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
