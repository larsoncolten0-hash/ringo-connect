"use client";

import { Star, ArrowRight } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

// A teaser, not the ordering surface itself — tapping any card (or "View
// all") goes to the real menu/cart/checkout flow at /r/[username]. Shows
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
}: {
  t: Translations;
  username: string;
  items: any[];
  currency: string;
  accent: string;
  radiusClass: string;
  borderTint: string;
}) {
  const available = items.filter((i) => i.available !== false);
  const featured = available.filter((i) => i.featured);
  const rest = available.filter((i) => !i.featured);
  const shown = [...featured, ...rest].slice(0, 3);

  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold">{t.restaurant.featuredMenuTitle}</p>
        <a href={`/r/${username}`} className="text-sm font-medium flex items-center gap-1" style={{ color: accent }}>
          {t.restaurant.viewAllMenu}
          <ArrowRight size={13} />
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {shown.map((item) => (
          <a
            key={item.id}
            href={`/r/${username}`}
            className={`overflow-hidden transition hover:-translate-y-0.5 ${radiusClass}`}
            style={{ border: `1px solid ${borderTint}` }}
          >
            {item.image_url ? (
              <img src={item.image_url} alt={item.name} className="w-full aspect-square object-cover" />
            ) : (
              <div className="w-full aspect-square" style={{ backgroundColor: borderTint }} />
            )}
            <div className="p-2">
              <p className="text-xs font-semibold truncate">{item.name}</p>
              <p className="text-xs font-bold mt-0.5" style={{ color: accent }} suppressHydrationWarning>
                {formatPrice(item.price, currency)}
              </p>
              {item.featured && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1"
                  style={{ backgroundColor: accent, color: "#fff" }}
                >
                  <Star size={8} fill="currentColor" />
                  {t.restaurant.featuredLabel}
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
