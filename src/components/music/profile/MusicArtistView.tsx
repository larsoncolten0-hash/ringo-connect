"use client";

import Link from "next/link";
import { BadgeCheck, CalendarCheck, MapPin, Pause, Phone, Play, ShoppingBag, UserPlus } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import { getBookingConfig, getMusicRole } from "@/lib/categories";
import { hexToRgba, readableOn } from "@/lib/color";
import { buildVCard, vCardFileName } from "@/lib/vcard";
import { coverImage, profileNameSize, trackActions } from "@/lib/music/profileMusic";
import type { LatestRelease } from "@/lib/latestRelease";
import SocialIcon from "@/components/SocialIcon";
import ShareButton from "@/components/ShareButton";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import FanRecognitionHeader from "@/components/FanRecognitionHeader";
import ConnectButton from "@/components/connect/ConnectButton";
import ConnectionPath from "@/components/profile/ConnectionPath";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import PoweredByRingo from "@/components/PoweredByRingo";
import { DISPLAY, MICRO, MP } from "./musicTheme";
import { display } from "./musicFont";
import { avatarRadius, normalizeAvatarShape } from "@/lib/avatarShape";
import { DestinationPills } from "./MusicNav";
import { AboutBlock, FeaturedCard, GiftCard, LinkRows, MerchGrid, MiniPlayer, ReleasesRail, SongList, TicketStubs, type FeaturedItem } from "./MusicSections";
import OptImg from "@/components/ui/OptImg";


const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--mp-accent)]";
const SONGS_ON_PROFILE = 6;
const EVENTS_ON_PROFILE = 3;
const MERCH_ON_PROFILE = 4;

type Playback = { playingId: string | null; progress: number; togglePlay: (track: any) => void };

export type MusicProfileData = {
  tracks: any[];
  releases: any[];
  events: any[];
  products: any[];
  links: any[];
  socials: any[];
  hasTicketing: boolean;
  supportEnabled: boolean;
  pinnedItem: any | null;
  showPinnedSupport: boolean;
  latestRelease: LatestRelease | null;
};

/**
 * The public Music profile's own composition (replaces the generic profile layout for the music_entertainment category only). It re-composes the artist's REAL rows:
 * nothing is invented, every section hides when it is empty, prices are the artist's FCFA prices, and the sale itself is untouched: the 10-second preview is the existing
 * preview player, Buy opens the song's own page (/m/<username>/track/<id>) where the existing cart, Mobile Money payment and protected download live.
 */
