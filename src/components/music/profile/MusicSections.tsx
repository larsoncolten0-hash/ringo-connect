"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Disc3, ExternalLink, Heart, MapPin, Music, Pause, Play, ShoppingBag, Ticket } from "lucide-react";
import Rail from "@/components/ui/Rail";
import EqualizerBars from "@/components/music/EqualizerBars";
import WhatsAppButton from "@/components/WhatsAppButton";
import { SUPPORT_PRESET_AMOUNTS } from "@/components/music/SupportArtistSection";
import { productHref, productImages } from "@/components/catalog/productHref";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { displayHref } from "@/lib/linkUrl";
import { publicLinkTitle } from "@/lib/publicContent";
import { MAX_PREVIEW_SECONDS } from "@/lib/previewLimit";
import { primaryTicketType } from "@/lib/ticketTypes";
import { eventDateParts, firstName, formatMusicPrice, trackActions, type TrackAction } from "@/lib/music/profileMusic";
import { DISPLAY, MICRO, MP } from "./musicTheme";

type Playback = { playingId: string | null; progress: number; togglePlay: (track: any) => void };
type ClickLogger = (targetType: "link" | "product" | "whatsapp", targetId?: string, content?: { name?: string; price?: number | null; currency?: string | null }) => void;

const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--mp-accent)]";

// ---------------------------------------------------------------------------------------------------------------- shared bits

