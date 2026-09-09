"use client";

import type { CSSProperties } from "react";
import { Ticket, MapPin, Clock } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";

// Same fixed near-black "player card" treatment as MusicSection — see the
// comment there. "Upcoming" — there's no in-house ticket purchasing
// system, so "Get Ticket" either opens the creator's own ticket link
// (whatever platform they already sell through) or, when they haven't set
// one, falls back to a WhatsApp message — the same pattern products
// already use when they have no landing_url.
const CARD_BG = "#171009";
const CARD_TEXT = "#F5EFE4";

export default function EventsSection({
  t,
  events,
  accent,
  buttonStyle,
  whatsappNumber,
}: {
  t: Translations;
  events: any[];
  accent: string;
  buttonStyle: CSSProperties;
  whatsappNumber?: string | null;
}) {
  if (events.length === 0) return null;

  const dateParts = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return { day: d.getDate(), month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase() };
  };

  return (
    <div id="events" className="flex flex-col gap-3 scroll-mt-6">
      <p className="text-base font-bold flex items-center gap-2">
        <Ticket size={17} style={{ color: accent }} />
        {t.music.upcomingTitle}
      </p>

      <div className="flex flex-col gap-3">
        {events
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((event) => {
            const parts = dateParts(event.event_date);
            const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
            const href =
              event.ticket_url ||
              (cleanNumber
                ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(
                    event.whatsapp_message || t.music.getTicketWhatsappMessage(event.title)
                  )}`
                : null);

            return (
              <div
                key={event.id}
                className="relative overflow-hidden rounded-2xl p-3 flex items-center gap-3"
                style={{ backgroundColor: CARD_BG, color: CARD_TEXT }}
              >
                <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden">
                  {event.cover_image_url ? (
                    <img src={event.cover_image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: hexToRgba(accent, 0.18) }}>
                      <Ticket size={20} style={{ color: accent }} />
                    </div>
                  )}
                  {parts && (
                    <div
                      className="absolute top-0.5 left-0.5 rounded-md px-1 py-0.5 flex flex-col items-center leading-none"
                      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
                    >
                      <span className="text-[8px] font-semibold" style={{ color: accent }}>
                        {parts.month}
                      </span>
                      <span className="text-[11px] font-bold text-white">{parts.day}</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{event.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-xs" style={{ opacity: 0.65 }}>
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} />
                        {event.location}
                      </span>
                    )}
                    {event.event_time && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {event.event_time}
                      </span>
                    )}
                  </div>
                </div>

                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full transition hover:brightness-95 active:scale-95"
                    style={{ backgroundColor: accent, color: "#171009" }}
                  >
                    {t.music.getTicket}
                  </a>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
