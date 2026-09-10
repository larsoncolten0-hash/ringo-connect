"use client";

import type { CSSProperties } from "react";
import { Play, Pause, ExternalLink, ShoppingBag, Ticket, Sparkles, MapPin } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

// The one thing a fan sees first — replaces the old "Artist Hub" nav grid
// with a single big, visual pick the creator makes themselves (see
// PinnedSpotlightCard in the dashboard): their latest song, a merch item,
// or an upcoming show. Resolved from profile.tracks/products/events by
// pinned_id in ProfileView — if that item was since deleted, ProfileView
// just doesn't render this at all.
export default function PinnedSpotlight({
  t,
  type,
  item,
  artistName,
  accent,
  buttonStyle,
  currency,
  whatsappNumber,
  username,
  playingId,
  onTogglePlay,
}: {
  t: Translations;
  type: "track" | "product" | "event";
  item: any;
  artistName: string;
  accent: string;
  buttonStyle: CSSProperties;
  currency: string;
  whatsappNumber?: string | null;
  username: string;
  playingId: string | null;
  onTogglePlay: (track: any) => void;
}) {
  const cover = type === "product" ? item.image_url : item.cover_image_url;
  const title = type === "product" ? item.name : item.title;
  const isPlaying = type === "track" && playingId === item.id;
  // A pinned protected track can't be sold through the play button (that
  // only ever plays the short preview clip) — it gets its own small Buy
  // pill next to the play button, routing to the real storefront exactly
  // like the same track's entry in Latest Music does.
  const isProtectedTrack = type === "track" && !!item.protected_audio_path;

  const subtitle =
    type === "track"
      ? [item.artist_name || artistName, item.duration].filter(Boolean).join(" · ")
      : type === "product"
      ? item.price
        ? formatPrice(item.price, currency)
        : ""
      : [item.location, item.event_time].filter(Boolean).join(" · ");

  const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
  const ctaHref =
    type === "product"
      ? item.landing_url ||
        (cleanNumber ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(`Hi, I'm interested in ${item.name}`)}` : undefined)
      : type === "event"
      ? item.ticket_url ||
        (cleanNumber
          ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(item.whatsapp_message || t.music.getTicketWhatsappMessage(item.title))}`
          : undefined)
      : undefined; // track's CTA is the play button, handled separately

  const ctaLabel = type === "product" ? t.music.buyLabel : type === "event" ? t.music.getTicket : null;
  const CtaIcon = type === "product" ? ShoppingBag : Ticket;

  return (
    <div
      className="relative w-full overflow-hidden rounded-[28px] animate-fade-up"
      style={{ animationDelay: "320ms" }}
    >
      <div className="relative aspect-[4/3] sm:aspect-[16/10] w-full">
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${hexToRgba(accent, 0.5)}, rgba(0,0,0,0.6))` }}
          />
        )}
        {/* Legibility gradient — content sits in the bottom 2/3, so the
            image itself carries most of the visual weight (spec: "let the
            artwork provide most of the personality") while the text stays
            readable regardless of what the photo looks like. */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 5%, rgba(0,0,0,0.15) 55%, transparent 75%)" }}
        />

        <span
          className="absolute top-3.5 left-3.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-full"
          style={{ backgroundColor: hexToRgba(accent, 0.9), color: "#fff" }}
        >
          <Sparkles size={11} />
          {t.music.spotlightBadge}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 flex items-end gap-3">
          <div className="flex-1 min-w-0 text-white">
            <p className="text-lg sm:text-xl font-display font-bold truncate drop-shadow-sm">{title}</p>
            {subtitle && (
              <p className="text-sm truncate flex items-center gap-1.5" style={{ opacity: 0.85 }}>
                {type === "event" && item.location && <MapPin size={12} className="shrink-0" />}
                {subtitle}
              </p>
            )}
          </div>

          {type === "track" ? (
            <div className="flex items-center gap-2 shrink-0">
              {isProtectedTrack && item.price && (
                <a
                  href={`/m/${username}`}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-full shadow-lg transition hover:brightness-95 active:scale-95"
                  style={buttonStyle}
                >
                  <ShoppingBag size={13} />
                  {formatPrice(item.price, currency)}
                </a>
              )}
              {(isProtectedTrack ? item.preview_audio_url : item.audio_url || item.external_url) && (
                <button
                  onClick={() => onTogglePlay(item)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                  className="w-12 h-12 rounded-full flex items-center justify-center transition active:scale-90 shadow-lg"
                  style={{ backgroundColor: accent, color: "#fff" }}
                >
                  {(isProtectedTrack ? item.preview_audio_url : item.audio_url) ? (
                    isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />
                  ) : (
                    <ExternalLink size={16} />
                  )}
                </button>
              )}
            </div>
          ) : ctaHref ? (
            <a
              href={ctaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg transition hover:brightness-95 active:scale-95"
              style={buttonStyle}
            >
              <CtaIcon size={13} />
              {ctaLabel}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
