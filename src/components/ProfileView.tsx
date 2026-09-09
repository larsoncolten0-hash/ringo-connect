"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Copy, Check, MapPin, ChevronRight, ChevronDown, ShoppingBag, Mail, Phone, Clock, BadgeCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory, getMusicRole, profileHasCategory } from "@/lib/categories";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { getButtonStyle, getRadiusClass, getBackgroundStyle } from "@/lib/theme";
import { ensureVisitorId, captureTtclid, newEventId } from "@/lib/pixelClient";
import { metaEventName, tiktokEventName, isValidFacebookPixelId, isValidTiktokPixelId } from "@/lib/pixelEvents";
import WhatsAppButton from "./WhatsAppButton";
import CallButton from "./CallButton";
import SaveContactButton from "./SaveContactButton";
import SocialIcon from "./SocialIcon";
import MusicSection from "./music/MusicSection";
import EventsSection from "./music/EventsSection";
import SupportArtistSection from "./music/SupportArtistSection";
import PinnedSpotlight from "./music/PinnedSpotlight";
import { useTrackPlayback } from "./music/useTrackPlayback";

export default function ProfileView({
  profile,
  pixelsEnabled,
  pageViewEventId,
  preview = false,
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
}) {
  const { t, locale } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [showCatalog, setShowCatalog] = useState(true);
  const catalogLabel = getCategory(profile.category)?.defaults.catalogLabel?.[locale] || t.profilePage.catalogHeading;
  const isMusic = profileHasCategory(profile, "music_entertainment");
  const musicTracks: any[] = profile.tracks || [];
  const musicEvents: any[] = profile.events || [];
  const musicSectionTitle = getMusicRole(profile.music_role)?.sectionLabel[locale] || t.music.tracksTitleFallback;
  const supportEnabled = isMusic && profile.hub_support_enabled !== false && !!profile.whatsapp_number;
  const { playingId, togglePlay } = useTrackPlayback();

  // Resolved from whichever list actually matches pinned_type — never
  // trusts pinned_id blindly, so a deleted item (or one that predates
  // this feature and has stale/mismatched data) just quietly means no
  // spotlight renders, instead of a crash.
  const pinnedSource =
    profile.pinned_type === "track" ? musicTracks : profile.pinned_type === "product" ? profile.products || [] : profile.pinned_type === "event" ? musicEvents : [];
  const pinnedItem = isMusic && profile.pinned_id ? pinnedSource.find((x: any) => x.id === profile.pinned_id) : null;
  const isVerified = !!profile.verified;

  // Populated client-side only (cookies aren't readable during SSR) —
  // the Meta/TikTok Pixel scripts below stay unrendered until this is
  // set, so `external_id` is always present on the very first PageView
  // rather than trickling in on a later event.
  const [visitorId, setVisitorId] = useState<string | null>(null);
  useEffect(() => {
    setVisitorId(ensureVisitorId());
    captureTtclid();
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (older browsers, non-HTTPS) — fail silently
      // rather than showing an error for a non-critical convenience feature.
    }
  };

  const accent = profile.theme_color || "#D4A954";
  const textColor = profile.text_color || "#FAFAFA";
  const bgColor = profile.background_color || "#0A0A0A";
  const radiusClass = getRadiusClass(profile.button_radius || "rounded");
  const linkButtonStyle = getButtonStyle(profile.button_style || "outline", accent);
  const borderTint = hexToRgba(textColor, 0.12);

  // The public page is the creator's brand, not app chrome — it renders
  // with exactly the colors they chose, independent of the visitor's own
  // dark mode preference (unlike the dashboard, which does follow it).
  const pageStyle = {
    ...getBackgroundStyle(profile.background_style || "solid", bgColor, profile.background_gradient_end),
    color: textColor,
    ["--theme" as any]: accent,
  };

  // First word gets the page's default text color, the rest picks up the
  // accent — matches the two-tone name treatment in the reference design.
  // A single-word name just renders plain, no accent applied to nothing.
  const nameParts = (profile.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const restName = nameParts.slice(1).join(" ");

  return (
    <main
      className={`relative flex flex-col items-center pb-10 ${preview ? "min-h-full" : "min-h-screen"}`}
      style={pageStyle}
    >
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

      {/* Cover photo — falls back to a soft accent-tinted gradient when
          the creator hasn't uploaded one, rather than an empty/broken area. */}
      <div className="relative w-full h-52 sm:h-60 overflow-hidden shrink-0">
        {profile.cover_image_url ? (
          <img src={profile.cover_image_url} alt="" className="w-full h-full object-cover" />
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

        {!preview && (
          <button
            onClick={copyLink}
            aria-label="Copy link to this page"
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center transition z-10"
            style={{ backgroundColor: "rgba(255,255,255,0.7)", color: accent }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
        <AnimatePresence>
          {!preview && copied && (
            <motion.span
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="absolute top-14 right-4 text-xs px-2.5 py-1 rounded-full z-10"
              style={{ backgroundColor: "rgba(255,255,255,0.9)", color: accent }}
            >
              {t.profilePage.linkCopied}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex flex-col items-center px-4 -mt-16 w-full">
        <div className="relative animate-fade-up">
          {/* Subtle pulsing glow — the same ring-pulse signature used on
              the auth pages, scaled down and tinted to the creator's own
              accent color rather than the fixed brand palette. */}
          <span
            className="absolute inset-0 rounded-full animate-ring-pulse-1 pointer-events-none"
            style={{ border: `2px solid ${accent}` }}
          />
          <span
            className="absolute inset-0 rounded-full animate-ring-pulse-2 pointer-events-none"
            style={{ border: `2px solid ${accent}` }}
          />
          <img
            src={profile.avatar_url || "/default-avatar.png"}
            alt={profile.name}
            className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full object-cover ring-4"
            style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.85), backgroundColor: bgColor }}
          />
        </div>

        <h1
          className="font-display text-2xl sm:text-3xl font-bold tracking-tight uppercase mt-3 text-center animate-fade-up flex items-center gap-1.5"
          style={{ animationDelay: "80ms" }}
        >
          {firstName} {restName && <span style={{ color: accent }}>{restName}</span>}
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

        {profile.about_long_bio && (
          <p
            className="text-sm mt-3 text-center max-w-md leading-relaxed animate-fade-up"
            style={{ opacity: 0.85, animationDelay: "220ms" }}
          >
            {profile.about_long_bio}
          </p>
        )}

        {profile.whatsapp_number && (
          <div className="flex gap-3 mt-5 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
            {/* All three share flex-1 so the row stays balanced now that
                it holds three CTAs instead of two — WhatsApp previously
                sized to its own (wider) content, which would crowd out
                Save/Call on a narrow phone screen. */}
            <div className="flex-1">
              <WhatsAppButton
                number={profile.whatsapp_number}
                message={profile.default_whatsapp_message}
                radiusClass={radiusClass}
                buttonStyle={linkButtonStyle}
                onClick={() => logClick("whatsapp", undefined, { name: "WhatsApp" })}
              />
            </div>
            <div className="flex-1">
              <CallButton
                number={profile.whatsapp_number}
                radiusClass={radiusClass}
                buttonStyle={linkButtonStyle}
              />
            </div>
            <div className="flex-1">
              <SaveContactButton profile={profile} radiusClass={radiusClass} buttonStyle={linkButtonStyle} />
            </div>
          </div>
        )}

        {profile.social_links?.length > 0 && (
          <div
            className="flex flex-wrap justify-center gap-2.5 mt-5 animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            {profile.social_links.map((s: any) => (
              <SocialIcon key={s.id} platform={s.platform} url={s.url} themed />
            ))}
          </div>
        )}

        <div className="w-full max-w-md mt-6 flex flex-col gap-6 animate-fade-up" style={{ animationDelay: "340ms" }}>
          {pinnedItem && (
            <PinnedSpotlight
              t={t}
              type={profile.pinned_type}
              item={pinnedItem}
              artistName={profile.name || ""}
              accent={accent}
              buttonStyle={linkButtonStyle}
              currency={profile.currency || "USD"}
              whatsappNumber={profile.whatsapp_number}
              playingId={playingId}
              onTogglePlay={togglePlay}
            />
          )}

          {(() => {
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
                style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}
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
                        <p className="text-base font-bold" style={{ color: accent }}>
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
                    <div className="h-px w-full mb-4" style={{ backgroundColor: borderTint }} />
                  )}

                  {contactRows.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
                      {contactRows.map((item) => {
                        const inner = (
                          <>
                            <item.icon size={15} style={{ color: accent }} className="shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
                                {item.label}
                              </p>
                              <p className="text-sm font-medium truncate">{item.value}</p>
                            </div>
                          </>
                        );
                        return item.href ? (
                          <a
                            key={`${item.label}-${item.value}`}
                            href={item.href}
                            className="flex items-start gap-2.5 transition hover:opacity-75"
                          >
                            {inner}
                          </a>
                        ) : (
                          <div key={`${item.label}-${item.value}`} className="flex items-start gap-2.5">
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {isMusic && (
            <MusicSection
              t={t}
              title={musicSectionTitle}
              tracks={musicTracks}
              artistName={profile.name || ""}
              accent={accent}
              radiusClass={radiusClass}
              borderTint={borderTint}
              currency={profile.currency || "USD"}
              whatsappNumber={profile.whatsapp_number}
              playingId={playingId}
              onTogglePlay={togglePlay}
            />
          )}

          {profile.links?.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
                {t.profilePage.linksHeading}
              </p>
              {profile.links
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((link: any) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => logClick("link", link.id, { name: link.title })}
                    className={`flex items-center gap-3 p-3 transition hover:brightness-95 hover:-translate-y-0.5 active:scale-[0.98] active:brightness-90 ${radiusClass}`}
                    style={linkButtonStyle}
                  >
                    {link.image_url && (
                      <img src={link.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{link.title}</p>
                      {link.description && (
                        <p className="text-xs line-clamp-2 mt-0.5" style={{ opacity: 0.7 }}>
                          {link.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="shrink-0" style={{ opacity: 0.6 }} />
                  </a>
                ))}
            </div>
          )}

          {profile.products?.length > 0 && (
            <div id="merch" className="flex flex-col gap-3 scroll-mt-6">
              <button
                onClick={() => setShowCatalog((v) => !v)}
                className={`flex items-center justify-between p-3.5 transition active:scale-[0.98] ${radiusClass}`}
                style={{
                  border: `1px solid ${borderTint}`,
                  backgroundColor: showCatalog ? hexToRgba(accent, 0.08) : "transparent",
                }}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingBag size={16} style={{ color: accent }} />
                  {catalogLabel}
                  <span style={{ opacity: 0.5 }}>({profile.products.length})</span>
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${showCatalog ? "rotate-180" : ""}`}
                  style={{ opacity: 0.6 }}
                />
              </button>

              <AnimatePresence initial={false}>
                {showCatalog && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      {profile.products
                        .sort((a: any, b: any) => a.sort_order - b.sort_order)
                        .map((product: any) => (
                          <div
                            key={product.id}
                            className={`overflow-hidden transition hover:-translate-y-0.5 ${radiusClass}`}
                            style={{ border: `1px solid ${borderTint}` }}
                          >
                            {product.image_url && (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-full aspect-square object-cover"
                              />
                            )}
                            <div className="p-3">
                              <p className="text-sm font-semibold truncate">{product.name}</p>
                              {product.price && (
                                <p
                                  className="text-sm font-bold mt-0.5"
                                  style={{ color: accent }}
                                  suppressHydrationWarning
                                >
                                  {formatPrice(product.price, profile.currency)}
                                </p>
                              )}
                              {/* Full-width, stacked CTAs — the old side-by-side
                                  tiny icon buttons were cramped on a phone-width
                                  half-grid card; a real tap target beats a
                                  compact one here. */}
                              <div className="flex flex-col gap-1.5 mt-2.5">
                                {product.landing_url && (
                                  <a
                                    href={product.landing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() =>
                                      logClick("product", product.id, {
                                        name: product.name,
                                        price: product.price ? Number(product.price) : null,
                                        currency: profile.currency,
                                      })
                                    }
                                    className={`flex items-center justify-center gap-1.5 text-xs font-medium py-2 transition hover:brightness-95 active:scale-[0.97] ${radiusClass}`}
                                    style={{ border: `1px solid ${borderTint}` }}
                                  >
                                    <ExternalLink size={12} />
                                    {t.profilePage.viewDetails}
                                  </a>
                                )}
                                <WhatsAppButton
                                  number={profile.whatsapp_number}
                                  message={product.whatsapp_message || `Hi, I'm interested in ${product.name}`}
                                  radiusClass={radiusClass}
                                  buttonStyle={linkButtonStyle}
                                  onClick={() => logClick("whatsapp", product.id, { name: product.name })}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {isMusic && (
            <EventsSection
              t={t}
              events={musicEvents}
              accent={accent}
              buttonStyle={linkButtonStyle}
              radiusClass={radiusClass}
              borderTint={borderTint}
              whatsappNumber={profile.whatsapp_number}
            />
          )}

          {supportEnabled && (
            <SupportArtistSection
              t={t}
              locale={locale}
              whatsappNumber={profile.whatsapp_number}
              accent={accent}
              textColor={textColor}
              buttonStyle={linkButtonStyle}
              radiusClass={radiusClass}
              borderTint={borderTint}
            />
          )}
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs" style={{ opacity: 0.5 }}>
            © {new Date().getFullYear()} {profile.name}. All rights reserved.
          </p>
          <p className="text-xs mt-1" style={{ opacity: 0.4 }}>
            Made with Ringo Connect
          </p>
        </div>
      </div>
    </main>
  );
}