export function SectionHead({ eyebrow, title, href, linkLabel, id }: { eyebrow: string; title: string; href?: string; linkLabel?: string; id: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={`${MICRO} text-[11px] uppercase tracking-[.14em]`} style={{ color: MP.muted }}>
          {eyebrow}
        </span>
        <h2 id={id} className={`${DISPLAY} text-[38px] font-extrabold`}>
          {title}
        </h2>
      </div>
      {href && linkLabel && (
        <Link href={href} className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 text-[13px] font-semibold ${RING}`} style={{ color: "var(--mp-accent)" }}>
          {linkLabel}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function Cover({ src, size, rounded = "rounded-[10px]", icon }: { src?: string | null; size: number; rounded?: string; icon?: ReactNode }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className={`block shrink-0 object-cover ${rounded}`} style={{ width: size, height: size }} />
  ) : (
    <span className={`flex shrink-0 items-center justify-center ${rounded}`} style={{ width: size, height: size, background: hexToRgba("#E8B04B", 0.12), color: "var(--mp-accent)" }} aria-hidden="true">
      {icon ?? <Music size={Math.round(size / 3)} />}
    </span>
  );
}

/** The round listen button: the 10-second preview (protected), a plain play of the artist's own free upload, or an outbound listen link. */
function ListenButton({ action, track, playing, onToggle, size = 44 }: { action: TrackAction; track: any; playing: boolean; onToggle: (track: any) => void; size?: number }) {
  const { t } = useLanguage();
  if (!action.listen) return null;
  const label = action.listen === "external" ? t.music.playLabel : playing ? t.music.pauseLabel : action.isProtected ? t.musicProfile.playPreview : t.music.playLabel;
  return (
    <button
      type="button"
      onClick={() => onToggle(track)}
      aria-label={`${label}: ${track.title}`}
      aria-pressed={action.listen === "external" ? undefined : playing}
      className={`ringo-tactile inline-flex shrink-0 items-center justify-center rounded-full transition active:scale-95 ${RING}`}
      style={{ width: size, height: size, background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}
    >
      {action.listen === "external" ? <ExternalLink size={16} aria-hidden="true" /> : playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} className="ml-0.5" aria-hidden="true" />}
    </button>
  );
}

/** Price + Buy. A priced song goes to its own page (the purchase, cart and payment live there); a price-less song keeps the artist's own link or WhatsApp. */
function BuyAction({ action, track, whatsappNumber, compact = false }: { action: TrackAction; track: any; whatsappNumber?: string | null; compact?: boolean }) {
  const { t } = useLanguage();
  if (!action.buy) return null;
  const pill = `ringo-tactile inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 text-[13px] font-bold transition active:scale-[.97] ${RING}`;
  const style = { borderColor: "var(--mp-accent)", color: "var(--mp-accent)" };
  const body = (
    <>
      {action.priceLabel && <span className={`${MICRO} text-[12.5px]`} suppressHydrationWarning>{action.priceLabel}</span>}
      <span>{t.musicProfile.buy}</span>
      {!compact && <ArrowUpRight size={14} aria-hidden="true" />}
    </>
  );
  if (action.buy.kind === "detail") return <Link href={action.buy.href} className={pill} style={style} aria-label={`${t.musicProfile.buy} ${track.title}${action.priceLabel ? `, ${action.priceLabel}` : ""}`}>{body}</Link>;
  if (action.buy.kind === "external")
    return (
      <a href={action.buy.href} target="_blank" rel="noopener noreferrer" className={pill} style={style} aria-label={`${t.musicProfile.buy} ${track.title}`}>
        {body}
      </a>
    );
  if (!whatsappNumber) return null;
  return (
    <WhatsAppButton
      number={whatsappNumber}
      message={track.whatsapp_message || t.music.buyTrackWhatsappMessage(track.title)}
      radiusClass="rounded-full"
      className="min-h-[44px] !px-3.5 !text-[13px] !font-bold"
      buttonStyle={{ backgroundColor: "transparent", color: "var(--mp-accent)", border: "1px solid var(--mp-accent)" }}
      iconColor="var(--mp-accent)"
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------- featured

export type FeaturedItem =
  | { kind: "track"; item: any; pinned: boolean }
  | { kind: "release"; item: any }
  | { kind: "product"; item: any }
  | { kind: "event"; item: any }
  | { kind: "support" };

export function FeaturedCard({ featured, username, currency, whatsappNumber, artistName, tracksOfRelease, playback }: {
  featured: FeaturedItem; username: string; currency: string; whatsappNumber?: string | null; artistName: string; tracksOfRelease: number; playback: Playback;
}) {
  const { t, locale } = useLanguage();
  const ctx = { username, currency, locale, hasWhatsapp: !!whatsappNumber };
  let image: string | null = null;
  let eyebrow = t.musicProfile.featuredEyebrow;
  let title = "";
  let meta = "";
  let href: string | null = null;
  let actions: ReactNode = null;

  if (featured.kind === "track") {
    const track = featured.item;
    const a = trackActions(track, ctx);
    image = track.cover_image_url || null;
    title = track.title;
    meta = [t.music.typeSingle, track.artist_name || artistName, track.duration].filter(Boolean).join(" · ");
    href = a.detailHref;
    actions = (
      <div className="flex flex-wrap items-center gap-3">
        <ListenButton action={a} track={track} playing={playback.playingId === track.id} onToggle={playback.togglePlay} size={48} />
        {a.listen === "preview" && <span className={`${MICRO} text-[12px]`} style={{ color: MP.muted }}>{t.musicProfile.preview(MAX_PREVIEW_SECONDS)}</span>}
        <BuyAction action={a} track={track} whatsappNumber={whatsappNumber} />
      </div>
    );
  } else if (featured.kind === "release") {
    const r = featured.item;
    image = r.cover_image_url || null;
    eyebrow = t.music.latestRelease;
    title = r.title || t.music.untitledRelease;
    meta = [r.release_type === "album" ? t.music.typeAlbum : t.music.typeEp, artistName, tracksOfRelease > 0 ? t.musicProfile.trackCount(tracksOfRelease) : ""].filter(Boolean).join(" · ");
    href = `/m/${username}/release/${r.id}`;
    const price = r.price && Number(r.price) > 0 ? formatMusicPrice(r.price, currency, locale) : "";
    actions = (
      <Link href={href} className={`ringo-tactile inline-flex min-h-[48px] items-center gap-2 self-start rounded-full px-5 text-[14px] font-bold ${RING}`} style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
        {price ? t.music.buyNowLabel : t.music.viewRelease}
        {price && <span className={MICRO} suppressHydrationWarning>{price}</span>}
      </Link>
    );
  } else if (featured.kind === "product") {
    const p = featured.item;
    image = productImages(p)[0] || null;
    title = p.name;
    meta = p.price ? formatMusicPrice(p.price, currency, locale) : "";
    href = productHref(username, p.id, true);
    actions = (
      <Link href={href} className={`ringo-tactile inline-flex min-h-[48px] items-center gap-2 self-start rounded-full px-5 text-[14px] font-bold ${RING}`} style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
        <ShoppingBag size={15} aria-hidden="true" />
        {t.music.buyLabel}
      </Link>
    );
  } else if (featured.kind === "event") {
    const e = featured.item;
    image = e.cover_image_url || null;
    title = e.title;
    meta = [e.location, e.event_time].filter(Boolean).join(" · ");
    href = `/m/${username}/ticket/${e.id}`;
    actions = (
      <Link href={href} className={`ringo-tactile inline-flex min-h-[48px] items-center gap-2 self-start rounded-full px-5 text-[14px] font-bold ${RING}`} style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
        <Ticket size={15} aria-hidden="true" />
        {primaryTicketType(e.event_ticket_types) ? t.music.viewTicketsButton : t.music.getTicket}
      </Link>
    );
  } else {
    title = t.music.supportTitle;
    meta = t.musicProfile.giftBody;
    href = "#gift";
    actions = (
      <a href="#gift" className={`ringo-tactile inline-flex min-h-[48px] items-center gap-2 self-start rounded-full px-5 text-[14px] font-bold ${RING}`} style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
        <Heart size={15} aria-hidden="true" />
        {t.music.pinnedSupportCta}
      </a>
    );
  }

  return (
    <section aria-label={eyebrow} className="px-5">
      <div className="overflow-hidden rounded-[22px] border" style={{ background: MP.surface, borderColor: MP.line }}>
        {href && (
          <Link href={href} className={`relative block aspect-square w-full overflow-hidden ${RING}`} aria-label={title} tabIndex={-1}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${hexToRgba("#E8B04B", 0.3)}, ${MP.surface})`, color: "var(--mp-accent)" }} aria-hidden="true">
                <Disc3 size={56} strokeWidth={1.3} />
              </span>
            )}
            <span aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 55%, ${MP.surface} 100%)` }} />
          </Link>
        )}
        <div className="flex flex-col gap-3 px-5 pb-5 pt-1">
          <span className={`${MICRO} text-[11px] uppercase tracking-[.14em]`} style={{ color: "var(--mp-accent)" }}>{eyebrow}</span>
          <h2 className={`${DISPLAY} text-[44px] font-extrabold [overflow-wrap:anywhere]`}>{title}</h2>
          {meta && <p className="text-[13.5px]" style={{ color: MP.muted }}>{meta}</p>}
          {actions}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- songs

export function SongList({ tracks, username, currency, whatsappNumber, artistName, playback, moreHref, totalCount }: {
  tracks: any[]; username: string; currency: string; whatsappNumber?: string | null; artistName: string; playback: Playback; moreHref: string; totalCount: number;
}) {
  const { t, locale } = useLanguage();
  const ctx = { username, currency, locale, hasWhatsapp: !!whatsappNumber };
  const anyPreview = tracks.some((tr) => trackActions(tr, ctx).isProtected);
  return (
    <section aria-labelledby="mp-songs" className="flex flex-col gap-1.5 px-5">
      <SectionHead id="mp-songs" eyebrow={t.musicProfile.songsEyebrow} title={t.musicProfile.songsHeading} href={totalCount > tracks.length ? moreHref : undefined} linkLabel={totalCount > tracks.length ? t.musicProfile.seeAll(totalCount) : undefined} />
      {anyPreview && <p className="mt-2 text-[12.5px]" style={{ color: MP.muted }}>{t.musicProfile.previewHint(MAX_PREVIEW_SECONDS)}</p>}
      <ol className="mt-2 flex flex-col">
        {tracks.map((track, index) => {
          const a = trackActions(track, ctx);
          const playing = playback.playingId === track.id;
          const album = track.release_title || "";
          const meta = [track.artist_name && track.artist_name !== artistName ? track.artist_name : "", album, track.duration].filter(Boolean).join(" · ");
          return (
            <li key={track.id} className="border-b py-3" style={{ borderColor: MP.line }}>
              <div className="grid grid-cols-[22px_52px_minmax(0,1fr)] items-center gap-3">
                <span className="flex items-center justify-center" style={{ color: MP.muted }}>
                  {playing ? <EqualizerBars color="var(--mp-accent)" /> : <span className={`${MICRO} text-[13px]`}>{String(index + 1).padStart(2, "0")}</span>}
                </span>
                <Link href={a.detailHref} aria-label={track.title} tabIndex={-1} className={RING}>
                  <Cover src={track.cover_image_url} size={52} rounded="rounded-[8px]" />
                </Link>
                <div className="flex min-w-0 flex-col">
                  <Link href={a.detailHref} className={`truncate text-[15.5px] font-semibold ${RING}`} style={{ color: playing ? "var(--mp-accent)" : MP.fg }}>
                    {track.title}
                  </Link>
                  {meta && <span className="truncate text-[12.5px]" style={{ color: MP.muted }}>{meta}</span>}
                </div>
              </div>
              {(a.listen || a.buy) && (
                <div className="ml-[34px] mt-2.5 flex flex-wrap items-center gap-2.5">
                  {a.listen && (
                    <button
                      type="button"
                      onClick={() => playback.togglePlay(track)}
                      aria-pressed={a.listen === "external" ? undefined : playing}
                      aria-label={`${playing ? t.music.pauseLabel : a.isProtected ? t.musicProfile.playPreview : t.music.playLabel}: ${track.title}`}
                      className={`ringo-tactile inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition active:scale-[.97] ${RING}`}
                      style={{ borderColor: MP.lineStrong, background: playing ? hexToRgba("#E8B04B", 0.12) : "transparent", color: MP.fg }}
                    >
                      {a.listen === "external" ? <ExternalLink size={14} aria-hidden="true" /> : playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      <span className={a.isProtected ? MICRO : ""}>{a.isProtected ? t.musicProfile.preview(MAX_PREVIEW_SECONDS) : playing ? t.music.pauseLabel : t.musicProfile.playFull}</span>
                    </button>
                  )}
                  <span className="ml-auto" />
                  <BuyAction action={a} track={track} whatsappNumber={whatsappNumber} compact />
                </div>
              )}
              {playing && (
                <div className="ml-[34px] mt-2 h-1 overflow-hidden rounded-full" style={{ background: "rgba(243,233,220,.12)" }} role="progressbar" aria-label={t.musicProfile.nowPlaying} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(playback.progress * 100)}>
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.round(playback.progress * 100)}%`, background: "var(--mp-accent)" }} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- releases

