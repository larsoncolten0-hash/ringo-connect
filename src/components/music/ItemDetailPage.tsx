"use client";

import Link from "next/link";
import { ArrowLeft, Play, Pause, ShoppingBag, ShoppingCart, Ticket, MapPin, Clock, Lock, ExternalLink, Check, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import ImageGallery from "@/components/ImageGallery";
import WhatsAppButton from "@/components/WhatsAppButton";
import ShareButton from "@/components/ShareButton";
import { sortedTicketTypes, isTicketTypeOnSale, isSoldOut, remainingForTicketType, LOW_INVENTORY_THRESHOLD } from "@/lib/ticketTypes";
import { useTrackPlayback } from "./useTrackPlayback";

// The "more about it before you buy" page a fan lands on from the public
// profile's song/EP/album/merch/ticket cards — see the route at
// src/app/m/[username]/[type]/[id]/page.tsx for why one component covers
// all four kinds instead of four near-identical pages. Matches
// MusicStorePage's own plain white styling (not the creator's themed
// profile) since this is part of the same commerce surface, one step
// before it.
//
// Never adds to the cart itself — every "Buy"/"Get Ticket" CTA here either
// opens the creator's own external link (landing_url/ticket_url), or hands
// off to the real storefront via `?add=<type>:<id>`, which MusicStorePage
// reads on mount to add the line and open checkout. Keeping the cart/
// checkout state in exactly one component avoids losing it across this
// extra page.
export default function ItemDetailPage({
  profile,
  type,
  item,
}: {
  profile: any;
  type: "track" | "release" | "merch" | "ticket";
  item: any;
}) {
  const { t, locale } = useLanguage();
  const accent = profile.theme_color || "#F2B705";
  const currency = profile.currency || "USD";
  const username = profile.username;
  const { playingId, togglePlay } = useTrackPlayback();

  const cleanNumber = (profile.whatsapp_number || "").replace(/[^0-9]/g, "");
  const itemTitle = type === "merch" ? item.name : item.title;

  return (
    <div className="min-h-screen bg-white pb-16" style={{ color: "#14202B" }}>
      <div className="sticky top-0 z-20 bg-white border-b flex items-center gap-3 px-4 py-3" style={{ borderColor: "#E5E7EB" }}>
        <Link href={`/${username}`} className="shrink-0" aria-label={t.music.backToProfile}>
          <ArrowLeft size={19} />
        </Link>
        <p className="text-sm font-semibold flex-1 truncate">{profile.name || profile.username}</p>
        {/* Copy link / share this exact song, EP/album, merch item, or
            ticket — the URL is already this page's own, real, shareable
            route (see the route file's comment), this just makes copying
            it discoverable instead of relying on the browser's own address
            bar. Same component the whole-profile ShareButton uses. */}
        <ShareButton
          accent={accent}
          title={itemTitle}
          strings={{
            share: t.profilePage.share,
            copyLink: t.profilePage.copyLink,
            linkCopied: t.profilePage.linkCopied,
            shareWhatsapp: t.profilePage.shareWhatsapp,
            shareFacebook: t.profilePage.shareFacebook,
            shareX: t.profilePage.shareX,
            moreOptions: t.profilePage.moreOptions,
            showQrCode: t.profilePage.showQrCode,
            qrCodeTitle: t.profilePage.qrCodeTitle,
            qrCodeSubtitle: t.music.detailQrSubtitle,
            qrCodeError: t.profilePage.qrCodeError,
            downloadQrCode: t.profilePage.downloadQrCode,
            close: t.profilePage.close,
          }}
        />
      </div>

      <div className="max-w-md mx-auto px-4 py-5">
        {type === "track" && <TrackDetail item={item} accent={accent} currency={currency} locale={locale} username={username} t={t} playingId={playingId} togglePlay={togglePlay} whatsappNumber={cleanNumber} />}
        {type === "release" && <ReleaseDetail item={item} tracks={profile.tracks || []} accent={accent} currency={currency} locale={locale} username={username} t={t} playingId={playingId} togglePlay={togglePlay} />}
        {type === "merch" && <MerchDetail item={item} accent={accent} currency={currency} locale={locale} username={username} t={t} whatsappNumber={cleanNumber} />}
        {type === "ticket" && <TicketDetail item={item} accent={accent} currency={currency} locale={locale} username={username} t={t} whatsappNumber={cleanNumber} />}
      </div>
    </div>
  );
}

function CoverImage({ src, icon: Icon, accent }: { src?: string | null; icon: any; accent: string }) {
  return src ? (
    <img src={src} alt="" className="w-full aspect-square rounded-2xl object-cover" />
  ) : (
    <div className="w-full aspect-square rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#F3F4F6" }}>
      <Icon size={40} style={{ color: accent }} />
    </div>
  );
}

