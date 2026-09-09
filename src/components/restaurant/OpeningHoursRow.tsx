"use client";

import { Clock } from "lucide-react";
import { getTodayHours, isOpenNow, formatTime, type OpeningHours } from "@/lib/restaurantHours";
import type { Translations } from "@/lib/i18n/translations";

// The one genuinely new piece of info structured opening_hours enables
// over the generic free-text "Hours" field every other category already
// has (see AboutCard) — a real, live "Open now" / "Closed" readout.
export default function OpeningHoursRow({
  t,
  locale,
  hours,
  accent,
  radiusClass,
  borderTint,
}: {
  t: Translations;
  locale: "en" | "fr";
  hours: OpeningHours | null | undefined;
  accent: string;
  radiusClass: string;
  borderTint: string;
}) {
  const today = getTodayHours(hours);
  const open = isOpenNow(hours);

  return (
    <div className={`flex items-center gap-3 p-3.5 ${radiusClass}`} style={{ border: `1px solid ${borderTint}` }}>
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}22` }}>
        <Clock size={16} style={{ color: accent }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{t.restaurant.hoursTitle}</p>
        <p className="text-xs truncate" style={{ opacity: 0.65 }} suppressHydrationWarning>
          {today.closed ? t.restaurant.closedToggle : `${formatTime(today.open, locale)} – ${formatTime(today.close, locale)}`}
        </p>
      </div>
      <span
        className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5"
        style={open ? { backgroundColor: "#DCFCE7", color: "#166534" } : { backgroundColor: "#FEE2E2", color: "#991B1B" }}
        suppressHydrationWarning
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: open ? "#22C55E" : "#EF4444" }} />
        {open ? t.restaurant.openNow : t.restaurant.closedNow}
      </span>
    </div>
  );
}