export function ReleasesRail({ releases, username, currency, trackCounts, storeHref }: { releases: any[]; username: string; currency: string; trackCounts: Record<string, number>; storeHref: string }) {
  const { t, locale } = useLanguage();
  return (
    <section aria-labelledby="mp-releases" className="flex flex-col gap-4">
      <div className="px-5">
        <SectionHead id="mp-releases" eyebrow={t.musicProfile.releasesEyebrow} title={t.musicProfile.releasesHeading} href={storeHref} linkLabel={t.musicProfile.shopAll} />
      </div>
      <Rail label={t.musicProfile.releasesHeading} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade={MP.bg} className="px-5">
        {releases.map((r) => {
          const n = trackCounts[r.id] || 0;
          const price = r.price && Number(r.price) > 0 ? formatMusicPrice(r.price, currency, locale) : "";
          return (
            <Link key={r.id} href={`/m/${username}/release/${r.id}`} className={`flex w-[176px] shrink-0 flex-col gap-2.5 ${RING}`} style={{ color: MP.fg }}>
              <span className="relative block">
                {r.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.cover_image_url} alt="" width={176} height={176} loading="lazy" decoding="async" className="block h-[176px] w-[176px] rounded-[10px] object-cover" style={{ boxShadow: "0 18px 30px -18px rgba(0,0,0,.8)" }} />
                ) : (
                  <span className="flex h-[176px] w-[176px] items-center justify-center rounded-[10px]" style={{ background: hexToRgba("#E8B04B", 0.12), color: "var(--mp-accent)" }} aria-hidden="true"><Disc3 size={34} /></span>
                )}
                <span className={`${MICRO} absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] tracking-[.12em]`} style={{ background: "rgba(18,11,16,.78)", color: MP.fg }}>
                  {(r.release_type === "album" ? t.music.typeAlbum : t.music.typeEp).toUpperCase()}
                </span>
              </span>
              <span className="flex flex-col">
                <span className="truncate text-[15px] font-semibold">{r.title || t.music.untitledRelease}</span>
                <span className={`${MICRO} truncate text-[11.5px]`} style={{ color: MP.muted }}>
                  {[n > 0 ? t.musicProfile.trackCount(n) : "", price].filter(Boolean).join(" · ")}
                </span>
              </span>
            </Link>
          );
        })}
      </Rail>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- events

