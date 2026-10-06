"use client";

import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShoppingBag } from "lucide-react";
import Rail from "@/components/ui/Rail";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { useLanguage } from "@/components/LanguageProvider";
import { resolveProductCta, resolveDisplayCtaLabel } from "@/lib/cta";
import { checkProductEligibility } from "@/lib/productCheckout/eligibility";
import { productHref, productImages } from "./productHref";

// The public profile's Catalog / Merch / Services section: the DISCOVERY layer, kept short. With four or more items it is a still
// horizontal RAIL of the first eight (the next card always peeking in; nothing about a card moves while it scrolls), and one button,
// worded from the category's own label ("View shop", "View services"), goes to the dedicated commercial page (/[username]/shop; the
// music storefront for a music profile). Fewer items stay a short grid. The profile never expands into a wall of products. The grid is
// an editorial grid: one large feature card up top, then
// portrait cards two-up — big photography, a frosted price tag, a real
// labeled button (not just an arrow), soft rounded corners, a gentle
// fade-up as each card enters view. Every card opens the item's own detail
// page (see ProductDetailView); the buy/WhatsApp actions live there, not
// crammed onto a half-width card — the card's own button leads there too,
// same destination as tapping the card itself, just an explicit, visible
// call to action instead of an icon-only affordance.
export default function CatalogSection({
  label,
  products,
  username,
  currency,
  isMusic,
  accent,
  accentText,
  textColor,
  borderTint,
  squareCorners,
  buttonStyle,
  radiusClass,
  category,
  bookingEnabled,
  restaurantOrdering,
  checkoutAvailable,
  isDemo,
  preview,
  fadeColor,
  onOpen,
}: {
  label: string;
  products: any[];
  username: string;
  currency: string;
  isMusic: boolean;
  accent: string;
  /** The accent as TEXT on this section's surface (a legible tone of it on a light panel). Defaults to the accent itself. */
  accentText?: string;
  textColor: string;
  borderTint: string;
  squareCorners: boolean;
  // The profile's own themed button treatment (see getButtonStyle/
  // getRadiusClass in ProfileView.tsx) — reused here so the card's CTA
  // matches every other button on the page, not a one-off style.
  buttonStyle: CSSProperties;
  radiusClass: string;
  // Everything below is exactly what the item's own detail page (ProductDetailView.tsx) already
  // resolves its own primary button from (src/lib/cta.ts) — passed through here so the card's
  // button shows the SAME text (Buy Now / Book Now / Shop Now / etc.) as what tapping through to
  // that page actually shows, never a generic "View" that doesn't say what the button does.
  category?: string | null;
  bookingEnabled?: boolean;
  restaurantOrdering?: boolean;
  checkoutAvailable?: boolean;
  isDemo?: boolean;
  // Inside the dashboard editor's live preview, cards shouldn't navigate away.
  preview?: boolean;
  /** The flat surface colour behind this section, for the rail's edge fades (omit on a gradient background). */
  fadeColor?: string;
  onOpen: (product: any) => void;
}) {
  const { t } = useLanguage();
  // Where "view all" leads: a music profile's storefront, otherwise the profile's dedicated shop / services page.
  const storeHref = isMusic ? `/m/${username}` : `/${username}/shop`;
  const sorted = [...products].sort((a, b) => a.sort_order - b.sort_order);
  const asRail = sorted.length >= 4;
  const railItems = sorted.slice(0, 8);
  // Inside the dashboard editor's live preview nothing navigates away.
  const goStore = preview ? (e: React.MouseEvent) => e.preventDefault() : undefined;

  return (
    <section id="merch" className="flex flex-col gap-4 scroll-mt-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ opacity: 0.7 }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
            {label}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ backgroundColor: hexToRgba(accent, 0.12), color: accentText || accent }}
          >
            {sorted.length}
          </span>
          <a
            href={storeHref}
            onClick={goStore}
            aria-label={asRail ? t.profilePage.viewAllAria(label, sorted.length) : undefined}
            className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold"
            style={{ borderColor: borderTint, color: textColor }}
          >
            {t.profilePage.viewAll(label)}
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="h-px w-full" style={{ backgroundColor: borderTint }} />

      {asRail ? (
        <Rail label={label} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade={fadeColor}>
          {railItems.map((product, i) => (
            <div key={product.id} className="w-[41vw] min-w-[146px] max-w-[190px] sm:w-[200px] sm:max-w-none">
              <ProductCard
                product={product}
                featured={false}
                index={i}
                href={productHref(username, product.id, isMusic)}
                currency={currency}
                accent={accent}
                textColor={textColor}
                squareCorners={squareCorners}
                buttonStyle={buttonStyle}
                radiusClass={radiusClass}
                category={category}
                isMusic={isMusic}
                bookingEnabled={bookingEnabled}
                restaurantOrdering={restaurantOrdering}
                checkoutAvailable={checkoutAvailable}
                isDemo={isDemo}
                preview={preview}
                inRail
                onOpen={() => onOpen(product)}
              />
            </div>
          ))}
          {sorted.length > railItems.length && (
            <a
              href={storeHref}
              onClick={goStore}
              aria-label={t.profilePage.viewAllAria(label, sorted.length)}
              className="ringo-tactile flex w-[41vw] min-w-[146px] max-w-[190px] flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed px-3 text-center sm:w-[200px] sm:max-w-none"
              style={{ borderColor: borderTint, color: textColor, aspectRatio: "4 / 5" }}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(accent, 0.14), color: accentText || accent }}>
                <ArrowRight size={18} aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold">{t.profilePage.viewAll(label)}</span>
              <span className="text-xs tabular-nums" style={{ opacity: 0.6 }}>{sorted.length}</span>
            </a>
          )}
        </Rail>
      ) : (
      <div className="grid grid-cols-2 gap-x-3 gap-y-6">
        {sorted.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            featured={(sorted.length >= 3 && i === 0) || sorted.length === 1}
            index={i}
            href={productHref(username, product.id, isMusic)}
            currency={currency}
            accent={accent}
            textColor={textColor}
            squareCorners={squareCorners}
            buttonStyle={buttonStyle}
            radiusClass={radiusClass}
            category={category}
            isMusic={isMusic}
            bookingEnabled={bookingEnabled}
            restaurantOrdering={restaurantOrdering}
            checkoutAvailable={checkoutAvailable}
            isDemo={isDemo}
            preview={preview}
            onOpen={() => onOpen(product)}
          />
        ))}
      </div>
      )}
    </section>
  );
}

