"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, Disc3, MapPin, ShoppingBag, Ticket } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getMusicRole, profileHasTicketing } from "@/lib/categories";
import { hexToRgba, readableOn } from "@/lib/color";
import { isPublicRelease, isPublicTrack, publicRows } from "@/lib/publicContent";
import { pickLatestRelease } from "@/lib/latestRelease";
import { primaryTicketType } from "@/lib/ticketTypes";
import { newEventId } from "@/lib/pixelClient";
import { eventDateParts, formatMusicPrice } from "@/lib/music/profileMusic";
import { productHref, productImages } from "@/components/catalog/productHref";
import { useTrackPlayback } from "@/components/music/useTrackPlayback";
import PoweredByRingo from "@/components/PoweredByRingo";
import { DISPLAY, MICRO, MP } from "./musicTheme";
import { display } from "./musicFont";
import { avatarRadius, normalizeAvatarShape } from "@/lib/avatarShape";
import { DestinationBar } from "./MusicNav";
import { FeaturedCard, MerchGrid, MiniPlayer, ReleasesRail, SongList, TicketStubs, type FeaturedItem } from "./MusicSections";
import OptImg from "@/components/ui/OptImg";

// The artist's Music, Merch and Tickets pages. One identity (the profile's plum-black ground, type, borders and the creator's accent), three destinations, each with its own
// character: Music is the editorial catalog, Merch the shop window, Tickets the night out. Everything is the artist's own data; nothing is invented, empty parts are hidden, and
// every purchase is a link into the item pages and the one storefront checkout that already exist (no cart, price rule or payment lives here).

export type DestinationKind = "music" | "merch" | "tickets";

const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--mp-accent)]";

function DestinationHeader({ kind, profile, title, eyebrow, count, art }: { kind: DestinationKind; profile: any; title: string; eyebrow: string; count: string; art?: string | null }) {
  const { locale } = useLanguage();
  const role = getMusicRole(profile.music_role);
  const name = profile.name || profile.username;
  const bg =
    kind === "music"
      ? `radial-gradient(90% 120% at 100% 0%, ${hexToRgba("#E8B04B", 0.0)}, transparent 60%), radial-gradient(80% 100% at 0% 0%, var(--mp-accent-soft), transparent 70%)`
      : kind === "merch"
        ? `repeating-linear-gradient(135deg, transparent 0 15px, rgba(243,233,220,.045) 15px 16px), radial-gradient(90% 90% at 100% 0%, var(--mp-accent-soft), transparent 65%)`
        : `radial-gradient(70% 120% at 0% 50%, var(--mp-accent-soft), transparent 70%), radial-gradient(60% 90% at 100% 100%, rgba(226,85,58,.14), transparent 70%)`;
  return (
    <header className="relative overflow-hidden px-5 pb-8 pt-6" style={{ background: bg }}>
      {kind === "music" && art && (
        // eslint-disable-next-line @next/next/no-img-element
        <OptImg src={art} aria-hidden="true" cssWidth={210} className="pointer-events-none absolute -right-10 -top-6 h-[210px] w-[210px] rotate-6 rounded-[18px] object-cover opacity-30" style={{ maskImage: "linear-gradient(225deg, #000 20%, transparent 78%)", WebkitMaskImage: "linear-gradient(225deg, #000 20%, transparent 78%)" }} />
      )}
      {kind === "music" && !art && (
        <svg viewBox="0 0 200 200" aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-[220px] w-[220px] opacity-[.14]" style={{ color: "var(--mp-accent)" }}>
          {[96, 76, 56, 36].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="2" />
          ))}
          <circle cx="100" cy="100" r="10" fill="currentColor" />
        </svg>
      )}
      <div className="relative flex flex-col gap-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <OptImg src={profile.avatar_url || "/default-avatar.png"} width={44} height={44} cssWidth={44} square priority className={`h-11 w-11 object-cover ${avatarRadius(normalizeAvatarShape(profile.avatar_shape), "small")}`} style={{ border: `2px solid ${MP.bg}`, boxShadow: "0 0 0 1.5px var(--mp-accent)", background: MP.raised }} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            {(role || profile.about_location) && (
              <span className={`${MICRO} truncate text-[10.5px] uppercase tracking-[.12em]`} style={{ color: MP.muted }}>
                {[profile.about_location, role?.label[locale]].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className={`${MICRO} inline-flex items-center gap-2 self-start text-[11px] uppercase tracking-[.16em]`} style={{ color: "var(--mp-accent)" }}>
            {kind === "tickets" && <span aria-hidden="true" className="h-px w-5" style={{ background: "var(--mp-accent)" }} />}
            {eyebrow}
          </span>
          <h1 className={`${DISPLAY} text-[64px] font-black`}>{title}</h1>
          {count && <p className={`${MICRO} text-[12.5px]`} style={{ color: MP.muted }}>{count}</p>}
        </div>
      </div>
      {kind === "tickets" && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0 border-b-2 border-dashed" style={{ borderColor: MP.lineStrong }} />
      )}
    </header>
  );
}

