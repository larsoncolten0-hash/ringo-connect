"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Script from "next/script";
import { MotionConfig } from "framer-motion";
import { ExternalLink, MapPin, ChevronRight, ChevronDown, ShoppingBag, ShoppingCart, Mail, Phone, Clock, BadgeCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory, getMusicRole, profileHasCategory, profileHasTicketing } from "@/lib/categories";
import { formatPrice } from "@/lib/currency";
import { accentTextOn, hexToRgba } from "@/lib/color";
import { getButtonStyle, getPanelButtonStyle, getRadiusClass, getBackgroundStyle } from "@/lib/theme";
import { getProfileStage, type AvatarMark, type ProfileStage } from "@/lib/profileStage";
import Ring from "@/components/brand/Ring";
import ConnectionPath from "@/components/profile/ConnectionPath";
import { ensureVisitorId, captureTtclid, newEventId } from "@/lib/pixelClient";
import { OPTIONAL_TRACKING_ENABLED, clearOptionalTrackingCookies } from "@/lib/optionalTracking";
import { metaEventName, tiktokEventName, isValidFacebookPixelId, isValidTiktokPixelId } from "@/lib/pixelEvents";
import SocialIcon from "./SocialIcon";
import MusicSection from "./music/MusicSection";
import EventsSection from "./music/EventsSection";
import SupportArtistSection from "./music/SupportArtistSection";
import PinnedSpotlight from "./music/PinnedSpotlight";
import MusicHeroButtons from "./music/MusicHeroButtons";
import ReleasesSection from "./music/ReleasesSection";
import LatestReleaseFeature from "./music/LatestReleaseFeature";
import MusicStoreEntry from "./music/MusicStoreEntry";
import { pickLatestRelease } from "@/lib/latestRelease";
import { useTrackPlayback } from "./music/useTrackPlayback";
import RestaurantHeroButtons from "./restaurant/RestaurantHeroButtons";
import FeaturedMenuSection from "./restaurant/FeaturedMenuSection";
import OpeningHoursRow from "./restaurant/OpeningHoursRow";
import ImageGallery from "./ImageGallery";
import ShareButton from "./ShareButton";
import { displayHref } from "@/lib/linkUrl";
import { isPublicLink, isPublicMenuItem, isPublicProduct, isPublicRelease, isPublicSocialLink, isPublicTrack, publicLinkTitle, publicRows } from "@/lib/publicContent";
import FanRecognitionHeader from "./FanRecognitionHeader";
import GenericHeroActions from "./GenericHeroActions";
import { resolveHeroAction } from "@/lib/heroAction";
import { orderPublicSections, type PublicSection } from "@/lib/sectionOrder";
import AddToHomeScreen from "./AddToHomeScreen";
import PublicLanguageSelector from "./PublicLanguageSelector";
import PoweredByRingo from "./PoweredByRingo";
import ConnectButton from "./connect/ConnectButton";
import RegisterServiceWorker from "./RegisterServiceWorker";
import CatalogSection from "@/components/catalog/CatalogSection";
import AppBadgeReset from "./AppBadgeReset";
import dynamic from "next/dynamic";
import { avatarRadius, normalizeAvatarShape } from "@/lib/avatarShape";
import OptImg from "@/components/ui/OptImg";

// The Music artist profile has its own composition (components/music/profile). Loaded only for the music_entertainment category, so every other profile keeps its
// bundle exactly as before.
const MusicArtistView = dynamic(() => import("./music/profile/MusicArtistView"));

// What a stage's choices look like (lib/profileStage.ts holds the choices; these are only their classes).
const AVATAR_IMAGE: Record<AvatarMark, string> = { pulse: "rounded-full ring-4", ring: "rounded-full", still: "rounded-full ring-4", tile: "rounded-ringo-lg ring-4" };
const COVER_HEIGHT: Record<ProfileStage["cover"], string> = { standard: "h-52 sm:h-60", tall: "h-64 sm:h-80" };
const NAME_CASE: Record<ProfileStage["name"], string> = { upper: "uppercase", natural: "" };
// Editorial headings: every section title is a real heading in the display face. The sections set their own quiet label (small, upper-
// case, faded), so the override has to win over those classes and over the label's inline opacity.
const HEADINGS: Record<ProfileStage["headings"], string> = {
  label: "",
  editorial: "[&_h2]:!font-display [&_h2]:!text-lg [&_h2]:!font-bold [&_h2]:!normal-case [&_h2]:!tracking-tight [&_h2]:!opacity-100",
};