function ProductCard({
  product,
  featured,
  index,
  href,
  currency,
  accent,
  textColor,
  squareCorners,
  buttonStyle,
  radiusClass,
  category,
  isMusic,
  bookingEnabled,
  restaurantOrdering,
  checkoutAvailable,
  isDemo,
  preview,
  inRail = false,
  onOpen,
}: {
  product: any;
  featured: boolean;
  index: number;
  href: string;
  currency: string;
  accent: string;
  textColor: string;
  squareCorners: boolean;
  buttonStyle: CSSProperties;
  radiusClass: string;
  category?: string | null;
  isMusic: boolean;
  bookingEnabled?: boolean;
  restaurantOrdering?: boolean;
  checkoutAvailable?: boolean;
  isDemo?: boolean;
  preview?: boolean;
  /** In a rail the card holds perfectly still: no fade-up when it scrolls into view, no photo zoom, no button lift. */
  inRail?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const images = productImages(product);
  const soldOut = product.inventory_count === 0;
  const radius = squareCorners ? "rounded-lg" : "rounded-[22px]";

  // Same resolver the item's own detail page uses (src/lib/cta.ts) — the card's button always
  // shows real, meaningful wording (Buy Now / Book Now / Shop Now / the creator's own custom text),
  // matching exactly what tapping through to the detail page shows, never a generic "View".
  const cta = resolveProductCta({
    category,
    isMusic,
    hasLandingUrl: !!product.landing_url,
    bookingEnabled: !!bookingEnabled,
    restaurantOrdering: !!restaurantOrdering,
    checkoutAvailable: !!checkoutAvailable && checkProductEligibility({ product, profileId: product.profile_id, quantity: 1 }) === null,
    currency,
    isDemo: !!isDemo,
    ctaPreset: product.cta_preset,
    ctaLabel: product.cta_label,
  });
  const buttonLabel = resolveDisplayCtaLabel(cta, isMusic, { presets: t.cta.labels, buyNow: t.music.buyNowLabel, shopMerch: t.music.shopMerch, viewDetails: t.profilePage.viewItem });

  const body = (
    <div className="ringo-lift ringo-lift--flat">
      <div
        className={`relative overflow-hidden ${radius} ${featured ? "aspect-[16/11]" : "aspect-[4/5]"}`}
        style={{ backgroundColor: hexToRgba(textColor, 0.06) }}
      >
        {images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={images[0]}
            alt={product.name}
            loading="lazy"
            className={`h-full w-full object-cover ${inRail ? "" : "transition-transform duration-700 ease-out group-hover:scale-[1.04]"} ${soldOut ? "opacity-60" : ""}`}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `linear-gradient(145deg, ${hexToRgba(accent, 0.22)}, ${hexToRgba(accent, 0.05)})` }}
          >
            <ShoppingBag size={featured ? 34 : 26} style={{ color: accent, opacity: 0.8 }} strokeWidth={1.5} />
          </div>
        )}

        {/* Soft scrim so the frosted chips stay legible on any photo. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent" />

        {product.price != null && product.price !== "" && (
          <span
            className="absolute bottom-2.5 left-2.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-md"
            style={{ backgroundColor: "rgba(15,15,20,0.5)" }}
            suppressHydrationWarning
          >
            {formatPrice(product.price, currency)}
          </span>
        )}

        {soldOut ? (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 backdrop-blur">
            {t.music.soldOut}
          </span>
        ) : images.length > 1 ? (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-black/40 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-md">
            {t.profilePage.photosCount(images.length)}
          </span>
        ) : null}
      </div>

      <div className="px-1 pt-3 flex flex-col gap-2.5">
        <div>
          <p className={`font-semibold leading-snug tracking-[-0.01em] line-clamp-2 ${featured ? "text-base" : "text-[15px]"}`}>{product.name}</p>
          {product.description && (
            <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ opacity: 0.6 }}>
              {product.description}
            </p>
          )}
        </div>

        {/* A real, labeled button — not just an icon — so it's obvious this
            card can be acted on directly, not only tapped as a whole. Same
            destination as the card itself (the item's detail page): this is
            a second, explicit way in, never a different action. */}
        <span
          aria-hidden
          className={`inline-flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold ${inRail ? "" : "transition-transform duration-300 group-hover:-translate-y-0.5"} ${radiusClass}`}
          style={buttonStyle}
        >
          {buttonLabel}
        </span>
      </div>
    </div>
  );

  // The card link's accessible name keeps what a sighted visitor reads on it: the name, the price, whether it is
  // sold out, and the action the button shows. (The visible button is aria-hidden, so it is named here.)
  const hasPrice = product.price != null && product.price !== "";
  const accessibleName = [product.name, hasPrice ? formatPrice(product.price, currency) : "", soldOut ? t.music.soldOut : "", buttonLabel]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(", ");

  const motionProps = reduceMotion || inRail
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-40px" },
        transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const, delay: Math.min(index, 4) * 0.05 },
      };

  const cls = `group block ${featured ? "col-span-2" : ""}`;

  return preview ? (
    <motion.div className={cls} {...motionProps}>
      {body}
    </motion.div>
  ) : (
    <motion.a href={href} onClick={onOpen} className={cls} aria-label={accessibleName} {...motionProps}>
      {body}
    </motion.a>
  );
}