function TrackDetail({ item, accent, currency, locale, username, t, playingId, togglePlay, whatsappNumber }: any) {
  const isProtected = !!item.protected_audio_path;
  const isPlaying = playingId === item.id;
  const hasPlayable = isProtected ? item.preview_audio_url : item.audio_url;

  return (
    <div className="flex flex-col gap-4">
      <CoverImage src={item.cover_image_url} icon={ShoppingBag} accent={accent} />
      <div>
        <p className="font-display text-xl font-bold">{item.title}</p>
        <p className="text-sm mt-0.5 flex items-center gap-1.5" style={{ opacity: 0.6 }}>
          {[item.artist_name, item.duration].filter(Boolean).join(" · ")}
          {isProtected && (
            <span className="inline-flex items-center gap-0.5 shrink-0">
              <Lock size={9} />
              {t.music.previewButtonLabel}
            </span>
          )}
        </p>
        {item.genre && (
          <span className="inline-block mt-2 text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F3F4F6" }}>
            {t.music.detailGenreLabel}: {item.genre}
          </span>
        )}
      </div>

      {hasPlayable && (
        <button
          onClick={() => togglePlay(item)}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="w-14 h-14 rounded-full flex items-center justify-center self-center transition active:scale-90 shadow-md"
          style={{ backgroundColor: accent, color: "#fff" }}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
      )}

      {item.price ? (
        <Link
          href={`/m/${username}?add=song:${item.id}`}
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ShoppingCart size={15} />
          {t.music.buySong} · <span suppressHydrationWarning>{formatPrice(item.price, currency, locale)}</span>
        </Link>
      ) : item.buy_url ? (
        <a
          href={item.buy_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ExternalLink size={15} />
          {t.music.buyNowLabel}
        </a>
      ) : whatsappNumber ? (
        <WhatsAppButton
          number={whatsappNumber}
          message={item.whatsapp_message || t.music.buyTrackWhatsappMessage(item.title)}
          radiusClass="rounded-full"
        />
      ) : (
        <p className="text-sm text-center py-2" style={{ opacity: 0.5 }}>
          {t.music.detailNotForSale}
        </p>
      )}
    </div>
  );
}