export function TicketStubs({ events, username, currency, whatsappNumber, moreHref, totalCount }: { events: any[]; username: string; currency: string; whatsappNumber?: string | null; moreHref: string; totalCount: number }) {
  const { t, locale } = useLanguage();
  const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
  return (
    <section aria-labelledby="mp-events" className="flex flex-col gap-4 px-5">
      <SectionHead id="mp-events" eyebrow={t.musicProfile.eventsEyebrow} title={t.musicProfile.eventsHeading} href={totalCount > events.length ? moreHref : undefined} linkLabel={totalCount > events.length ? t.music.viewEvents : undefined} />
      <ul className="flex flex-col gap-3.5">
        {events.map((event) => {
          const parts = eventDateParts(event.event_date, locale);
          const primary = primaryTicketType(event.event_ticket_types);
          const dead = event.status === "cancelled" || event.status === "completed";
          const canGetTicket = !dead && (!!primary || !!(event.ticket_url || event.price || cleanNumber));
          const priceLabel = primary ? formatMusicPrice(primary.price, currency, locale) : event.price ? formatMusicPrice(event.price, currency, locale) : "";
          const detail = `/m/${username}/ticket/${event.id}`;
          return (
            <li key={event.id} className="relative grid grid-cols-[76px_minmax(0,1fr)] rounded-[14px]" style={{ background: MP.cream, color: MP.ink, opacity: dead ? 0.6 : 1 }}>
              <span aria-hidden="true" className="absolute -top-2 h-4 w-4 rounded-full" style={{ left: 69, background: MP.bg }} />
              <span aria-hidden="true" className="absolute -bottom-2 h-4 w-4 rounded-full" style={{ left: 69, background: MP.bg }} />
              <Link href={detail} aria-label={event.title} tabIndex={-1} className="flex flex-col items-center justify-center gap-0.5 border-r-2 border-dashed py-3.5" style={{ borderColor: "rgba(26,15,10,.25)" }}>
                {parts ? (
                  <time dateTime={event.event_date} className="flex flex-col items-center" suppressHydrationWarning>
                    <span className={`${MICRO} text-[11px] tracking-[.14em]`}>{parts.month}</span>
                    <span className={`${DISPLAY} text-[40px] font-black`}>{parts.day}</span>
                  </time>
                ) : (
                  <Ticket size={22} aria-hidden="true" />
                )}
              </Link>
              <div className="flex min-w-0 flex-col gap-2 py-3.5 pl-[18px] pr-3.5">
                <div className="flex min-w-0 flex-col">
                  <Link href={detail} className={`text-[16px] font-bold leading-tight [overflow-wrap:anywhere] ${RING}`}>{event.title}</Link>
                  {(event.location || event.event_time) && (
                    <span className="flex flex-wrap items-center gap-x-2 text-[13px]" style={{ opacity: 0.72 }}>
                      {event.location && <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{event.location}</span>}
                      {event.event_time && <span>{event.event_time}</span>}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`${MICRO} text-[12px]`} suppressHydrationWarning>
                    {dead ? (event.status === "cancelled" ? t.musicProfile.statusCancelled : t.musicProfile.statusPast) : priceLabel}
                  </span>
                  {canGetTicket && (
                    <Link href={detail} className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-[13px] font-bold ${RING}`} style={{ background: MP.ink, color: MP.cream }}>
                      {primary ? t.music.viewTicketsButton : t.music.getTicket}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- merch

export function MerchGrid({ products, username, currency, storeHref, totalCount, logClick }: { products: any[]; username: string; currency: string; storeHref: string; totalCount: number; logClick: ClickLogger }) {
  const { t, locale } = useLanguage();
  return (
    <section aria-labelledby="mp-merch" className="flex flex-col gap-4 px-5">
      <SectionHead id="mp-merch" eyebrow={t.musicProfile.merchEyebrow} title={t.musicProfile.merchHeading} href={totalCount > products.length ? storeHref : undefined} linkLabel={totalCount > products.length ? t.musicProfile.shopAll : undefined} />
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
        {products.map((p) => {
          const img = productImages(p)[0];
          const soldOut = p.inventory_count === 0;
          return (
            <li key={p.id}>
              <Link
                href={productHref(username, p.id, true)}
                onClick={() => logClick("product", p.id, { name: p.name, price: p.price ? Number(p.price) : null, currency })}
                className={`flex flex-col gap-2 ${RING}`}
                style={{ color: MP.fg }}
              >
                <span className="relative block aspect-square w-full overflow-hidden rounded-[14px]" style={{ background: MP.surface }}>
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center" style={{ color: "var(--mp-accent)" }} aria-hidden="true"><ShoppingBag size={28} /></span>
                  )}
                  {soldOut && <span className={`${MICRO} absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] tracking-[.1em]`} style={{ background: "rgba(18,11,16,.82)" }}>{t.music.soldOut.toUpperCase()}</span>}
                </span>
                <span className="flex flex-col">
                  <span className="truncate text-[14px] font-semibold">{p.name}</span>
                  {p.price ? <span className={`${MICRO} text-[12.5px]`} style={{ color: "var(--mp-accent)" }} suppressHydrationWarning>{formatMusicPrice(p.price, currency, locale)}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- links

export function LinkRows({ links, name, logClick }: { links: any[]; name: string; logClick: ClickLogger }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="mp-links" className="flex flex-col gap-3.5 px-5">
      <SectionHead id="mp-links" eyebrow={t.musicProfile.linksEyebrow} title={t.musicProfile.linksHeading(firstName(name) || name)} />
      <ul className="flex flex-col gap-2.5">
        {links.map((link) => {
          const host = (() => {
            try {
              return new URL(displayHref(link.url)).hostname.replace(/^www\./, "");
            } catch {
              return "";
            }
          })();
          return (
            <li key={link.id}>
              <a
                href={displayHref(link.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => logClick("link", link.id, { name: link.title })}
                className={`grid min-h-[64px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-2xl border py-2.5 pl-3 pr-3.5 ${RING}`}
                style={{ background: MP.surface, borderColor: MP.line, color: MP.fg }}
                aria-label={`${publicLinkTitle(link)} (${t.musicProfile.openLink})`}
              >
                {link.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={link.image_url} alt="" loading="lazy" decoding="async" width={44} height={44} className="h-11 w-11 rounded-[10px] object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-[12px]" style={{ background: hexToRgba("#E8B04B", 0.12), color: "var(--mp-accent)" }} aria-hidden="true"><ArrowUpRight size={18} /></span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-semibold">{publicLinkTitle(link)}</span>
                  <span className="truncate text-[12.5px]" style={{ color: MP.muted }}>{link.description || host}</span>
                </span>
                <ArrowUpRight size={18} aria-hidden="true" style={{ color: MP.muted }} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- gift the artist

export function GiftCard({ name, username, message }: { name: string; username: string; message?: string | null }) {
  const { t, locale } = useLanguage();
  const [amount, setAmount] = useState<number | "custom">(SUPPORT_PRESET_AMOUNTS[1]);
  const [custom, setCustom] = useState("");
  const final = amount === "custom" ? Number(custom) || 0 : amount;
  const can = final > 0;
  const chip = () => `${MICRO} ringo-tactile inline-flex min-h-[44px] items-center rounded-full border-[1.5px] px-4 text-[13px] font-medium transition ${RING}`;
  return (
    <section id="gift" aria-labelledby="mp-gift" className="scroll-mt-6 px-5">
      <div className="relative flex flex-col gap-4 overflow-hidden rounded-[22px] px-5 pb-5 pt-6" style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
        <svg viewBox="0 0 200 200" aria-hidden="true" className="pointer-events-none absolute -right-11 -top-11 h-[190px] w-[190px] opacity-20">
          <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="100" cy="100" r="74" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="100" cy="100" r="16" fill="currentColor" />
        </svg>
        <span className={`${MICRO} text-[11px] uppercase tracking-[.14em]`}>{t.musicProfile.giftEyebrow}</span>
        <h2 id="mp-gift" className={`${DISPLAY} max-w-[10ch] text-[46px] font-extrabold [overflow-wrap:anywhere]`}>{t.musicProfile.giftHeading(firstName(name) || name)}</h2>
        <p className="max-w-[34ch] text-[14.5px]">{message || t.musicProfile.giftBody}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.music.supportTitle}>
          {SUPPORT_PRESET_AMOUNTS.map((preset) => (
            <button key={preset} type="button" onClick={() => setAmount(preset)} aria-pressed={amount === preset} className={chip()} style={{ borderColor: "currentColor", background: amount === preset ? "var(--mp-on-accent)" : "transparent", color: amount === preset ? "var(--mp-accent)" : "inherit" }} suppressHydrationWarning>
              {formatMusicPrice(preset, "XAF", locale)}
            </button>
          ))}
          <button type="button" onClick={() => setAmount("custom")} aria-pressed={amount === "custom"} className={chip()} style={{ borderColor: "currentColor", background: amount === "custom" ? "var(--mp-on-accent)" : "transparent", color: amount === "custom" ? "var(--mp-accent)" : "inherit" }}>
            {t.music.customAmountLabel}
          </button>
        </div>
        {amount === "custom" && (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={t.music.customAmountPlaceholder}
            aria-label={t.music.customAmountLabel}
            inputMode="numeric"
            className={`${MICRO} min-h-[44px] rounded-xl border-[1.5px] bg-transparent px-3.5 text-[14px] placeholder:opacity-60 ${RING}`}
            style={{ borderColor: "currentColor" }}
          />
        )}
        <Link
          href={can ? `/m/${username}?support=${final}` : "#gift"}
          aria-disabled={!can}
          onClick={(e) => { if (!can) e.preventDefault(); }}
          className={`ringo-tactile inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-5 text-[15px] font-bold ${can ? "" : "pointer-events-none opacity-40"} ${RING}`}
          style={{ background: MP.ink, color: MP.cream }}
        >
          <Heart size={16} aria-hidden="true" />
          <span suppressHydrationWarning>{can ? t.musicProfile.giftSend(formatMusicPrice(final, "XAF", locale)) : t.music.sendSupportButton}</span>
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- about

export function AboutBlock({ name, avatar, longBio, facts }: { name: string; avatar?: string | null; longBio?: string | null; facts: { label: string; value: string; href?: string }[] }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="mp-about" className="flex flex-col gap-4 px-5">
      <SectionHead id="mp-about" eyebrow={t.musicProfile.aboutEyebrow} title={t.musicProfile.aboutHeading} />
      {(longBio || avatar) && (
        <div className={`grid items-start gap-4 ${avatar && longBio ? "grid-cols-[112px_minmax(0,1fr)]" : "grid-cols-1"}`}>
          {avatar && longBio && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt={name} loading="lazy" decoding="async" width={112} height={140} className="h-[140px] w-[112px] rounded-[12px] object-cover" />
          )}
          {longBio && <p className="whitespace-pre-line text-[14.5px] leading-[1.6]" style={{ color: "#E6D9CA" }}>{longBio}</p>}
        </div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[14px]">
          {facts.map((f) => (
            <div key={`${f.label}-${f.value}`} className="col-span-2 grid grid-cols-subgrid items-center">
              <dt className={`${MICRO} text-[11px] uppercase tracking-[.14em]`} style={{ color: MP.muted }}>{f.label}</dt>
              <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">
                {f.href ? <a href={f.href} className={`inline-flex min-h-[44px] items-center ${RING}`} style={{ color: "var(--mp-accent)" }}>{f.value}</a> : f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- mini player

/** Appears only while a song is playing: the real playback position of the real (10-second) preview, a pause control and the way to buy. Never autoplays. */
export function MiniPlayer({ tracks, username, currency, whatsappNumber, artistName, playback }: { tracks: any[]; username: string; currency: string; whatsappNumber?: string | null; artistName: string; playback: Playback }) {
  const { t, locale } = useLanguage();
  const track = tracks.find((x) => x.id === playback.playingId);
  if (!track) return null;
  const a = trackActions(track, { username, currency, locale, hasWhatsapp: !!whatsappNumber });
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2.5 pb-2.5">
      <div role="region" aria-label={t.musicProfile.nowPlaying} className="pointer-events-auto relative grid w-full max-w-[460px] grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-3 overflow-hidden rounded-2xl border p-2" style={{ background: "rgba(36,23,32,.97)", borderColor: "rgba(243,233,220,.1)", boxShadow: "0 16px 40px -10px rgba(0,0,0,.7)", color: MP.fg }}>
        <Link href={a.detailHref} tabIndex={-1} aria-hidden="true"><Cover src={track.cover_image_url} size={44} rounded="rounded-[8px]" /></Link>
        <Link href={a.detailHref} className={`flex min-w-0 flex-col ${RING}`}>
          <span className="truncate text-[14px] font-semibold">{track.title}</span>
          <span className="truncate text-[12px]" style={{ color: MP.muted }}>{track.artist_name || artistName}{a.isProtected ? ` · ${t.musicProfile.preview(MAX_PREVIEW_SECONDS)}` : ""}</span>
        </Link>
        {a.buy?.kind === "detail" ? (
          <Link href={a.buy.href} className={`${MICRO} inline-flex min-h-[44px] items-center rounded-full border px-3 text-[12.5px] font-bold ${RING}`} style={{ borderColor: "var(--mp-accent)", color: "var(--mp-accent)" }} aria-label={`${t.musicProfile.buy} ${track.title}${a.priceLabel ? `, ${a.priceLabel}` : ""}`} suppressHydrationWarning>
            {a.priceLabel ? `${a.priceLabel} · ` : ""}{t.musicProfile.buy}
          </Link>
        ) : <span />}
        <button type="button" onClick={() => playback.togglePlay(track)} aria-label={t.musicProfile.pauseNowPlaying} className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={{ background: MP.cream, color: MP.bg }}>
          <Pause size={18} aria-hidden="true" />
        </button>
        <span aria-hidden="true" className="absolute bottom-0 left-0 h-0.5" style={{ width: `${Math.round(playback.progress * 100)}%`, background: "var(--mp-accent)" }} />
      </div>
    </div>
  );
}

