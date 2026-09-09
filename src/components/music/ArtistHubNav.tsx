"use client";

import { Music, ShoppingBag, Ticket, Heart, ChevronRight } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";

// Quick-nav shortcuts down to whatever sections actually exist below —
// not content of its own. Matches the "Artist Hub" cards in the design
// reference, but each one only appears when the section it points to has
// something in it (or, for Support, is turned on) — nothing here is ever
// a dead link to an empty section.
export default function ArtistHubNav({
  t,
  accent,
  borderTint,
  radiusClass,
  musicLabel,
  merchLabel,
  showMusic,
  showMerch,
  showTickets,
  showSupport,
}: {
  t: Translations;
  accent: string;
  borderTint: string;
  radiusClass: string;
  musicLabel: string;
  merchLabel: string;
  showMusic: boolean;
  showMerch: boolean;
  showTickets: boolean;
  showSupport: boolean;
}) {
  const cards = [
    showMusic && { href: "#music", icon: Music, label: musicLabel, hint: t.music.hubMusicLabel, bg: "#6D5EF0" },
    showMerch && { href: "#merch", icon: ShoppingBag, label: merchLabel, hint: t.music.hubMerchLabel, bg: "#E0546B" },
    showTickets && { href: "#events", icon: Ticket, label: t.music.upcomingTitle, hint: t.music.hubTicketsLabel, bg: "#1F9E85" },
    showSupport && { href: "#support", icon: Heart, label: t.music.hubSupportLabel, hint: t.music.hubSupportHint, bg: "#E0546B" },
  ].filter(Boolean) as { href: string; icon: any; label: string; hint: string; bg: string }[];

  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
        {t.music.artistHubTitle}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {cards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            className={`flex items-center gap-2.5 p-3 transition hover:-translate-y-0.5 active:scale-[0.98] ${radiusClass}`}
            style={{ border: `1px solid ${borderTint}` }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: hexToRgba(card.bg, 0.18) }}
            >
              <card.icon size={15} style={{ color: card.bg }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold truncate">{card.label}</span>
              <span className="block text-[10px] truncate" style={{ opacity: 0.6 }}>
                {card.hint}
              </span>
            </span>
            <ChevronRight size={14} className="shrink-0" style={{ opacity: 0.4 }} />
          </a>
        ))}
      </div>
    </div>
  );
}