function Empty({ icon, text, profileHref, label }: { icon: React.ReactNode; text: string; profileHref: string; label: string }) {
  return (
    <div className="mx-5 flex flex-col items-center gap-3 rounded-[22px] border px-6 py-12 text-center" style={{ background: MP.surface, borderColor: MP.border }}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: hexToRgba("#E8B04B", 0.12), color: "var(--mp-accent)" }} aria-hidden="true">{icon}</span>
      <p className="max-w-[28ch] text-[14.5px]" style={{ color: MP.muted }}>{text}</p>
      <Link href={profileHref} className={`inline-flex min-h-[44px] items-center rounded-full border px-5 text-[13.5px] font-semibold ${RING}`} style={{ borderColor: MP.lineStrong }}>
        {label}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- merch: the shop window

function MerchFeature({ product, username, currency, logClick }: { product: any; username: string; currency: string; logClick: (t: "product", id: string, c: { name: string; price: number | null; currency: string }) => void }) {
  const { t, locale } = useLanguage();
  const img = productImages(product)[0];
  const soldOut = product.inventory_count === 0;
  return (
    <section aria-label={t.musicProfile.merchAllHeading} className="px-5">
      <Link href={productHref(username, product.id, true)} onClick={() => logClick("product", product.id, { name: product.name, price: product.price ? Number(product.price) : null, currency })} className={`group block overflow-hidden rounded-[22px] border ${RING}`} style={{ background: MP.surface, borderColor: MP.border, color: MP.fg }}>
        <span className="relative block aspect-[4/5] w-full overflow-hidden" style={{ background: MP.raised }}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <OptImg src={img} widths={[360, 480, 720]} sizes="(min-width: 480px) 440px, 90vw" priority className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center" style={{ color: "var(--mp-accent)" }} aria-hidden="true"><ShoppingBag size={44} strokeWidth={1.3} /></span>
          )}
          <span aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 58%, ${MP.surface} 100%)` }} />
          <span className={`${MICRO} absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10.5px] tracking-[.12em]`} style={{ background: "rgba(18,11,16,.78)", color: soldOut ? MP.muted : "var(--mp-accent)", border: `1px solid ${MP.border}` }}>
            {(soldOut ? t.music.soldOut : t.musicProfile.inStock).toUpperCase()}
          </span>
        </span>
        <span className="flex items-end justify-between gap-3 px-5 pb-5 pt-1">
          <span className="flex min-w-0 flex-col gap-1">
            <span className={`${DISPLAY} text-[34px] font-extrabold [overflow-wrap:anywhere]`}>{product.name}</span>
            {product.price ? <span className={`${MICRO} text-[14px]`} style={{ color: "var(--mp-accent)" }} suppressHydrationWarning>{formatMusicPrice(product.price, currency, locale)}</span> : null}
          </span>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }} aria-hidden="true"><ArrowUpRight size={20} /></span>
        </span>
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- tickets: the night out

function EventPoster({ event, username, currency }: { event: any; username: string; currency: string }) {
  const { t, locale } = useLanguage();
  const parts = eventDateParts(event.event_date, locale);
  const primary = primaryTicketType(event.event_ticket_types);
  const price = primary ? formatMusicPrice(primary.price, currency, locale) : event.price ? formatMusicPrice(event.price, currency, locale) : "";
  const detail = `/m/${username}/ticket/${event.id}`;
  return (
    <section aria-label={t.musicProfile.nextUp} className="px-5">
      <div className="overflow-hidden rounded-[22px] border" style={{ background: MP.surface, borderColor: MP.border }}>
        <Link href={detail} className={`relative block aspect-[4/5] w-full overflow-hidden ${RING}`} aria-label={event.title} tabIndex={-1}>
          {event.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <OptImg src={event.cover_image_url} widths={[360, 480, 720]} sizes="(min-width: 480px) 440px, 90vw" priority className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(150deg, ${hexToRgba("#E8B04B", 0.28)}, ${MP.raised})`, color: "var(--mp-accent)" }} aria-hidden="true"><Ticket size={52} strokeWidth={1.3} /></span>
          )}
          <span aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(18,11,16,.15) 0%, transparent 35%, ${MP.surface} 100%)` }} />
          {parts && (
            <time dateTime={event.event_date} className="absolute left-3 top-3 flex w-[64px] flex-col items-center rounded-[14px] py-2" style={{ background: MP.cream, color: MP.ink }} suppressHydrationWarning>
              <span className={`${MICRO} text-[11px] tracking-[.14em]`}>{parts.month}</span>
              <span className={`${DISPLAY} text-[38px] font-black`}>{parts.day}</span>
            </time>
          )}
        </Link>
        <div className="flex flex-col gap-3 px-5 pb-5 pt-1">
          <span className={`${MICRO} text-[11px] uppercase tracking-[.14em]`} style={{ color: "var(--mp-accent)" }}>{t.musicProfile.nextUp}</span>
          <h2 className={`${DISPLAY} text-[40px] font-extrabold [overflow-wrap:anywhere]`}>{event.title}</h2>
          {(event.location || event.event_time) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]" style={{ color: MP.muted }}>
              {event.location && <span className="inline-flex items-center gap-1.5"><MapPin size={14} aria-hidden="true" />{event.location}</span>}
              {event.event_time && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" />{event.event_time}</span>}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            {price && <span className={`${MICRO} text-[14px]`} suppressHydrationWarning>{price}</span>}
            <Link href={detail} className={`ringo-tactile ml-auto inline-flex min-h-[48px] items-center gap-2 rounded-full px-5 text-[14px] font-bold ${RING}`} style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)" }}>
              <Ticket size={15} aria-hidden="true" />
              {primary ? t.music.viewTicketsButton : t.music.getTicket}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- the page

export default function MusicDestinationView({ kind, profile }: { kind: DestinationKind; profile: any }) {
  const { t } = useLanguage();
  const { playingId, progress, togglePlay } = useTrackPlayback();
  const playback = { playingId, progress, togglePlay };

  const username: string = profile.username;

  // A tap on a product records the same analytics click the profile page records (POST /api/track, the existing click_events + server-side pixel path), exactly like the
  // product page does (ProductDetailView). Fire-and-forget and keepalive, so it survives the navigation and can never break the tap.
  const logClick = (targetType: "link" | "product" | "whatsapp", targetId?: string, content?: { name?: string; price?: number | null; currency?: string | null }) => {
    try {
      fetch("/api/track", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          targetType,
          targetId: targetId ?? null,
          eventId: newEventId(),
          contentName: content?.name ?? null,
          value: typeof content?.price === "number" ? content.price : null,
          currency: content?.currency ?? null,
        }),
      }).catch(() => {});
    } catch {
      /* analytics must never break the action */
    }
  };
  const name: string = profile.name || username;
  const currency: string = profile.currency || "XAF";
  const accent: string = profile.theme_color || "#D4A954";
  const whatsappNumber: string | null = profile.whatsapp_number || null;
  const hasTicketing = profileHasTicketing(profile);

  const releases = publicRows<any>(profile.music_releases, isPublicRelease).filter((r) => r.available !== false);
  const tracks = publicRows<any>(profile.tracks, isPublicTrack).filter((tr) => tr.available !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const products = (profile.products || []).filter((p: any) => p.available !== false);
  const events = hasTicketing ? (profile.events || []).filter((e: any) => e.status !== "draft") : [];

  const releaseTitleById: Record<string, string> = Object.fromEntries(releases.map((r) => [r.id, r.title]));
  const trackCounts: Record<string, number> = {};
  for (const tr of tracks) if (tr.release_id) trackCounts[tr.release_id] = (trackCounts[tr.release_id] || 0) + 1;
  const listedTracks = tracks.map((tr) => ({ ...tr, release_title: tr.release_id ? releaseTitleById[tr.release_id] || "" : "" }));

  const has = { music: tracks.length + releases.length > 0, merch: products.length > 0, tickets: events.length > 0 };
  const latest = pickLatestRelease(releases, tracks);
  const featured: FeaturedItem | null = latest ? (latest.kind === "track" ? { kind: "track", item: latest.item, pinned: false } : { kind: "release", item: latest.item }) : null;
  const art = latest ? latest.item.cover_image_url || null : null;

  const isDead = (e: any) => e.status === "cancelled" || e.status === "completed";
  const byDate = (a: any, b: any) => String(a.event_date || "9999").localeCompare(String(b.event_date || "9999")) || (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const upcoming = events.filter((e: any) => !isDead(e)).sort(byDate);
  const past = events.filter(isDead).sort((a: any, b: any) => byDate(b, a));

  const inStock = products.filter((p: any) => p.inventory_count !== 0);
  const leadProduct = inStock[0] || products[0] || null;
  const restProducts = products.filter((p: any) => p !== leadProduct);

  const m = t.musicProfile;
  const head =
    kind === "music"
      ? { title: m.musicPageTitle, eyebrow: m.musicPageEyebrow, count: [tracks.length ? m.songCount(tracks.length) : "", releases.length ? m.releaseCount(releases.length) : ""].filter(Boolean).join(" · ") }
      : kind === "merch"
        ? { title: m.merchPageTitle, eyebrow: m.merchPageEyebrow, count: products.length ? m.productCount(products.length) : "" }
        : { title: m.ticketsPageTitle, eyebrow: m.ticketsPageEyebrow, count: events.length ? m.eventCount(events.length) : "" };

  const profileHref = `/${username}`;
  const empty = !has[kind];

  return (
    <div
      className={`${display.variable} min-h-screen w-full`}
      style={{ background: MP.bg, color: MP.fg, ["--mp-accent" as any]: accent, ["--mp-on-accent" as any]: readableOn(accent), ["--mp-accent-soft" as any]: hexToRgba(accent, 0.2) }}
    >
      <DestinationBar username={username} name={name} active={kind} has={has} accent={accent} />
      <main className="mx-auto flex w-full max-w-[480px] flex-col pb-24">
        <DestinationHeader kind={kind} profile={profile} title={head.title} eyebrow={head.eyebrow} count={head.count} art={art} />

        <div className="flex flex-col gap-12 pt-2">
          {empty && (
            <Empty
              icon={kind === "music" ? <Disc3 size={22} /> : kind === "merch" ? <ShoppingBag size={22} /> : <Ticket size={22} />}
              text={kind === "music" ? m.emptyMusic : kind === "merch" ? m.emptyMerch : m.emptyTickets}
              profileHref={profileHref}
              label={m.backToProfile}
            />
          )}

          {kind === "music" && has.music && (
            <>
              {featured && (
                <FeaturedCard featured={featured} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name} tracksOfRelease={featured.kind === "release" ? trackCounts[featured.item.id] || 0 : 0} playback={playback} />
              )}
              {releases.length > 0 && <ReleasesRail releases={releases} username={username} currency={currency} trackCounts={trackCounts} layout="grid" heading={m.albumsHeading} />}
              {listedTracks.length > 0 && (
                <SongList tracks={listedTracks} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name} playback={playback} totalCount={listedTracks.length} heading={m.allSongsHeading} />
              )}
            </>
          )}

          {kind === "merch" && has.merch && (
            <>
              {leadProduct && <MerchFeature product={leadProduct} username={username} currency={currency} logClick={logClick} />}
              {restProducts.length > 0 && <MerchGrid products={restProducts} username={username} currency={currency} totalCount={restProducts.length} logClick={logClick} heading={m.merchAllHeading} />}
            </>
          )}

          {kind === "tickets" && has.tickets && (
            <>
              {upcoming[0] && <EventPoster event={upcoming[0]} username={username} currency={currency} />}
              {upcoming.length > 1 && <TicketStubs events={upcoming.slice(1)} username={username} currency={currency} whatsappNumber={whatsappNumber} totalCount={upcoming.length - 1} heading={m.upcomingHeading} eyebrow={m.ticketsPageEyebrow} />}
              {past.length > 0 && <TicketStubs events={past} username={username} currency={currency} whatsappNumber={whatsappNumber} totalCount={past.length} heading={m.pastHeading} eyebrow={m.ticketsPageEyebrow} />}
            </>
          )}

          <footer role="contentinfo" className="flex flex-col items-center gap-4 px-5 pt-2 text-center">
            <Link href={profileHref} className={`inline-flex min-h-[48px] items-center rounded-full border px-6 text-[14px] font-semibold ${RING}`} style={{ borderColor: MP.lineStrong }}>
              {m.backToProfile}
            </Link>
            <PoweredByRingo />
          </footer>
        </div>
      </main>
      <MiniPlayer tracks={tracks} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name} playback={playback} />
    </div>
  );
}