export default function MusicArtistView({
  profile,
  data,
  playback,
  logClick,
  accent,
  preview,
  isOwner,
  staffBadges,
}: {
  profile: any;
  data: MusicProfileData;
  playback: Playback;
  logClick: (targetType: "link" | "product" | "whatsapp", targetId?: string, content?: { name?: string; price?: number | null; currency?: string | null }) => void;
  accent: string;
  preview: boolean;
  isOwner: boolean;
  staffBadges: { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string }[];
}) {
  const { t, locale } = useLanguage();
  const name: string = profile.name || profile.username || "";
  const username: string = profile.username;
  const currency: string = profile.currency || "XAF";
  const whatsappNumber: string | null = profile.whatsapp_number || null;
  const onAccent = readableOn(accent);
  const ctx = { username, currency, locale, hasWhatsapp: !!whatsappNumber };

  const releaseTitleById: Record<string, string> = Object.fromEntries(data.releases.map((r: any) => [r.id, r.title]));
  const trackCounts: Record<string, number> = {};
  for (const tr of data.tracks) if (tr.release_id) trackCounts[tr.release_id] = (trackCounts[tr.release_id] || 0) + 1;

  // Songs in the artist's own order, enriched for display only (the originals are what the player and the purchase use).
  const orderedTracks = [...data.tracks].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const listedTracks = orderedTracks.slice(0, SONGS_ON_PROFILE).map((tr) => ({ ...tr, release_title: tr.release_id ? releaseTitleById[tr.release_id] || "" : "" }));
  const firstListenable = orderedTracks.find((tr) => {
    const l = trackActions(tr, ctx).listen;
    return l === "preview" || l === "play";
  });
  const playingFirst = !!firstListenable && playback.playingId === firstListenable.id;

  const releases = data.releases.filter((r: any) => r.available !== false);
  const events = data.hasTicketing ? [...data.events].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [];
  const storeHref = `/m/${username}`;
  // The artist's own destinations: each opens its own page (never a scroll down this one). Only what exists is offered.
  const hasMusic = data.tracks.length + releases.length > 0;
  const hasMerch = data.products.length > 0;
  const hasTickets = events.length > 0;
  const musicHref = `${storeHref}/music`;
  const merchHref = `${storeHref}/merch`;
  const ticketsHref = `${storeHref}/tickets`;
  const hasStore = hasMusic;

  // The lead: the artist's own pin always wins; with nothing pinned, their newest real release or single leads; nothing real = no featured card.
  const featured: FeaturedItem | null = data.pinnedItem
    ? data.pinnedItem && profile.pinned_type === "track" ? { kind: "track", item: data.pinnedItem, pinned: true }
      : profile.pinned_type === "product" ? { kind: "product", item: data.pinnedItem }
      : profile.pinned_type === "event" ? { kind: "event", item: data.pinnedItem }
      : null
    : data.showPinnedSupport ? { kind: "support" }
    : data.latestRelease ? (data.latestRelease.kind === "track" ? { kind: "track", item: data.latestRelease.item, pinned: false } : { kind: "release", item: data.latestRelease.item })
    : null;

  // Booking exactly as before: the artist's own Book page once enabled, otherwise the WhatsApp hand-off.
  const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
  const bookingsEnabled = !!profile.bookings_enabled;
  const bookHref = bookingsEnabled ? `/${username}/book` : cleanNumber ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(t.music.bookNowWhatsappMessage)}` : undefined;
  const bookLabel = profile.booking_button_text?.trim() || getBookingConfig(profile.category).buttonLabel[locale] || t.music.bookNowButton;

  const role = getMusicRole(profile.music_role);
  const nameSize = profileNameSize(name);
  const cover = coverImage(profile);
  const vcardHref = whatsappNumber || profile.about_phone ? `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(profile, typeof window !== "undefined" ? window.location.href : undefined))}` : null;

  const extraPhones = (profile.profile_phone_numbers || []).filter((p: any) => p.phone_number?.trim()).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const facts: { label: string; value: string; href?: string }[] = [
    profile.about_location && { label: t.musicProfile.factBasedIn, value: profile.about_location },
    profile.about_position && { label: t.musicProfile.factPosition, value: profile.about_position },
    profile.about_company && { label: t.musicProfile.factCompany, value: profile.about_company },
    profile.about_email && { label: t.musicProfile.factEmail, value: profile.about_email, href: `mailto:${profile.about_email}` },
    profile.about_phone && { label: t.musicProfile.factPhone, value: profile.about_phone, href: `tel:${profile.about_phone.replace(/[^0-9+]/g, "")}` },
    ...extraPhones.map((p: any) => ({ label: t.musicProfile.factPhone, value: p.phone_number, href: `tel:${p.phone_number.replace(/[^0-9+]/g, "")}` })),
    profile.about_hours && { label: t.musicProfile.factHours, value: profile.about_hours },
  ].filter(Boolean) as { label: string; value: string; href?: string }[];
  const showAbout = !!profile.about_long_bio || facts.length > 0;

  const tile = `ringo-tactile flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-3.5 text-[13px] font-semibold ${RING}`;
  const tileStyle = { background: MP.surface, borderColor: MP.line, color: MP.fg };
  const badge = (bg: string, fg: string, icon: React.ReactNode) => (
    <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: bg, color: fg }} aria-hidden="true">{icon}</span>
  );

  const sections: React.ReactNode[] = [
    featured && (
      <FeaturedCard key="featured" featured={featured} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name}
        tracksOfRelease={featured.kind === "release" ? trackCounts[featured.item.id] || 0 : 0} playback={playback} />
    ),
    listedTracks.length > 0 && (
      <SongList key="songs" tracks={listedTracks} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name} playback={playback} moreHref={musicHref} totalCount={orderedTracks.length} />
    ),
    releases.length > 0 && <ReleasesRail key="releases" releases={releases} username={username} currency={currency} trackCounts={trackCounts} storeHref={musicHref} />,
    events.length > 0 && <TicketStubs key="events" events={events.slice(0, EVENTS_ON_PROFILE)} username={username} currency={currency} whatsappNumber={whatsappNumber} moreHref={ticketsHref} totalCount={events.length} />,
    data.products.length > 0 && <MerchGrid key="merch" products={data.products.slice(0, MERCH_ON_PROFILE)} username={username} currency={currency} storeHref={merchHref} totalCount={data.products.length} logClick={logClick} />,
    data.links.length > 0 && <LinkRows key="links" links={data.links} name={name} logClick={logClick} />,
    data.supportEnabled && <GiftCard key="gift" name={name} username={username} message={profile.support_message} />,
    showAbout && <AboutBlock key="about" name={name} avatar={profile.avatar_url} longBio={profile.about_long_bio} facts={facts} />,
  ].filter(Boolean) as React.ReactNode[];

  return (
    <div
      className={`${display.variable} relative w-full overflow-x-clip`}
      style={{ background: MP.bg, color: MP.fg, ["--mp-accent" as any]: accent, ["--mp-on-accent" as any]: onAccent }}
    >
      <div className="mx-auto flex w-full max-w-[480px] flex-col pb-24">
        {/* ------------------------------------------------------------------------------------------- hero */}
        <header className="relative">
          <div className="relative h-[270px] w-full overflow-hidden">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <OptImg src={cover} widths={[480, 768, 960]} sizes="(min-width: 480px) 480px, 100vw" priority className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
            ) : (
              <div className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 20% 0%, ${hexToRgba(accent, 0.34)}, transparent 62%), linear-gradient(170deg, ${hexToRgba(accent, 0.16)}, ${MP.bg} 78%)` }} aria-hidden="true" />
            )}
            <div className="absolute inset-0" aria-hidden="true" style={{ background: `linear-gradient(180deg, rgba(18,11,16,.62) 0%, rgba(18,11,16,0) 26%, rgba(18,11,16,0) 54%, ${MP.bg} 100%)` }} />

            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-4">
              <span className={`${MICRO} rounded-full border px-3 py-2 text-[12px] tracking-[.08em]`} style={{ background: "rgba(18,11,16,.55)", borderColor: "rgba(243,233,220,.14)" }}>
                @{username}
              </span>
              {!preview && (
                <div className="flex items-center gap-2">
                  <FanRecognitionHeader username={username} creatorName={name} accent={accent} isOwner={isOwner} />
                  <PublicLanguageSelector variant="glass" accent={accent} />
                  <ShareButton
                    accent={accent}
                    title={name}
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
                      qrCodeSubtitle: t.profilePage.qrCodeSubtitle,
                      qrCodeError: t.profilePage.qrCodeError,
                      downloadQrCode: t.profilePage.downloadQrCode,
                      close: t.profilePage.close,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* The identity: the artist's own portrait (a separate image from the cover) hangs off the cover's lower edge, the name beside it as a normal heading. */}
          <div className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 px-5">
            <OptImg
              src={profile.avatar_url || "/default-avatar.png"}
              alt={name}
              width={96}
              height={96}
              cssWidth={96}
              square
              priority
              className={`-mt-12 h-24 w-24 object-cover ${avatarRadius(normalizeAvatarShape(profile.avatar_shape), "large")}`}
              style={{ border: `3px solid ${MP.bg}`, boxShadow: `0 0 0 1.5px ${accent}, 0 14px 26px -12px rgba(0,0,0,.75)`, background: MP.raised }}
            />
            <div className="flex min-w-0 flex-col gap-1.5 pt-3">
              {(profile.about_location || role) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {profile.about_location && (
                    <span className={`${MICRO} inline-flex items-center gap-1 text-[11px] uppercase tracking-[.12em]`}>
                      <MapPin size={12} aria-hidden="true" style={{ color: "var(--mp-accent)" }} />
                      {profile.about_location}
                    </span>
                  )}
                  {profile.about_location && role && <span aria-hidden="true" className="h-1 w-1 rounded-full" style={{ background: MP.muted }} />}
                  {role && <span className={`${MICRO} text-[11px] uppercase tracking-[.12em]`} style={{ color: MP.muted }}>{role.label[locale]}</span>}
                </div>
              )}
              <h1 className={`${DISPLAY} flex items-start gap-1.5 tracking-[-0.005em]`} style={{ fontSize: nameSize, lineHeight: 0.98 }}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                {profile.verified && (
                  <BadgeCheck size={20} className="mt-0.5 shrink-0" style={{ color: "#3B82F6", fill: "#3B82F6", stroke: MP.bg }} aria-label={t.profilePage.verifiedBadge}>
                    <title>{t.profilePage.verifiedBadge}</title>
                  </BadgeCheck>
                )}
              </h1>
            </div>
          </div>
        </header>

        <div id={preview ? undefined : "profile-content"} tabIndex={preview ? undefined : -1} className="flex flex-col gap-12 focus:outline-none">
          {/* ------------------------------------------------------------------------------------------- identity + actions */}
          <div className="flex flex-col gap-[18px] px-5 pt-3.5">
            {profile.is_demo && (
              <span className="self-start rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#F59E0B", color: "#111827" }}>{t.demo.publicBadge}</span>
            )}
            {profile.bio && <p className="line-clamp-4 max-w-[34ch] text-[16px] leading-[1.55]">{profile.bio}</p>}
            {staffBadges.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {staffBadges.map((b) => (
                  <a key={b.orgUsername} href={`/${b.orgUsername}`} className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-xs font-medium ${RING}`} style={{ borderColor: hexToRgba(accent, 0.4), color: "var(--mp-accent)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.orgAvatarUrl || "/default-avatar.png"} alt="" className="h-5 w-5 rounded-full object-cover" />
                    {t.profilePage.staffBadge(b.roleName, b.orgName)}
                  </a>
                ))}
              </div>
            )}

            {(firstListenable || hasStore) && (
              <div className="grid grid-cols-2 gap-2.5">
                {firstListenable && (
                  <button
                    type="button"
                    onClick={() => playback.togglePlay(firstListenable)}
                    aria-pressed={playingFirst}
                    className={`ringo-tactile inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold ${RING}`}
                    style={{ background: "var(--mp-accent)", color: "var(--mp-on-accent)", gridColumn: hasStore ? undefined : "1 / -1" }}
                  >
                    {playingFirst ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                    {playingFirst ? t.music.pauseLabel : t.music.playLabel}
                  </button>
                )}
                {hasStore && (
                  <Link
                    href={musicHref}
                    onClick={preview ? (e) => e.preventDefault() : undefined}
                    className={`ringo-tactile inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-semibold ${RING}`}
                    style={{ borderColor: MP.lineStrong, gridColumn: firstListenable ? undefined : "1 / -1" }}
                  >
                    <ShoppingBag size={16} aria-hidden="true" />
                    {t.musicProfile.buyMusic}
                  </Link>
                )}
              </div>
            )}

            {bookHref && (
              <a
                href={bookHref}
                {...(bookingsEnabled ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                className={`ringo-tactile inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-semibold ${RING}`}
                style={{ borderColor: hexToRgba(accent, 0.6), color: "var(--mp-accent)" }}
              >
                <CalendarCheck size={16} aria-hidden="true" />
                {bookLabel}
              </a>
            )}

            <DestinationPills username={username} has={{ music: hasMusic, merch: hasMerch, tickets: hasTickets }} preview={preview} />
          </div>

          {/* ------------------------------------------------------------------------------------------- contact + social + connect */}
          {(whatsappNumber || data.socials.length > 0 || !isOwner) && (
            <div className="-mt-4 flex flex-col gap-[18px] px-5">
              {whatsappNumber && (
                <div className="grid grid-cols-3 gap-2">
                  <a href={`https://wa.me/${cleanNumber}${profile.default_whatsapp_message ? `?text=${encodeURIComponent(profile.default_whatsapp_message)}` : ""}`} target="_blank" rel="noopener noreferrer" onClick={() => logClick("whatsapp", undefined, { name: "WhatsApp" })} className={tile} style={tileStyle}>
                    {badge(MP.whatsapp, MP.fg, <FaWhatsapp size={18} />)}
                    {t.musicProfile.whatsapp}
                  </a>
                  <a href={`tel:${whatsappNumber.replace(/[^0-9+]/g, "")}`} className={tile} style={tileStyle}>
                    {badge(MP.coral, MP.fg, <Phone size={17} />)}
                    {t.musicProfile.call}
                  </a>
                  {vcardHref && (
                    <a href={vcardHref} download={vCardFileName(profile)} className={tile} style={tileStyle}>
                      {badge("var(--mp-accent)", "var(--mp-on-accent)", <UserPlus size={17} />)}
                      {t.musicProfile.saveContact}
                    </a>
                  )}
                </div>
              )}
              {data.socials.length > 0 && (
                <div className="flex flex-wrap justify-between gap-1.5" style={{ color: MP.fg }}>
                  {data.socials.map((s: any) => (
                    <SocialIcon key={s.id} platform={s.platform} url={s.url} ghost />
                  ))}
                </div>
              )}
              {!isOwner && (
                <div className="flex justify-center">
                  <ConnectButton
                    profile={{ id: profile.id, name }}
                    accent={accent}
                    radiusClass="rounded-full"
                    buttonStyle={{ background: "transparent", color: MP.fg, border: `1.5px solid ${MP.lineStrong}` }}
                    borderTint={MP.line}
                    textColor={MP.fg}
                    preview={preview}
                    variant="compact"
                  />
                </div>
              )}
            </div>
          )}

          {sections}

          {/* ------------------------------------------------------------------------------------------- the Ringo close */}
          <footer role="contentinfo" className="flex flex-col items-center gap-5 px-5 pb-6 pt-4 text-center">
            <ConnectionPath accent={accent} line={MP.line} className="mb-1" />
            {!preview && (
              <div className="w-full max-w-sm">
                <AddToHomeScreen
                  displayName={name}
                  username={username}
                  accent={accent}
                  radiusClass="rounded-full"
                  buttonStyle={{ background: "transparent", color: MP.fg, border: `1.5px solid ${MP.lineStrong}` }}
                  borderTint={MP.line}
                  textColor={MP.fg}
                />
              </div>
            )}
            <p className="text-xs" style={{ color: MP.muted }}>
              © {new Date().getFullYear()} {name}. {t.profilePage.rights}
            </p>
            <PoweredByRingo />
          </footer>
        </div>
      </div>

      {!preview && <MiniPlayer tracks={orderedTracks} username={username} currency={currency} whatsappNumber={whatsappNumber} artistName={name} playback={playback} />}
    </div>
  );
}
