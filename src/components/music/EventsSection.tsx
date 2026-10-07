"use client";

import type { CSSProperties } from "react";
import { ArrowRight, Ticket, MapPin, Clock } from "lucide-react";
import Rail from "@/components/ui/Rail";
import { accentTextOn, hexToRgba, readableOn } from "@/lib/color";
import { MUSIC } from "@/lib/profileStage";
import { formatPrice } from "@/lib/currency";
import { primaryTicketType } from "@/lib/ticketTypes";
import type { Translations } from "@/lib/i18n/translations";
import { safeExternalUrl } from "@/lib/linkUrl";

// Same fixed near-black "player card" treatment as MusicSection — see the
// comment there. "Get Ticket"/"View Tickets" opens the event's own detail
// page (/m/[username]/ticket/[id]) instead of buying immediately — for an
// event with multiple ticket types (event_ticket_types), that page is the
// full "Choose your ticket" selector; for a legacy single-price event it
// resolves the same CTA priority (ticket_url, in-house checkout, or
// WhatsApp) this card used to apply directly. Only rendered when there's
// genuinely a way to get a ticket at all.
const CARD_BG = MUSIC.player!.background;
const CARD_TEXT = MUSIC.player!.text;

export default function EventsSection({
  t,
  events,
  accent,
  buttonStyle,
  whatsappNumber,
  username,
  currency,
  dateLead = false,
  locale,
  fadeColor,
}: {
  t: Translations;
  events: any[];
  accent: string;
  buttonStyle: CSSProperties;
  whatsappNumber?: string | null;
  username: string;
  currency: string;
  /** The date leads the card (an Events stage): a large day and month first, and the thumbnail only when the event has a picture. Off
   *  for Music, which keeps the small date stamp on the thumbnail. */
  dateLead?: boolean;
  /** The visitor's language, so the month on the date reads in it ("DÉC." in French) rather than in the browser's. */
  locale?: string;
  /** The flat surface colour behind this section, for the rail's edge fades (omit on a gradient background). */
  fadeColor?: string;
}) {
  if (events.length === 0) return null;
  // three or more events open as a rail; "View events" goes to the storefront (/m/[username]) that lists every event, rather than
  // turning the profile into a long wall of cards
  const asRail = events.length >= 3;
  const onAccent = readableOn(accent);

  const dateParts = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return { day: d.getDate(), month: d.toLocaleDateString(locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : undefined, { month: "short" }).replace(/\.$/, "").toUpperCase() };
  };

  return (
    <div id="events" className="flex flex-col gap-3 scroll-mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Ticket size={17} style={{ color: accent }} />
          {t.music.upcomingTitle}
        </h2>
        {events.length >= 3 && (
          <a
            href={`/m/${username}#tickets`}
            className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-current/25 px-3.5 text-xs font-semibold"
          >
            {t.music.viewEvents}
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      {(() => {
        const list = [...events]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((event) => {
            const parts = dateParts(event.event_date);
            const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
            const primary = primaryTicketType(event.event_ticket_types);
            // Same "is there any way to get a ticket at all" check the old
            // direct href used — just now routes to the detail page
            // instead of straight to the ticket_url/WhatsApp itself. A
            // multi-tier event always qualifies (the selector shows real
            // sold-out/not-yet-open state per tier rather than hiding the
            // whole card).
            const canGetTicket = !!primary || !!(safeExternalUrl(event.ticket_url) || event.price || cleanNumber);
            const href = canGetTicket ? `/m/${username}/ticket/${event.id}` : null;

            return (
              <div
                key={event.id}
                className={`relative overflow-hidden rounded-ringo-lg p-3 flex flex-wrap items-center gap-3 ${asRail ? "w-[80vw] max-w-[320px] sm:w-[320px]" : ""}`}
                style={{ backgroundColor: CARD_BG, color: CARD_TEXT }}
              >
                {/* Every event gets a detail page (see EventDetail's
                    branch in ItemDetailPage.tsx), so its cover art is
                    always clickable there — independent of whether the Get
                    Ticket CTA below is even shown. */}
                {dateLead && parts && (
                  // The date block is also the way into the event's page when there is no picture to tap (the thumbnail below is only
                  // drawn for events that have one), so no event loses its link.
                  <a
                    href={`/m/${username}/ticket/${event.id}`}
                    aria-label={event.title}
                    className="flex min-h-[44px] w-14 shrink-0 flex-col items-center justify-center self-stretch rounded-ringo-md py-1.5 leading-none"
                    style={{ backgroundColor: hexToRgba(accent, 0.14) }}
                  >
                    <time dateTime={event.event_date} className="flex flex-col items-center">
                      <span className="text-[11px] font-semibold tracking-wider" style={{ color: accentTextOn("#14110A", accent) }} suppressHydrationWarning>
                        {parts.month}
                      </span>
                      <span className="mt-1 font-display text-2xl font-bold">{parts.day}</span>
                    </time>
                  </a>
                )}
                {(!dateLead || event.cover_image_url) && (
                <a
                  href={`/m/${username}/ticket/${event.id}`}
                  aria-label={event.title}
                  className="relative w-16 h-16 shrink-0 rounded-ringo-md overflow-hidden block"
                >
                  {event.cover_image_url ? (
                    <img src={event.cover_image_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: hexToRgba(accent, 0.18) }}>
                      <Ticket size={20} style={{ color: accent }} />
                    </div>
                  )}
                  {parts && !dateLead && (
                    <div
                      className="absolute top-0.5 left-0.5 rounded-md px-1 py-0.5 flex flex-col items-center leading-none"
                      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
                    >
                      <span className="text-[10px] font-semibold" style={{ color: accent }}>
                        {parts.month}
                      </span>
                      <span className="text-xs font-bold text-white">{parts.day}</span>
                    </div>
                  )}
                </a>
                )}

                <div className="flex-1 min-w-[9rem]">
                  <p className="text-sm font-semibold line-clamp-2 [overflow-wrap:anywhere]">{event.title}</p>
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
                  {/* The artist's chosen Primary ticket type — see
                      EventTicketTypesEditor.tsx. Never assumes "cheapest";
                      whichever tier the artist picked is what shows here,
                      by name, so it updates the instant they change it. */}
                  {primary && (
                    <p className="text-xs font-semibold mt-1" style={{ color: accentTextOn("#14110A", accent) }} suppressHydrationWarning>
                      {primary.name} — {formatPrice(primary.price, currency)}
                    </p>
                  )}
                </div>

                {href && (
                  <a
                    href={href}
                    className="ringo-tactile shrink-0 ml-auto inline-flex items-center min-h-[44px] text-xs font-semibold px-3.5 py-2 rounded-full"
                    style={{ backgroundColor: accent, color: onAccent }}
                  >
                    {primary ? t.music.viewTicketsButton : t.music.getTicket}
                  </a>
                )}
              </div>
            );
          });
        return asRail ? (
          <Rail label={t.music.upcomingTitle} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade={fadeColor}>
            {list}
          </Rail>
        ) : (
          <div className="flex flex-col gap-3">{list}</div>
        );
      })()}
    </div>
  );
}