export default function ProfileView({
  profile,
  pixelsEnabled,
  pageViewEventId,
  preview = false,
  isOwner = false,
  staffBadges = [],
}: {
  profile: any;
  pixelsEnabled?: boolean;
  pageViewEventId?: string;
  // Renders inside the dashboard Editor's live preview panel instead of
  // as the actual public page: never fires ad-pixel events or records a
  // click in analytics for the creator's own preview interactions, and
  // hides the "copy link" affordance (window.location.href there would be
  // the dashboard's own URL, not the profile's).
  preview?: boolean;
  // True when the signed-in visitor IS this profile's own owner, viewing
  // their live page directly (not the dashboard preview, which already
  // has its own `preview` gate) — computed server-side in
  // src/app/[username]/page.tsx via auth.getUser(). Only ever suppresses
  // FanRecognitionHeader below; nothing else on the page currently reads
  // this.
  isOwner?: boolean;
  // "Chef at Mama's Kitchen" style pill(s) — one per organization this
  // person is currently active staff at, live-derived server-side (see
  // src/app/[username]/page.tsx). Empty whenever there's nothing to show
  // (no active memberships, or the person turned the toggle off) — never
  // computed client-side, so there's nothing here to gate on preview vs.
  // real render beyond just passing an empty array from the dashboard's
  // live preview, which doesn't fetch this at all.
  staffBadges?: { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string }[];
}) {
  const { t, locale } = useLanguage();
  const [showCatalog, setShowCatalog] = useState(true);
  const catalogLabel = getCategory(profile.category)?.defaults.catalogLabel?.[locale] || t.profilePage.catalogHeading;
  const isMusic = profileHasCategory(profile, "music_entertainment");
  const isRestaurant = profileHasCategory(profile, "restaurant_food");
  // Events & Experiences gets the same ticketing toolkit Music &
  // Entertainment already has (events, ticket types, checkout, digital
  // tickets, gate scanning) — see EventsSection below — without picking up
  // any of Music's other category-specific UI (tracks, releases, the cream
  // theme, Support the Artist), which all stay isMusic-only.
  const hasTicketing = profileHasTicketing(profile);
  // Only rows a visitor could actually use are shown (see lib/publicContent.ts): a link with no real address,
  // a product or dish with no name, a track or release with no title are skipped. Rendering only: the editor
  // still lists every row, and nothing is deleted or changed. The editor's live preview goes through this
  // same component, so it shows exactly what the public page shows.
  const menuItems: any[] = publicRows<any>(profile.menu_items, isPublicMenuItem);
  const publicLinks: any[] = publicRows<any>(profile.links, isPublicLink).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const socialLinks: any[] = publicRows<any>(profile.social_links, isPublicSocialLink);
  const releases: any[] = publicRows<any>(profile.music_releases, isPublicRelease);
  const shownProducts: any[] = publicRows<any>(profile.products, isPublicProduct);
  const musicTracks: any[] = publicRows<any>(profile.tracks, isPublicTrack).filter((tr: any) => tr.available !== false);
  // A draft event is hidden entirely, same as any other unpublished item
  // — cancelled/completed still show (see EventsSection/ItemDetailPage's
  // own comments on why) but aren't purchasable.
  const musicEvents: any[] = (profile.events || []).filter((e: any) => e.status !== "draft");
  const musicSectionTitle = getMusicRole(profile.music_role)?.sectionLabel[locale] || t.music.tracksTitleFallback;
  // `available` is a generic field (added for Music's sold-out/inventory
  // needs) that now applies to every category's Catalog — an item only
  // hides here when a creator has explicitly marked it unavailable
  // (`=== false`); older products with no such field keep showing, same
  // as before this field existed.
  const catalogProducts: any[] = shownProducts.filter((p: any) => p.available !== false);
  const supportEnabled = isMusic && profile.hub_support_enabled !== false && !!profile.whatsapp_number;
  const { playingId, progress, togglePlay } = useTrackPlayback();

  // Resolved from whichever list actually matches pinned_type — never
  // trusts pinned_id blindly, so a deleted item (or one that predates
  // this feature and has stale/mismatched data) just quietly means no
  // spotlight renders, instead of a crash.
  const pinnedSource =
    profile.pinned_type === "track" ? musicTracks : profile.pinned_type === "product" ? shownProducts : profile.pinned_type === "event" ? musicEvents : [];
  // Pinning intentionally still looks at the full, unfiltered product list
  // above — a creator who explicitly pinned an item should keep seeing
  // that choice reflected even if they later mark it unavailable, rather
  // than have the spotlight silently vanish.
  const pinnedItem = isMusic && profile.pinned_id ? pinnedSource.find((x: any) => x.id === profile.pinned_id) : null;
  // "support" has no row of its own (pinned_id is always null for it) — it
  // depends on the Support the Artist toggle still being on, the same way
  // track/product/event depend on the item still existing.
  const showPinnedSupport = isMusic && profile.pinned_type === "support" && supportEnabled;
  // The artist's own pin always leads. With nothing pinned, the newest REAL release or single leads instead (never invented: none means nothing).
  const latestRelease = isMusic && !pinnedItem && !showPinnedSupport ? pickLatestRelease(releases, musicTracks) : null;
  const isVerified = !!profile.verified;
  const avatarShape = normalizeAvatarShape(profile.avatar_shape);
  const squareAvatar = avatarShape === "square";
  // Restaurant and Music keep their own hero buttons (branch order below is unchanged); only a generic
  // profile gets the single-primary-action hero. Pure and synchronous: see lib/heroAction.ts.
  const genericHero = !isRestaurant && !isMusic ? resolveHeroAction(profile, locale) : null;

  // Populated client-side only (cookies aren't readable during SSR) —
  // the Meta/TikTok Pixel scripts below stay unrendered until this is
  // set, so `external_id` is always present on the very first PageView
  // rather than trickling in on a later event.
  const [visitorId, setVisitorId] = useState<string | null>(null);
  useEffect(() => {
    // Optional advertising tracking (the visitor id, the TikTok click id and the Meta / TikTok pixels) only runs when lib/optionalTracking.ts allows it; otherwise any such cookie left from an earlier visit is removed.
    if (OPTIONAL_TRACKING_ENABLED) {
      setVisitorId(ensureVisitorId());
      captureTtclid();
    } else {
      clearOptionalTrackingCookies();
    }
  }, []);

  const fbPixelId = !preview && pixelsEnabled && profile.facebook_pixel_id && isValidFacebookPixelId(profile.facebook_pixel_id)
    ? profile.facebook_pixel_id
    : null;
  const ttPixelId = !preview && pixelsEnabled && profile.tiktok_pixel_id && isValidTiktokPixelId(profile.tiktok_pixel_id)
    ? profile.tiktok_pixel_id
    : null;

  const logClick = async (
    targetType: "link" | "product" | "whatsapp",
    targetId?: string,
    content?: { name?: string; price?: number | null; currency?: string | null }
  ) => {
    // A click inside the editor's live preview isn't a real visitor —
    // never fire pixels or record it in analytics.
    if (preview) return;

    const eventId = newEventId();
    const value = typeof content?.price === "number" ? content.price : undefined;
    const currency = content?.currency || undefined;

    // Browser-side Pixel calls — best-effort: an ad blocker commonly
    // strips fbq/ttq entirely, which must never break the actual link
    // click. The same eventId also goes to /api/track below, so Meta/
    // TikTok can merge this with the server-side event instead of
    // counting it twice.
    try {
      const fbq = (window as any).fbq;
      if (fbPixelId && typeof fbq === "function") {
        fbq(
          "track",
          metaEventName(targetType),
          {
            ...(content?.name ? { content_name: content.name } : {}),
            ...(targetId ? { content_ids: [targetId], content_type: "product" } : {}),
            ...(value !== undefined ? { value, currency: currency || "USD" } : {}),
          },
          { eventID: eventId }
        );
      }
    } catch (err) {
      console.error("Meta Pixel track failed:", err);
    }
    try {
      const ttq = (window as any).ttq;
      if (ttPixelId && typeof ttq?.track === "function") {
        ttq.track(
          tiktokEventName(targetType),
          {
            ...(content?.name || targetId ? { contents: [{ content_id: targetId, content_name: content?.name }] } : {}),
            ...(value !== undefined ? { value, currency: currency || "USD" } : {}),
          },
          { event_id: eventId }
        );
      }
    } catch (err) {
      console.error("TikTok Pixel track failed:", err);
    }

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          targetType,
          targetId: targetId ?? null,
          eventId,
          contentName: content?.name ?? null,
          value: value ?? null,
          currency: currency ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("Track request failed:", res.status, body);
      }
    } catch (err) {
      console.error("Track request errored:", err);
    }
  };


  const accent = profile.theme_color || "#D4A954";
  const textColor = profile.text_color || "#FAFAFA";
  const bgColor = profile.background_color || "#0A0A0A";
  const radiusClass = getRadiusClass(profile.button_radius || "rounded");
  const linkButtonStyle = getButtonStyle(profile.button_style || "outline", accent);
  const borderTint = hexToRgba(textColor, 0.12);

  // The category's "stage" (lib/profileStage.ts): Music & Entertainment's light content panel below the dark photo hero, rather than
  // the same dark theme continuing all the way down. Fixed structure made of Ringo foundation tokens, not theme-driven: ThemeCard's
  // background/text color fields still fully control the hero zone above, and the creator's accent is used as it is. A category with
  // no stage (every other category today) has no panel and renders exactly as before.
  const stage = getProfileStage(isMusic ? "music_entertainment" : profile.category);
  const panel = stage.panel;
  const contentTextColor = panel ? panel.textHex : textColor;
  const contentBorderTint = panel ? panel.border : borderTint;
  // Buttons and accent-coloured text that sit ON the fixed panel keep the creator's accent as border / fill, with a legible text colour.
  const panelButtonStyle = panel ? getPanelButtonStyle(profile.button_style || "outline", accent, panel.backgroundHex) : linkButtonStyle;
  // 5.2 (not the 4.5 minimum): the cards inside the panel are a few percent darker than the panel itself, and the text must still read on them
  const panelAccentText = panel ? accentTextOn(panel.backgroundHex, accent, 5.2) : accent;

  // The public page is the creator's brand, not app chrome — it renders
  // with exactly the colors they chose, independent of the visitor's own
  // dark mode preference (unlike the dashboard, which does follow it).
  const pageStyle = {
    ...getBackgroundStyle(profile.background_style || "solid", bgColor, profile.background_gradient_end),
    color: textColor,
    ["--theme" as any]: accent,
    // The Music profile paints its own ground (its view is a full-bleed composition); the artist's accent still drives every action in it.
    ...(isMusic ? { backgroundImage: "none", background: "#120B10", backgroundColor: "#120B10", color: "#F3E9DC" } : {}),
  };

  // First word gets the page's default text color, the rest picks up the
  // accent — matches the two-tone name treatment in the reference design.
  // A single-word name just renders plain, no accent applied to nothing.
  const nameParts = (profile.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const restName = nameParts.slice(1).join(" ");

  // The content sections below the hero, each built once and placed by lib/sectionOrder.ts: the category decides
  // which comes first (a shop's products, a clinic's services, a creator's links), Music and Restaurant keep their
  // long-standing order, and a section with nothing to show is simply not in the list. The editor's live preview
  // is this same component, so it shows exactly this order too.
  let aboutHasContent = false;
  const sections: Record<PublicSection, ReactNode> = {
    about: (() => {
            const hasRoleCard = profile.about_position || profile.about_company;

            const extraPhoneRows = (profile.profile_phone_numbers || [])
              .filter((p: any) => p.phone_number?.trim())
              .sort((a: any, b: any) => a.sort_order - b.sort_order)
              .map((p: any) => ({
                icon: Phone,
                label: t.profilePage.phone,
                value: p.phone_number,
                href: `tel:${p.phone_number.replace(/[^0-9+]/g, "")}`,
              }));

            const contactRows = [
              profile.about_email && {
                icon: Mail,
                label: t.profilePage.email,
                value: profile.about_email,
                href: `mailto:${profile.about_email}`,
              },
              profile.about_phone && {
                icon: Phone,
                label: t.profilePage.phone,
                value: profile.about_phone,
                href: `tel:${profile.about_phone.replace(/[^0-9+]/g, "")}`,
              },
              ...extraPhoneRows,
              profile.about_location && {
                icon: MapPin,
                label: t.profilePage.location,
                value: profile.about_location,
              },
              profile.about_hours && {
                icon: Clock,
                label: t.profilePage.hours,
                value: profile.about_hours,
              },
            ].filter(Boolean) as { icon: any; label: string; value: string; href?: string }[];

            const isEmpty = !hasRoleCard && contactRows.length === 0;
            aboutHasContent = !isEmpty;

            if (isEmpty) {
              return (
                <p className="text-sm text-center py-8" style={{ opacity: 0.5 }}>
                  {t.profilePage.noAboutInfo}
                </p>
              );
            }

            return (
              <div
                className={`relative overflow-hidden ${radiusClass}`}
                style={{ border: `1px solid ${contentBorderTint}`, backgroundColor: hexToRgba(contentTextColor, 0.03) }}
              >
                {/* Top accent stripe — the "card edge" a real business card has */}
                <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />

                {/* A quiet nod to the ring motif used as the brand's own
                    signature elsewhere (the auth pages' pulsing rings) —
                    subtle enough not to compete with the actual content,
                    just enough to make this feel like a Ringo Connect
                    card rather than a generic one. */}
                <div
                  className="absolute -top-7 -right-7 w-32 h-32 rounded-full pointer-events-none"
                  style={{ border: `1.5px solid ${hexToRgba(accent, 0.2)}` }}
                />
                <div
                  className="absolute -top-2 -right-2 w-16 h-16 rounded-full pointer-events-none"
                  style={{ border: `1.5px solid ${hexToRgba(accent, 0.15)}` }}
                />

                <div className="relative p-5">
                  {hasRoleCard && (
                    <div className="mb-4">
                      {profile.about_position && (
                        <p className="text-base font-bold" style={{ color: panelAccentText }}>
                          {profile.about_position}
                        </p>
                      )}
                      {profile.about_company && (
                        <p className="text-sm mt-0.5" style={{ opacity: 0.7 }}>
                          {profile.about_company}
                        </p>
                      )}
                    </div>
                  )}

                  {hasRoleCard && contactRows.length > 0 && (
                    <div className="h-px w-full mb-4" style={{ backgroundColor: contentBorderTint }} />
                  )}

                  {contactRows.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
                      {contactRows.map((item) => {
                        const inner = (
                          <>
                            <item.icon size={15} style={{ color: accent }} className="shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-xs uppercase tracking-wider" style={{ opacity: 0.7 }}>
                                {item.label}
                              </p>
                              <p className="text-sm font-medium [overflow-wrap:anywhere]">{item.value}</p>
                            </div>
                          </>
                        );
                        return item.href ? (
                          <a
                            key={`${item.label}-${item.value}`}
                            href={item.href}
                            className="flex items-start gap-2.5 min-w-0 min-h-[44px] transition hover:opacity-75"
                          >
                            {inner}
                          </a>
                        ) : (
                          <div key={`${item.label}-${item.value}`} className="flex items-start gap-2.5 min-w-0">
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })(),
    music: isMusic && (
            <MusicSection
              t={t}
              title={musicSectionTitle}
              tracks={musicTracks}
              artistName={profile.name || ""}
              accent={accent}
              currency={profile.currency || "USD"}
              whatsappNumber={profile.whatsapp_number}
              username={profile.username}
              playingId={playingId}
              progress={progress}
              onTogglePlay={togglePlay}
            />
          ),
    releases: isMusic && (
            <>
              <ReleasesSection
                t={t}
                releases={releases}
                username={profile.username}
                accent={accent}
                currency={profile.currency || "USD"}
                fadeColor={panel ? panel.background : profile.background_style === "gradient" ? undefined : bgColor}
              />
              <MusicStoreEntry
                t={t}
                username={profile.username}
                counts={{ songs: musicTracks.length, releases: releases.filter((r: any) => r.available !== false).length, merch: catalogProducts.length, events: hasTicketing ? musicEvents.length : 0 }}
                buttonStyle={panel ? panelButtonStyle : linkButtonStyle}
                radiusClass={radiusClass}
                borderTint={contentBorderTint}
                preview={preview}
              />
            </>
          ),
    links: publicLinks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2
                className={isMusic ? "text-base font-bold flex items-center gap-2" : "text-[11px] uppercase tracking-wider"}
                style={isMusic ? undefined : { opacity: 0.5 }}
              >
                {isMusic && <ExternalLink size={16} style={{ color: accent }} />}
                {t.profilePage.linksHeading}
              </h2>
              {publicLinks
                .map((link: any) => (
                  <a
                    key={link.id}
                    href={displayHref(link.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => logClick("link", link.id, { name: link.title })}
                    className={`flex items-center gap-3 p-3 transition hover:brightness-95 hover:-translate-y-0.5 active:scale-[0.98] active:brightness-90 ${radiusClass}`}
                    style={panelButtonStyle}
                  >
                    {link.image_url && (
                      <OptImg src={link.image_url} cssWidth={56} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{publicLinkTitle(link)}</p>
                      {link.description && (
                        <p className="text-xs line-clamp-2 mt-0.5" style={{ opacity: panel ? 1 : 0.7 }}>
                          {link.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="shrink-0" style={{ opacity: 0.6 }} />
                  </a>
                ))}
            </div>
          ),
    catalog: catalogProducts.length > 0 && (
            <CatalogSection
              label={catalogLabel}
              products={catalogProducts}
              username={profile.username}
              currency={profile.currency || "USD"}
              isMusic={isMusic}
              accent={accent}
              accentText={panelAccentText}
              textColor={contentTextColor}
              borderTint={contentBorderTint}
              squareCorners={profile.button_radius === "square"}
              buttonStyle={linkButtonStyle}
              radiusClass={radiusClass}
              category={profile.category}
              bookingEnabled={!!profile.bookings_enabled}
              restaurantOrdering={isRestaurant && profile.ordering_enabled !== false}
              checkoutAvailable={!!(profile as any).commerceCheckoutAvailable}
              isDemo={profile.is_demo === true}
              preview={preview}
              fadeColor={panel ? panel.background : profile.background_style === "gradient" ? undefined : bgColor}
              onOpen={(product) =>
                logClick("product", product.id, {
                  name: product.name,
                  price: product.price ? Number(product.price) : null,
                  currency: profile.currency,
                })
              }
            />
          ),
    events: hasTicketing && (
            <EventsSection
              t={t}
              events={musicEvents}
              accent={accent}
              buttonStyle={linkButtonStyle}
              whatsappNumber={profile.whatsapp_number}
              username={profile.username}
              currency={profile.currency || "USD"}
              dateLead={stage.eventDate === "lead"}
              locale={locale}
              fadeColor={panel ? panel.background : profile.background_style === "gradient" ? undefined : bgColor}
            />
          ),
  };
  const sectionOrder = orderPublicSections(
    { category: profile.category, subcategory: profile.subcategory, isMusic, isRestaurant },
    { about: aboutHasContent, links: publicLinks.length > 0, catalog: catalogProducts.length > 0, events: hasTicketing && musicEvents.length > 0 }
  );

  return (
    // Framer-motion animations on the public page (menus, sheets, catalogue) follow the visitor's
    // "reduce motion" setting; the CSS entrance animations are covered in globals.css.
    <MotionConfig reducedMotion="user">
    <main
      className={`relative flex flex-col items-center pb-10 ${preview ? "min-h-full" : "min-h-screen"}`}
      style={pageStyle}
    >
      {/* Keyboard / screen-reader shortcut past the header controls; invisible until it is focused. Not
          rendered in the editor's preview, where there is no page to skip within. */}
      {!preview && (
        <a
          href="#profile-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-full focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[#14202B] focus:shadow-lg"
        >
          {t.profilePage.skipToContent}
        </a>
      )}
      {!preview && <RegisterServiceWorker />}
      {!preview && <AppBadgeReset />}

      {/* Pixel base code — deliberately held back until `visitorId` is
          set (client-only, see the effect above) so the very first
          PageView already carries external_id, rather than firing once
          without it and never getting a second chance at that visitor's
          first-touch event. fbPixelId/ttPixelId are pre-validated
          (isValidFacebookPixelId/isValidTiktokPixelId) — only ever a
          plain numeric/alphanumeric id ever reaches this inline script,
          since profile.facebook_pixel_id/tiktok_pixel_id are otherwise
          creator-controlled free text. */}
      {visitorId && fbPixelId && pageViewEventId && (
        <>
          <Script
            id="meta-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${fbPixelId}', {external_id:'${visitorId}'});
fbq('track', 'PageView', {}, {eventID: '${pageViewEventId}'});
`,
            }}
          />
          <noscript>
            <img
              height={1}
              width={1}
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${fbPixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      )}
      {visitorId && ttPixelId && (
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<e.length;n++)ttq.setAndDefer(e,e[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
  ttq.load('${ttPixelId}', {external_id:'${visitorId}'});
  ttq.page();
}(window, document, 'ttq');
`,
          }}
        />
      )}

      {isMusic ? (
        <MusicArtistView
          profile={profile}
          accent={accent}
          preview={preview}
          isOwner={isOwner}
          staffBadges={staffBadges}
          playback={{ playingId, progress, togglePlay }}
          logClick={logClick}
          data={{
            tracks: musicTracks,
            releases,
            events: musicEvents,
            products: catalogProducts,
            links: publicLinks,
            socials: socialLinks,
            hasTicketing,
            supportEnabled,
            pinnedItem,
            showPinnedSupport,
            latestRelease,
          }}
        />
      ) : (
      <>
      {/* Cover photo — falls back to a soft accent-tinted gradient when
          the creator hasn't uploaded one, rather than an empty/broken area.
          The image/gradient sit in their own clipped inner layer so the
          share button's dropdown (taller than this whole box) can still
          extend past it instead of being cut off by overflow-hidden. */}
      <div className={`relative w-full shrink-0 ${COVER_HEIGHT[stage.cover]}`}>
        <div className="absolute inset-0 overflow-hidden">
          {profile.cover_image_url ? (
            <OptImg src={profile.cover_image_url} widths={[480, 768, 1280]} sizes="100vw" priority className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: `linear-gradient(135deg, ${hexToRgba(accent, 0.35)}, ${bgColor})` }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(to bottom, transparent 35%, ${bgColor} 92%)` }}
          />
        </div>

        {!preview && (
          // z-20, not z-10 — this wrapper and the avatar section just
          // below (also position:absolute + z-index, so each is its own
          // stacking context) are siblings; equal z-index would mean the
          // avatar section wins ties (it's later in the DOM) and paints
          // over this share dropdown regardless of the dropdown's own
          // internal z-index, since that only resolves stacking *within*
          // this wrapper's context, not against the sibling.
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            {/* Only ever renders for a returning visitor this browser
                already recognizes as a member of THIS profile's
                community — see the component's own comment. Sits beside
                ShareButton rather than replacing it: everyone (recognized
                or not) keeps the same share affordance they already had. */}
            <FanRecognitionHeader
              username={profile.username}
              creatorName={profile.name || profile.username}
              accent={accent}
              isOwner={isOwner}
            />
            <PublicLanguageSelector variant="glass" accent={accent} />
            <ShareButton
              accent={accent}
              title={profile.name || profile.username}
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

      <div className="relative z-10 flex flex-col items-center px-4 -mt-16 w-full">
        <div className={`relative animate-fade-up ${stage.avatar === "ring" ? "mb-4" : ""}`}>
          {squareAvatar && stage.avatar === "ring" && (
            // A square picture gets a soft square halo in the creator's accent in place of the circular Ring (which only belongs around a circle).
            <span aria-hidden="true" className={`pointer-events-none absolute -inset-3 border-[1.5px] opacity-80 ${avatarRadius("square", "hero")}`} style={{ borderColor: accent }} />
          )}
          {!squareAvatar && stage.avatar === "ring" && (
            // The Ringo ring, open with its node, in the creator's own accent: a still signature of connection around who they are
            // (decorative, hidden from assistive technology).
            <Ring
              size={188}
              state="idle"
              weight="fine"
              color={accent}
              className="pointer-events-none absolute -inset-9 h-[calc(100%+4.5rem)] w-[calc(100%+4.5rem)] opacity-90"
            />
          )}
          {stage.avatar === "pulse" && (
            // Subtle pulsing glow: the same ring-pulse signature used on the auth pages, scaled down and tinted to the creator's own
            // accent color rather than the fixed brand palette.
            <>
              <span
                className={`absolute inset-0 ${avatarRadius(avatarShape, "hero")} animate-ring-pulse-1 motion-reduce:animate-none pointer-events-none`}
                style={{ border: `2px solid ${accent}` }}
              />
              <span
                className={`absolute inset-0 ${avatarRadius(avatarShape, "hero")} animate-ring-pulse-2 motion-reduce:animate-none pointer-events-none`}
                style={{ border: `2px solid ${accent}` }}
              />
            </>
          )}
          <OptImg
            src={profile.avatar_url || "/default-avatar.png"}
            alt={profile.name}
            widths={[160, 320, 480]}
            sizes="(min-width: 640px) 160px, 144px"
            square
            priority
            className={`relative w-36 h-36 sm:w-40 sm:h-40 object-cover ${squareAvatar ? AVATAR_IMAGE[stage.avatar].replace(/rounded-(full|ringo-lg)/, avatarRadius("square", "hero")) : AVATAR_IMAGE[stage.avatar]}`}
            style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.85), backgroundColor: bgColor }}
          />
        </div>

        <h1
          className={`font-display text-2xl sm:text-3xl font-bold tracking-tight ${NAME_CASE[stage.name]} mt-3 text-center animate-fade-up flex items-center justify-center gap-1.5 max-w-full`}
          style={{ animationDelay: "80ms" }}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {firstName} {restName && <span style={{ color: accent }}>{restName}</span>}
          </span>
          {isVerified && (
            <BadgeCheck
              size={20}
              className="shrink-0 -mt-0.5"
              style={{ color: "#3B82F6", fill: "#3B82F6", stroke: bgColor }}
              aria-label={t.profilePage.verifiedBadge}
            >
              <title>{t.profilePage.verifiedBadge}</title>
            </BadgeCheck>
          )}
        </h1>

        {/* Demo accounts (see supabase/migrations/2026-10-13_demo_accounts.sql)
            render a real-looking live preview so the "try it" experience
            feels real — this badge is what keeps a real visitor from ever
            mistaking one for an actual business. Deliberately a fixed
            warning color, not the page's own accent, so it stays visible
            and unmistakable regardless of the demo's chosen theme. */}
        {profile.is_demo && (
          <div
            className="mt-2 px-3 py-1 rounded-full text-xs font-semibold animate-fade-up"
            style={{ backgroundColor: "#F59E0B", color: "#111827", animationDelay: "120ms" }}
          >
            {t.demo.publicBadge}
          </div>
        )}

        {isMusic && getMusicRole(profile.music_role) && (
          // What kind of artist this is (Artist, DJ, Producer, Band...): a quiet, bordered label in the artist's accent, instead of the music-note emoji
          // that used to follow the name. Stated as fact, so it is not a button.
          <p
            className="mt-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold animate-fade-up"
            style={{ borderColor: hexToRgba(accent, 0.45), color: accent, animationDelay: "110ms" }}
          >
            {getMusicRole(profile.music_role)!.label[locale]}
          </p>
        )}

        {profile.bio && (
          <p
            className="text-sm mt-1 text-center max-w-xs animate-fade-up"
            style={{ opacity: 0.75, animationDelay: "140ms" }}
          >
            {profile.bio}
          </p>
        )}

        {profile.about_location && (
          <div
            className="flex items-center gap-1.5 mt-2 text-sm animate-fade-up"
            style={{ color: accent, animationDelay: "180ms" }}
          >
            <MapPin size={14} />
            {profile.about_location}
          </div>
        )}

        {staffBadges.length > 0 && (
          // Deliberately plain, bordered outline pills — not a filled
          // accent-colored button like the rest of this page's CTAs — so
          // this reads as "current role, stated as fact" rather than
          // something the creator added to their own links/catalog. Each
          // links straight through to that business's own public profile.
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3 animate-fade-up" style={{ animationDelay: "200ms" }}>
            {staffBadges.map((badge) => (
              <a
                key={badge.orgUsername}
                href={`/${badge.orgUsername}`}
                className="flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full border text-xs font-medium transition hover:opacity-75"
                style={{ borderColor: hexToRgba(accent, 0.35), color: accent }}
              >
                <img
                  src={badge.orgAvatarUrl || "/default-avatar.png"}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                  style={{ backgroundColor: bgColor }}
                />
                {t.profilePage.staffBadge(badge.roleName, badge.orgName)}
              </a>
            ))}
          </div>
        )}

        {profile.about_long_bio && (
          <p
            className="text-sm mt-3 text-center max-w-md leading-relaxed animate-fade-up"
            style={{ opacity: 0.85, animationDelay: "220ms" }}
          >
            {profile.about_long_bio}
          </p>
        )}

        {isRestaurant ? (
          <RestaurantHeroButtons
            t={t}
            profile={profile}
            username={profile.username}
            whatsappNumber={profile.whatsapp_number}
            aboutLocation={profile.about_location}
            accent={accent}
            locale={locale}
            radiusClass={radiusClass}
          />
        ) : isMusic ? (
          // Music gets Book Now / Buy Now up top (the two commerce entry
          // points this category now has) plus the same WhatsApp/Call/Save
          // row as before, all bundled inside MusicHeroButtons — every
          // other category keeps the original theme-driven, evenly-
          // stretched three-button row unchanged below.
          <MusicHeroButtons t={t} profile={profile} accent={accent} textColor={textColor} locale={locale} radiusClass={radiusClass} />
        ) : (
          genericHero && (
            <GenericHeroActions
              t={t}
              hero={genericHero}
              profile={profile}
              accent={accent}
              textColor={textColor}
              radiusClass={radiusClass}
              buttonStyle={linkButtonStyle}
              onWhatsappClick={() => logClick("whatsapp", undefined, { name: "WhatsApp" })}
              onLinkClick={(id, title) => logClick("link", id, { name: title })}
            />
          )
        )}

        {socialLinks.length > 0 && (
          <div
            className="flex flex-wrap justify-center gap-2.5 mt-5 animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            {socialLinks.map((s: any) => (
              <SocialIcon key={s.id} platform={s.platform} url={s.url} themed />
            ))}
          </div>
        )}

        <div
          id={preview ? undefined : "profile-content"}
          tabIndex={preview ? undefined : -1}
          className={`w-full max-w-md lg:max-w-xl mt-6 flex flex-col gap-6 animate-fade-up focus:outline-none ${panel ? panel.className : ""} ${HEADINGS[stage.headings]}`}
          style={{
            animationDelay: "340ms",
            ...(panel ? { backgroundColor: panel.background, color: panel.text } : {}),
          }}
        >
          {/* "＋ Connect" — the universal customer ↔ profile action (see src/components/connect/). It sits at the
              TOP of the page content, just under the hero, inside #profile-content so the skip link still reaches
              it. Always shown, independent of profiles.community_enabled; the legacy Community join page
              (/[username]/community) still exists for old shared links but is no longer linked from here.
              Rendered ONCE: as a quiet pill under the hero's own buttons, or — for a generic profile with no other
              action to offer — as its full-width primary button. Hidden for the owner viewing their own live page
              (the hero above adds no gap for it); inert inside the dashboard preview. */}
          {!isOwner && (
            <ConnectButton
              profile={{ id: profile.id, name: profile.name || profile.username }}
              accent={accent}
              radiusClass={radiusClass}
              buttonStyle={panelButtonStyle}
              borderTint={contentBorderTint}
              textColor={contentTextColor}
              preview={preview}
              variant={genericHero?.primary.kind === "connect" ? "primary" : "compact"}
            />
          )}

          {(pinnedItem || showPinnedSupport) && (
            <PinnedSpotlight
              t={t}
              type={profile.pinned_type}
              item={pinnedItem}
              artistName={profile.name || ""}
              avatarUrl={profile.avatar_url}
              supportMessage={profile.support_message}
              accent={accent}
              buttonStyle={linkButtonStyle}
              radiusClass={radiusClass}
              currency={profile.currency || "USD"}
              whatsappNumber={profile.whatsapp_number}
              username={profile.username}
              playingId={playingId}
              onTogglePlay={togglePlay}
            />
          )}

          {latestRelease && stage.player && (
            <LatestReleaseFeature
              t={t}
              latest={latestRelease}
              artistName={profile.name || ""}
              accent={accent}
              buttonStyle={linkButtonStyle}
              radiusClass={radiusClass}
              player={stage.player}
              currency={profile.currency || "USD"}
              username={profile.username}
              playingId={playingId}
              onTogglePlay={togglePlay}
            />
          )}

          {isRestaurant && (
            <FeaturedMenuSection
              t={t}
              username={profile.username}
              items={menuItems}
              currency={profile.currency || "USD"}
              accent={accent}
              radiusClass={radiusClass}
              borderTint={contentBorderTint}
              fadeColor={panel ? panel.background : profile.background_style === "gradient" ? undefined : bgColor}
            />
          )}

          {isRestaurant && (
            <OpeningHoursRow
              t={t}
              locale={locale}
              hours={profile.opening_hours}
              accent={accent}
              radiusClass={radiusClass}
              borderTint={contentBorderTint}
            />
          )}

          {sectionOrder.map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
          {supportEnabled && (
            <SupportArtistSection
              t={t}
              locale={locale}
              username={profile.username}
              accent={accent}
              textColor={contentTextColor}
              supportMessage={profile.support_message}
              radiusClass={radiusClass}
              borderTint={contentBorderTint}
            />
          )}

          {/* "Add to Home Screen" — entirely separate feature from Stay
              Connected above (no shared state, no consent implied). Never
              rendered in the dashboard's live preview (see `preview`
              above) — a real visitor's install prompt has no business
              firing while the owner is just editing their page. */}
          {!preview && (
            <AddToHomeScreen
              displayName={profile.name || profile.username}
              username={profile.username}
              accent={accent}
              radiusClass={radiusClass}
              buttonStyle={panelButtonStyle}
              borderTint={contentBorderTint}
              textColor={contentTextColor}
            />
          )}
        </div>

        <footer role="contentinfo" className="mt-10 text-center">
          {stage.closingRing && <ConnectionPath accent={accent} line={borderTint} className="mb-6" />}
          <p className="text-xs" style={{ opacity: 0.5 }}>
            © {new Date().getFullYear()} {profile.name}. {t.profilePage.rights}
          </p>
          <PoweredByRingo className="mt-1" />
        </footer>
      </div>
      </>
      )}
    </main>
    </MotionConfig>
  );
}