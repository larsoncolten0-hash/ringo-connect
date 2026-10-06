"use client";

import { Star, ArrowRight } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import Rail from "@/components/ui/Rail";
import { readableOn } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";

// A teaser, not the ordering surface itself — tapping a dish opens that dish's own page (/r/[username]/item/[id], which adds it to the order),
// and "View menu" opens the full menu/cart/checkout flow at /r/[username]. Shows
// featured items first, then fills up to 3 with whatever's available so
// the section isn't empty just because nothing's been marked featured yet.
export default function FeaturedMenuSection({
  t,
  username,
  items,
  currency,
  accent,
  radiusClass,
  borderTint,
  fadeColor,
}: {
  t: Translations;
  username: string;
  items: any[];
  currency: string;
  accent: string;
  radiusClass: string;
  borderTint: string;
  /** The flat surface colour behind this section, for the rail's edge fades (omit on a gradient background). */
  fadeColor?: string;
}) {
  const available = items.filter((i) => i.available !== false);
  const featured = available.filter((i) => i.featured);
  const rest = available.filter((i) => !i.featured);
  const ordered = [...featured, ...rest];
  // up to three stay the familiar three-up row; more become a rail of the first eight, with the full menu one tap away
  const asRail = ordered.length > 3;
  const shown = ordered.slice(0, asRail ? 8 : 3);

  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">{t.restaurant.featuredMenuTitle}</h2>
        <a
          href={`/r/${username}`}
          className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold"
          style={{ borderColor: borderTint, color: "inherit" }}
        >
          {t.restaurant.viewAllMenu}
          <ArrowRight size={13} aria-hidden="true" />
        </a>
      </div>

      {(() => {
        const cards = shown.map((item) => (
          <a
            key={item.id}
            href={`/r/${username}/item/${item.id}`}
            className={`ringo-lift ringo-lift--flat block overflow-hidden ${radiusClass} ${asRail ? "w-[38vw] min-w-[136px] max-w-[170px] sm:w-[160px]" : ""}`}
            style={{ border: `1px solid ${borderTint}` }}
          >
            {item.image_urls?.[0] || item.image_url ? (
              <img
                src={item.image_urls?.[0] || item.image_url}
                alt={item.name}
                loading="lazy"
                decoding="async"
                className="w-full aspect-square object-cover"
              />
            ) : (
              <div className="w-full aspect-square" style={{ backgroundColor: borderTint }} />
            )}
            <div className="p-2">
              <p className="text-xs font-semibold line-clamp-2 [overflow-wrap:anywhere]">{item.name}</p>
              <p className="text-xs font-bold mt-0.5" style={{ color: accent }} suppressHydrationWarning>
                {formatPrice(item.price, currency)}
              </p>
              {item.featured && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full mt-1"
                  style={{ backgroundColor: accent, color: readableOn(accent) }}
                >
                  <Star size={8} fill="currentColor" />
                  {t.restaurant.featuredLabel}
                </span>
              )}
            </div>
          </a>
        ));
        return asRail ? (
          <Rail label={t.restaurant.featuredMenuTitle} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade={fadeColor}>
            {cards}
          </Rail>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">{cards}</div>
        );
      })()}
    </div>
  );
}
