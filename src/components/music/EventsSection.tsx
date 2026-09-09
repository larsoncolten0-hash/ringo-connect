"use client";

import type { CSSProperties } from "react";
import { MapPin, Clock } from "lucide-react";
import type { Translations } from "@/lib/i18n/translations";

// "Upcoming" — there's no in-house ticket purchasing system, so "Get
// Ticket" either opens the creator's own ticket link (whatever platform
// they already sell through) or, when they haven't set one, falls back to
// a WhatsApp message — the same pattern products already use when they
// have no landing_url.
export default function EventsSection({
  t,
  events,
  accent,
  buttonStyle,
  radiusClass,
  borderTint,
  whatsappNumber,
}: {
  t: Translations;
  events: any[];
  accent: string;
  buttonStyle: CSSProperties;
  radiusClass: string;
  borderTint: string;
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
      <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
        {t.music.upcomingTitle}
      </p>

      <div className="flex flex-col gap-2.5">
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
                className={`flex items-center gap-3 p-3 ${radiusClass}`}
                style={{ border: `1px solid ${borderTint}` }}
              >
                {parts ? (
                  <div
                    className="w-12 h-12 rounded-lg shrink-0 flex flex-col items-center justify-center"
                    style={{ backgroundColor: "rgba(127,127,127,0.12)" }}
                  >
                    <span className="text-[9px] font-medium tracking-wide" style={{ color: accent }}>
                      {parts.month}
                    </span>
                    <span className="text-base font-bold leading-none">{parts.day}</span>
                  </div>
                ) : event.cover_image_url ? (
                  <img src={event.cover_image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                ) : null}

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
                    className="shrink-0 text-xs font-medium px-3.5 py-2 rounded-full transition hover:brightness-95 active:scale-95"
                    style={buttonStyle}
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
