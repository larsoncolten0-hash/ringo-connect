"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CalendarCheck, ChevronRight, ShoppingBag, ShoppingCart } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import ShareButton from "@/components/ShareButton";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { LOW_INVENTORY_THRESHOLD } from "@/lib/ticketTypes";
import { getCategory } from "@/lib/categories";
import { resolveProductCta } from "@/lib/cta";
import { newEventId } from "@/lib/pixelClient";
import { productHref, productImages } from "./productHref";

// The page a customer lands on from a catalog / merch / service card.
// Mobile-first, editorial: a full-bleed swipeable photo hero with floating
// glass controls, a content sheet that overlaps it, generous type, the
// creator's own theme throughout, related items to keep browsing, and a
// frosted bottom bar that keeps the main action always within reach. On
// large screens the hero and the content sit side by side.
//
// Actions are resolved exactly as they always were for a catalog item:
//   - sold out                       → disabled state
//   - the creator's own link         → opens it (Buy now / View details)
//   - Music profile, no link         → hands off to the storefront checkout
//   - WhatsApp number on the profile → always offered as a direct chat
export default function ProductDetailView({
  profile,
  product,
  related,
  isMusic,
}: {
  profile: any;
  product: any;
  related: any[];
  isMusic: boolean;
}) {
  const { t, locale } = useLanguage();
  // Same label the profile's own catalog section uses ("Services", "Merch"…).
  const catalogLabel = getCategory(profile.category)?.defaults.catalogLabel?.[locale] || t.profilePage.catalogHeading;
  const [expanded, setExpanded] = useState(false);

  const accent = profile.theme_color || (isMusic ? "#F2B705" : "#D4A954");
  // Music & Entertainment's public look is the warm cream content area; every
  // other category follows the creator's own page colors.
  const bg = isMusic ? "#FBF3E7" : profile.background_color || "#0A0A0A";
  const fg = isMusic ? "#1C140C" : profile.text_color || "#FAFAFA";
  const hairline = hexToRgba(fg, 0.12);
  const currency = profile.currency || "USD";
  const username = profile.username;
  const images = productImages(product);
  const soldOut = product.inventory_count === 0;
  const lowStock = typeof product.inventory_count === "number" && product.inventory_count > 0 && product.inventory_count <= LOW_INVENTORY_THRESHOLD;
  const hasPrice = product.price != null && product.price !== "";
  const description: string = product.description || "";
  const longDescription = description.length > 220;
  const whatsappNumber = (profile.whatsapp_number || "").replace(/[^0-9]/g, "");

  // Same fire-and-forget analytics call the profile page makes for a product
  // or WhatsApp click (see ProfileView's logClick) so counts keep working now
  // that these actions live here instead of on the card.
  const track = (targetType: "product" | "whatsapp") => {
    try {
      fetch("/api/track", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          targetType,
          targetId: product.id,
          eventId: newEventId(),
          contentName: product.name,
          value: hasPrice ? Number(product.price) : null,
          currency,
        }),
      }).catch(() => {});
    } catch {
      /* analytics must never break the action */
    }
  };

  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(product.whatsapp_message || `Hi, I'm interested in ${product.name}`)}`
    : null;

  // Creator-chosen wording (products.cta_preset / cta_label) only ever replaces
  // the label text. Where a tap goes is decided by the item's real capability,
  // exactly as before — see src/lib/cta.ts. Both NULL → the existing labels.
  const cta = resolveProductCta({
    category: profile.category,
    isMusic,
    hasLandingUrl: !!product.landing_url,
    bookingEnabled: !!profile.bookings_enabled,
    ctaPreset: product.cta_preset,
    ctaLabel: product.cta_label,
  });
  const ctaLabel = cta.label ? (cta.label.kind === "custom" ? cta.label.text : t.cta.labels[cta.label.id]) : null;

  const primary: { label: string; href: string; external: boolean; icon: any; onClick?: () => void } | null = soldOut
    ? null
    : product.landing_url
    ? {
        label: ctaLabel || (isMusic ? t.music.buyNowLabel : t.profilePage.viewDetails),
        href: product.landing_url,
        external: true,
        icon: ArrowUpRight,
        onClick: () => track("product"),
      }
    : isMusic
    ? { label: ctaLabel || t.music.shopMerch, href: `/m/${username}?add=merch:${product.id}`, external: false, icon: ShoppingCart }
    : ctaLabel && cta.destination === "booking_page"
    ? { label: ctaLabel, href: `/${username}/book`, external: false, icon: CalendarCheck }
    : null;

  const shareStrings = {
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
  };

  const hasBar = !!primary || !!whatsappHref || soldOut;

  return (
    <div className="min-h-screen" style={{ backgroundColor: bg, color: fg }}>
      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-2 lg:items-start lg:gap-12 lg:px-8 lg:pt-8">
        {/* ——— Hero ——— */}
        <div className="relative lg:sticky lg:top-8">
          <HeroGallery images={images} alt={product.name} accent={accent} fg={fg} />

          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4 lg:p-4">
            <Link
              href={`/${username}`}
              aria-label={t.music.backToProfile}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white backdrop-blur-md transition active:scale-90"
              style={{ backgroundColor: "rgba(15,15,20,0.42)" }}
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="rounded-full p-0.5 backdrop-blur-md" style={{ backgroundColor: "rgba(15,15,20,0.42)" }}>
              <ShareButton accent={accent} title={product.name} strings={shareStrings} />
            </div>
          </div>
        </div>

        {/* ——— Content sheet ——— */}
        <div
          className="relative -mt-7 rounded-t-[32px] px-5 pb-40 pt-7 lg:mt-0 lg:rounded-none lg:px-0 lg:pb-16 lg:pt-2"
          style={{ backgroundColor: bg }}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
              {catalogLabel}
            </span>
            {soldOut ? (
              <Chip bg={hexToRgba(fg, 0.1)} color={fg}>
                {t.music.soldOut}
              </Chip>
            ) : lowStock ? (
              <Chip bg={hexToRgba(accent, 0.14)} color={accent}>
                {t.profilePage.onlyFewLeft(product.inventory_count)}
              </Chip>
            ) : null}
          </div>

          <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[34px]">{product.name}</h1>

          {hasPrice && (
            <p className="mt-3 text-2xl font-semibold tracking-[-0.02em]" style={{ color: accent }} suppressHydrationWarning>
              {formatPrice(product.price, currency, locale)}
            </p>
          )}

          {description && (
            <div className="mt-6">
              <div className="h-px w-full" style={{ backgroundColor: hairline }} />
              <p
                className={`mt-5 whitespace-pre-line text-[15px] leading-[1.7] ${!expanded && longDescription ? "line-clamp-4" : ""}`}
                style={{ opacity: 0.78 }}
              >
                {description}
              </p>
              {longDescription && (
                <button onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm font-semibold" style={{ color: accent }}>
                  {expanded ? t.profilePage.showLess : t.profilePage.readMore}
                </button>
              )}
            </div>
          )}

          {/* Who's behind it — a quiet way back to the whole profile. */}
          <Link
            href={`/${username}`}
            className="mt-8 flex items-center gap-3 rounded-2xl p-3 transition active:scale-[0.99]"
            style={{ border: `1px solid ${hairline}`, backgroundColor: hexToRgba(fg, 0.03) }}
          >
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                style={{ backgroundColor: hexToRgba(accent, 0.16), color: accent }}
              >
                {(profile.name || username)[0]?.toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm font-semibold">
                <span className="truncate">{profile.name || username}</span>
                {profile.verified && <BadgeCheck size={14} className="shrink-0" style={{ color: accent }} />}
              </span>
              <span className="block truncate text-xs" style={{ opacity: 0.55 }}>
                @{username}
              </span>
            </span>
            <ChevronRight size={18} style={{ opacity: 0.45 }} />
          </Link>

          {related.length > 0 && (
            <div className="mt-10">
              <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>
                {t.profilePage.youMayAlsoLike}
              </p>
              <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
                {related.map((r) => {
                  const img = productImages(r)[0];
                  return (
                    <Link
                      key={r.id}
                      href={productHref(username, r.id, isMusic)}
                      className="group w-[148px] shrink-0 snap-start"
                    >
                      <div className="relative aspect-[4/5] overflow-hidden rounded-[18px]" style={{ backgroundColor: hexToRgba(fg, 0.06) }}>
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={r.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: hexToRgba(accent, 0.1) }}>
                            <ShoppingBag size={22} style={{ color: accent }} strokeWidth={1.5} />
                          </div>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-1 text-[13px] font-semibold">{r.name}</p>
                      {r.price != null && r.price !== "" && (
                        <p className="text-xs" style={{ color: accent }} suppressHydrationWarning>
                          {formatPrice(r.price, currency, locale)}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ——— Action bar ——— */}
      {hasBar && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl"
          style={{
            backgroundColor: hexToRgba(bg, 0.82),
            borderTop: `1px solid ${hairline}`,
            paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
          }}
        >
          <div className="mx-auto flex max-w-xl items-center gap-2.5 px-4 pt-3">
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("whatsapp")}
                aria-label="WhatsApp"
                className={`flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold transition active:scale-95 ${primary || soldOut ? "w-12 shrink-0" : "flex-1"}`}
                style={{ border: `1px solid ${hairline}`, color: fg }}
              >
                <FaWhatsapp size={20} style={{ color: "#25D366" }} className="shrink-0" />
                {!(primary || soldOut) && "WhatsApp"}
              </a>
            )}
            {soldOut ? (
              <span
                className="flex h-12 flex-1 items-center justify-center rounded-full text-sm font-semibold"
                style={{ backgroundColor: hexToRgba(fg, 0.08), color: hexToRgba(fg, 0.55) }}
              >
                {t.music.soldOut}
              </span>
            ) : primary ? (
              primary.external ? (
                <a
                  href={primary.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={primary.onClick}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold shadow-lg transition active:scale-[0.98]"
                  style={{ backgroundColor: accent, color: "#111" }}
                >
                  {primary.label}
                  <primary.icon size={17} strokeWidth={2.3} />
                </a>
              ) : (
                <Link
                  href={primary.href}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold shadow-lg transition active:scale-[0.98]"
                  style={{ backgroundColor: accent, color: "#111" }}
                >
                  <primary.icon size={17} strokeWidth={2.3} />
                  {primary.label}
                </Link>
              )
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color }}>
      {children}
    </span>
  );
}

// Full-bleed, swipeable photo hero with a counter and dots. A soft top scrim
// keeps the floating controls readable on any photo. With no photo at all it
// falls back to a tinted panel instead of collapsing.
function HeroGallery({ images, alt, accent, fg }: { images: string[]; alt: string; accent: string; fg: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  const frame = "relative aspect-[4/5] w-full overflow-hidden lg:rounded-[28px]";

  if (images.length === 0) {
    return (
      <div className={`${frame} flex items-center justify-center`} style={{ background: `linear-gradient(145deg, ${hexToRgba(accent, 0.25)}, ${hexToRgba(fg, 0.05)})` }}>
        <ShoppingBag size={46} style={{ color: accent, opacity: 0.8 }} strokeWidth={1.4} />
      </div>
    );
  }

  return (
    <div className={frame}>
      <div ref={trackRef} onScroll={onScroll} className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth">
        {images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src + i} src={src} alt={i === 0 ? alt : ""} className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/35 to-transparent" />
      {images.length > 1 && (
        <>
          <span className="absolute bottom-10 right-4 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-md lg:bottom-4">
            {active + 1} / {images.length}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-10 flex items-center justify-center gap-1.5 lg:bottom-4">
            {images.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: i === active ? 18 : 6, backgroundColor: i === active ? "#fff" : "rgba(255,255,255,0.55)" }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