function ReleaseDetail({ item, tracks, accent, currency, locale, username, t, playingId, togglePlay }: any) {
  const releaseTracks = tracks
    .filter((tr: any) => tr.release_id === item.id && tr.available !== false)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  return (
    <div className="flex flex-col gap-4">
      <CoverImage src={item.cover_image_url} icon={ShoppingBag} accent={accent} />
      <div>
        <p className="font-display text-xl font-bold">{item.title || t.music.untitledRelease}</p>
        <p className="text-sm mt-0.5 uppercase tracking-wide" style={{ opacity: 0.6 }}>
          {item.release_type === "album" ? t.music.releaseTypeAlbum : t.music.releaseTypeEp}
          {" · "}
          {releaseTracks.length} {t.music.tracksCount}
        </p>
      </div>

      {item.description && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ opacity: 0.5 }}>
            {t.music.detailAboutHeading}
          </p>
          <p className="text-sm" style={{ opacity: 0.8 }}>{item.description}</p>
        </div>
      )}

      {releaseTracks.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ opacity: 0.5 }}>
            {t.music.detailTracklistHeading}
          </p>
          <div className="flex flex-col">
            {releaseTracks.map((tr: any, i: number) => {
              const isProtected = !!tr.protected_audio_path;
              const isPlaying = playingId === tr.id;
              const hasPlayable = isProtected ? tr.preview_audio_url : tr.audio_url;
              return (
                <div key={tr.id} className="flex items-center gap-3 py-2.5 border-b" style={{ borderColor: "#E5E7EB" }}>
                  <span className="w-5 text-xs text-center shrink-0" style={{ opacity: 0.5 }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tr.title}</p>
                    {tr.duration && <p className="text-xs" style={{ opacity: 0.5 }}>{tr.duration}</p>}
                  </div>
                  {hasPlayable && (
                    <button
                      onClick={() => togglePlay(tr)}
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center border"
                      style={{ borderColor: "#E5E7EB", color: accent }}
                    >
                      {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {item.price ? (
        <Link
          href={`/m/${username}?add=release:${item.id}`}
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ShoppingCart size={15} />
          {item.release_type === "album" ? t.music.buyAlbum : t.music.buyEp} ·{" "}
          <span suppressHydrationWarning>{formatPrice(item.price, currency, locale)}</span>
        </Link>
      ) : (
        <p className="text-sm text-center py-2" style={{ opacity: 0.5 }}>
          {t.music.detailNotForSale}
        </p>
      )}
    </div>
  );
}

function MerchDetail({ item, accent, currency, locale, username, t, whatsappNumber }: any) {
  const soldOut = item.inventory_count === 0;

  return (
    <div className="flex flex-col gap-4">
      {item.image_urls?.length || item.image_url ? (
        <ImageGallery
          images={item.image_urls?.length ? item.image_urls : [item.image_url]}
          alt={item.name}
          className="w-full aspect-square rounded-2xl"
          imgClassName="object-cover"
        />
      ) : (
        <CoverImage src={null} icon={ShoppingBag} accent={accent} />
      )}

      <div>
        <p className="font-display text-xl font-bold">{item.name}</p>
        {item.price != null && (
          <p className="text-lg font-bold mt-0.5" style={{ color: accent }} suppressHydrationWarning>
            {formatPrice(item.price, currency, locale)}
          </p>
        )}
      </div>

      {item.description && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ opacity: 0.5 }}>
            {t.music.detailAboutHeading}
          </p>
          <p className="text-sm" style={{ opacity: 0.8 }}>{item.description}</p>
        </div>
      )}

      {soldOut ? (
        <p className="text-sm text-center py-3 font-semibold rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
          {t.music.soldOut}
        </p>
      ) : item.landing_url ? (
        <a
          href={item.landing_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ExternalLink size={15} />
          {t.music.buyNowLabel}
        </a>
      ) : (
        <Link
          href={`/m/${username}?add=merch:${item.id}`}
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ShoppingCart size={15} />
          {t.music.shopMerch}
        </Link>
      )}

      {whatsappNumber && (
        <WhatsAppButton
          number={whatsappNumber}
          message={item.whatsapp_message || `Hi, I'm interested in ${item.name}`}
          radiusClass="rounded-full"
          buttonStyle={{ border: "1px solid #E5E7EB" }}
        />
      )}
    </div>
  );
}

function TicketDetail({ item, accent, currency, locale, username, t, whatsappNumber }: any) {
  const ticketTypes = sortedTicketTypes(item.event_ticket_types);
  const hasTicketTypes = ticketTypes.length > 0;

  const eventClosed = item.status === "cancelled" || item.status === "completed";

  return (
    <div className="flex flex-col gap-4">
      <CoverImage src={item.cover_image_url} icon={Ticket} accent={accent} />
      <div>
        <p className="font-display text-xl font-bold">{item.title}</p>
        <div className="flex flex-col gap-1 mt-2 text-sm" style={{ opacity: 0.7 }}>
          {item.location && (
            <span className="flex items-center gap-1.5">
              <MapPin size={13} /> {item.location}
            </span>
          )}
          {(item.event_date || item.event_time) && (
            <span className="flex items-center gap-1.5">
              <Clock size={13} /> {[item.event_date, item.event_time].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>

      {item.status === "cancelled" && (
        <p className="text-sm text-center py-2.5 rounded-full font-semibold" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>
          {t.music.eventCancelledNotice}
        </p>
      )}
      {item.status === "completed" && (
        <p className="text-sm text-center py-2.5 rounded-full font-semibold" style={{ backgroundColor: "#F3F4F6", opacity: 0.7 }}>
          {t.music.eventCompletedNotice}
        </p>
      )}

      {hasTicketTypes ? (
        <TicketTypeSelector
          eventId={item.id}
          ticketTypes={ticketTypes}
          accent={accent}
          currency={currency}
          locale={locale}
          username={username}
          t={t}
          disabled={eventClosed}
        />
      ) : (
        <LegacyTicketCta item={item} accent={accent} currency={currency} locale={locale} username={username} t={t} whatsappNumber={whatsappNumber} disabled={eventClosed} />
      )}
    </div>
  );
}

// The "Choose your ticket" list — every active tier the artist has
// configured, each independently on-sale/sold-out/not-yet-open, in the
// artist's own chosen order (never auto-sorted by price). "Select" hands
// off to the real storefront (?add=ticket:<eventId>:<ticketTypeId>),
// which is what actually adds it to the cart and opens checkout — this
// page never touches the cart itself.
function TicketTypeSelector({ eventId, ticketTypes, accent, currency, locale, username, t, disabled }: any) {
  const active = ticketTypes.filter((tt: any) => tt.is_active !== false);

  if (active.length === 0) {
    return (
      <p className="text-sm text-center py-2" style={{ opacity: 0.5 }}>
        {t.music.detailNotForSale}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-bold">{t.music.chooseYourTicket}</p>
      {active.map((tt: any) => {
        const remaining = remainingForTicketType(tt);
        const soldOut = isSoldOut(tt);
        const notYetOpen = tt.sales_start_at && new Date(tt.sales_start_at) > new Date();
        const closed = tt.sales_end_at && new Date(tt.sales_end_at) < new Date();
        const onSale = isTicketTypeOnSale(tt) && !disabled;
        const lowStock = !soldOut && remaining !== null && remaining <= LOW_INVENTORY_THRESHOLD;

        return (
          <div
            key={tt.id}
            className="rounded-2xl p-4 flex flex-col gap-2"
            style={{ border: tt.is_primary ? `2px solid ${accent}` : "1px solid #E5E7EB", opacity: soldOut || notYetOpen || closed || disabled ? 0.7 : 1 }}
          >
            {tt.is_primary && (
              <span
                className="self-start flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                <Sparkles size={10} />
                {t.music.mostPopularBadge}
              </span>
            )}

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold">{tt.name}</p>
                {tt.description && (
                  <p className="text-xs mt-0.5" style={{ opacity: 0.6 }}>
                    {tt.description}
                  </p>
                )}
              </div>
              <p className="text-base font-bold shrink-0" style={{ color: accent }} suppressHydrationWarning>
                {formatPrice(tt.price, currency, locale)}
              </p>
            </div>

            {tt.benefits?.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs" style={{ opacity: 0.8 }}>
                {tt.benefits.map((b: string, i: number) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <Check size={12} style={{ color: accent }} className="shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {lowStock && (
              <p className="text-[11px] font-medium" style={{ color: "#D97706" }}>
                {t.music.detailTicketsRemaining(remaining as number)}
              </p>
            )}

            {soldOut ? (
              <span className="text-center text-xs font-semibold py-2.5 rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
                {t.music.soldOut}
              </span>
            ) : notYetOpen ? (
              <span className="text-center text-xs font-semibold py-2.5 rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
                {t.music.notYetOnSale}
              </span>
            ) : closed ? (
              <span className="text-center text-xs font-semibold py-2.5 rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
                {t.music.salesEnded}
              </span>
            ) : onSale ? (
              <Link
                href={`/m/${username}?add=ticket:${eventId}:${tt.id}`}
                className="text-center text-xs font-semibold py-2.5 rounded-full text-white"
                style={{ backgroundColor: accent }}
              >
                {t.music.selectTicketButton}
              </Link>
            ) : (
              <span className="text-center text-xs font-semibold py-2.5 rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
                {t.music.detailNotForSale}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The original single-price ticket CTA — unchanged behavior for an event
// that has no ticket types at all (see EventTicketTypesEditor.tsx; an
// event stays on this path until an artist actually adds a tier).
function LegacyTicketCta({ item, accent, currency, locale, username, t, whatsappNumber, disabled }: any) {
  const remaining = item.ticket_capacity != null ? item.ticket_capacity - (item.tickets_sold || 0) : null;
  const inHouseSoldOut = remaining !== null && remaining <= 0;
  const waHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(item.whatsapp_message || t.music.getTicketWhatsappMessage(item.title))}`
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {(item.ticket_type || remaining !== null) && (
        <div className="flex flex-wrap gap-2">
          {item.ticket_type && (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F3F4F6" }}>
              {t.music.detailTicketTypeLabel}: {item.ticket_type}
            </span>
          )}
          {remaining !== null && (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F3F4F6" }}>
              {t.music.detailTicketsRemaining(Math.max(remaining, 0))}
            </span>
          )}
        </div>
      )}

      {item.price != null && (
        <p className="text-lg font-bold" style={{ color: accent }} suppressHydrationWarning>
          {formatPrice(item.price, currency, locale)}
        </p>
      )}

      {disabled ? (
        <p className="text-sm text-center py-2" style={{ opacity: 0.5 }}>
          {t.music.detailNotForSale}
        </p>
      ) : item.ticket_url ? (
        <a
          href={item.ticket_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          <ExternalLink size={15} />
          {t.music.getTicketButton}
        </a>
      ) : item.price ? (
        inHouseSoldOut ? (
          <p className="text-sm text-center py-3 font-semibold rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.6 }}>
            {t.music.soldOut}
          </p>
        ) : (
          <Link
            href={`/m/${username}?add=ticket:${item.id}`}
            className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            <ShoppingCart size={15} />
            {t.music.getTicketButton}
          </Link>
        )
      ) : waHref ? (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          {t.music.getTicketButton}
        </a>
      ) : (
        <p className="text-sm text-center py-2" style={{ opacity: 0.5 }}>
          {t.music.detailNotForSale}
        </p>
      )}
    </div>
  );
}
