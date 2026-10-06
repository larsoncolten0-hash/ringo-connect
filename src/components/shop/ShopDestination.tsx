"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, MapPin, ShoppingBag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import PoweredByRingo from "@/components/PoweredByRingo";
import Rail from "@/components/ui/Rail";
import { getCategory } from "@/lib/categories";
import { formatPrice } from "@/lib/currency";
import { resolveProductCta, resolveDisplayCtaLabel } from "@/lib/cta";
import { checkProductEligibility } from "@/lib/productCheckout/eligibility";
import { productHref, productImages } from "@/components/catalog/productHref";

// The dedicated commercial page of a profile's catalog (/[username]/shop): a storefront, not a dashboard screen. Ringo's own foundation (Indigo on
// Paper) rather than the creator's theme, so every shop and services page reads as one calm, confident product; the creator's identity leads the
// hero. It is category-aware only in its WORDS: the title is the category's own catalog label ("Shop", "Services", "Courses", "Listings"...) and
// each item's button is the same one its own page resolves (src/lib/cta.ts: Buy now, Book now, ...). Nothing here sells, books or charges: every
// card opens the item's own page, where the existing flows live.
//
// Structure: hero (identity) -> one featured item -> a still rail of the newest (only for a bigger catalog) -> the rest as a grid, 12 at a time,
// with a physical / digital filter only when both kinds exist. One item is just the featured card; none is a calm empty state.

const PAGE = 12;

type ShopProfile = {
  username: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  about_location: string | null;
  category: string | null;
  currency: string | null;
  bookings_enabled: boolean;
  is_demo: boolean;
  profile_id: string;
  commerceCheckoutAvailable: boolean;
};

export default function ShopDestination({ profile, products }: { profile: ShopProfile; products: any[] }) {
  const { t, locale } = useLanguage();
  const name = profile.name || profile.username;
  const currency = profile.currency || "USD";
  const label = getCategory(profile.category)?.defaults.catalogLabel?.[locale] || t.profilePage.catalogHeading;
  const [kind, setKind] = useState<"all" | "physical" | "digital">("all");
  const [shown, setShown] = useState(PAGE);

  const sorted = useMemo(() => [...products].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [products]);
  const featured = sorted[0] ?? null;
  const rest = sorted.slice(1);
  // "New" only earns a shelf in a bigger catalog, and only from real creation dates.
  const newest = useMemo(
    () =>
      rest.length >= 5
        ? [...rest].filter((p) => p.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8)
        : [],
    [rest]
  );
  const hasDigital = rest.some((p) => p.product_type === "digital");
  const hasPhysical = rest.some((p) => p.product_type !== "digital");
  const filtered = rest.filter((p) => (kind === "all" ? true : kind === "digital" ? p.product_type === "digital" : p.product_type !== "digital"));

  const cardProps = {
    username: profile.username,
    currency,
    category: profile.category,
    bookingEnabled: profile.bookings_enabled,
    checkoutAvailable: profile.commerceCheckoutAvailable,
    isDemo: profile.is_demo,
  };

  return (
    <div className="min-h-screen bg-ringo-paper text-ringo-stone-900">
      <header className="sticky top-0 z-30 border-b border-ringo-stone-200 bg-ringo-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-1.5">
          <a
            href={`/${profile.username}`}
            className="ringo-tactile -ml-2 inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ringo-stone-700 hover:text-ringo-stone-900"
          >
            <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{t.shopPage.backToProfile(name)}</span>
          </a>
          <PublicLanguageSelector variant="bar" />
        </div>
      </header>

      <main id="shop-content" className="mx-auto flex max-w-5xl flex-col gap-10 px-4 pb-6 pt-5 sm:gap-12 sm:pt-8">
        {/* Hero: who this is and what is on offer */}
        <section aria-labelledby="shop-title" className="animate-fade-up">
          <div className="relative overflow-hidden rounded-[28px] border border-ringo-stone-200 bg-white">
            <div className="relative h-32 w-full sm:h-44" aria-hidden="true">
              {profile.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.cover_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" style={{ background: "linear-gradient(135deg, rgb(var(--ringo-indigo) / 0.16), rgb(var(--ringo-indigo) / 0.04) 60%, transparent)" }} />
              )}
            </div>
            <div className="flex flex-col gap-4 px-5 pb-6 sm:px-8 sm:pb-8">
              <div className="relative z-10 -mt-9 flex items-end justify-between gap-3 sm:-mt-11">
                <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-ringo-indigo/10 text-2xl font-bold text-ringo-indigo shadow-sm sm:h-24 sm:w-24">
                  {profile.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
                  )}
                </span>
                <a
                  href={`/${profile.username}`}
                  className="ringo-tactile inline-flex min-h-[44px] items-center rounded-full border border-ringo-stone-300 px-4 text-sm font-semibold text-ringo-stone-900"
                >
                  {t.shopPage.viewProfile}
                </a>
              </div>
              <div className="flex flex-col gap-2">
                <p className="inline-flex w-fit items-center gap-2 rounded-full bg-ringo-indigo/10 px-3 py-1 text-xs font-semibold text-ringo-indigo">
                  {label}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{t.shopPage.itemsCount(sorted.length)}</span>
                </p>
                <h1 id="shop-title" className="font-display text-3xl font-bold leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-4xl">
                  {name}
                </h1>
                {profile.bio && <p className="max-w-2xl text-[15px] leading-relaxed text-ringo-stone-600 line-clamp-3 [overflow-wrap:anywhere]">{profile.bio}</p>}
                {profile.about_location && (
                  <p className="flex items-center gap-1.5 text-sm text-ringo-stone-600">
                    <MapPin size={14} aria-hidden="true" className="shrink-0" />
                    <span className="[overflow-wrap:anywhere]">{profile.about_location}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {!featured && (
          <section aria-labelledby="shop-empty" className="flex flex-col items-center gap-3 rounded-[28px] border border-dashed border-ringo-stone-300 px-6 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ringo-indigo/10 text-ringo-indigo">
              <ShoppingBag size={22} aria-hidden="true" />
            </span>
            <h2 id="shop-empty" className="font-display text-xl font-bold">{t.shopPage.emptyTitle}</h2>
            <p className="max-w-sm text-sm leading-relaxed text-ringo-stone-600">{t.shopPage.emptyBody(name)}</p>
            <a href={`/${profile.username}`} className="ringo-tactile mt-1 inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-semibold text-white">
              {t.shopPage.viewProfile}
            </a>
          </section>
        )}

        {featured && (
          <section aria-labelledby="shop-featured" className="animate-fade-up" style={{ animationDelay: "80ms" }}>
            <SectionTitle id="shop-featured">{t.shopPage.featured}</SectionTitle>
            <Tile product={featured} featured {...cardProps} />
          </section>
        )}

        {newest.length > 0 && (
          <section aria-labelledby="shop-new">
            <SectionTitle id="shop-new">{t.shopPage.newest}</SectionTitle>
            <Rail label={t.shopPage.newest} prevLabel={t.profilePage.railPrev} nextLabel={t.profilePage.railNext} fade="#FAFAF8">
              {newest.map((p) => (
                <div key={p.id} className="w-[44vw] min-w-[160px] max-w-[210px] sm:w-[210px] sm:max-w-none">
                  <Tile product={p} {...cardProps} />
                </div>
              ))}
            </Rail>
          </section>
        )}

        {rest.length > 0 && (
          <section aria-labelledby="shop-all">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <SectionTitle id="shop-all" className="mb-0">{t.shopPage.allItems}</SectionTitle>
              {hasDigital && hasPhysical && (
                <div role="group" aria-label={t.shopPage.filterLabel} className="flex flex-wrap gap-2">
                  {(["all", "physical", "digital"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => {
                        setKind(k);
                        setShown(PAGE);
                      }}
                      className={`ringo-tactile inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold ${
                        kind === k ? "border-ringo-indigo bg-ringo-indigo text-white" : "border-ringo-stone-300 bg-white text-ringo-stone-700"
                      }`}
                    >
                      {k === "all" ? t.shopPage.filterAll : k === "physical" ? t.shopPage.filterPhysical : t.shopPage.filterDigital}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5 lg:grid-cols-4">
              {filtered.slice(0, shown).map((p) => (
                <li key={p.id} className="flex min-w-0 flex-col [&>a]:flex-1">
                  <Tile product={p} {...cardProps} />
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-stone-300 bg-white px-6 text-sm font-semibold"
                >
                  {t.profilePage.showMoreItems(Math.min(PAGE, filtered.length - shown))}
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="px-4 pb-10 pt-4 text-center text-ringo-stone-600">
        <PoweredByRingo />
      </footer>
    </div>
  );
}

function SectionTitle({ id, children, className = "mb-4" }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`font-display text-xl font-bold tracking-[-0.01em] ${className}`}>
      {children}
    </h2>
  );
}

// One item. The whole card is the link to the item's own page; the visible button only says what that page offers (Buy now, Book now...) using the
// same resolver the page uses, so card and page never disagree. Photo, name, a short line, price, availability. Without a photo the card shows a
// quiet tinted placeholder, never a broken image.
function Tile({
  product,
  featured = false,
  username,
  currency,
  category,
  bookingEnabled,
  checkoutAvailable,
  isDemo,
}: {
  product: any;
  featured?: boolean;
  username: string;
  currency: string;
  category: string | null;
  bookingEnabled: boolean;
  checkoutAvailable: boolean;
  isDemo: boolean;
}) {
  const { t } = useLanguage();
  const images = productImages(product);
  const soldOut = product.inventory_count === 0;
  const few = typeof product.inventory_count === "number" && product.inventory_count > 0 && product.inventory_count <= 5;
  const hasPrice = product.price != null && product.price !== "";

  const cta = resolveProductCta({
    category,
    isMusic: false,
    hasLandingUrl: !!product.landing_url,
    bookingEnabled,
    restaurantOrdering: false,
    checkoutAvailable: checkoutAvailable && checkProductEligibility({ product, profileId: product.profile_id, quantity: 1 }) === null,
    currency,
    isDemo,
    ctaPreset: product.cta_preset,
    ctaLabel: product.cta_label,
  });
  const buttonLabel = resolveDisplayCtaLabel(cta, false, { presets: t.cta.labels, buyNow: t.music.buyNowLabel, shopMerch: t.music.shopMerch, viewDetails: t.profilePage.viewItem });
  const accessibleName = [product.name, hasPrice ? formatPrice(product.price, currency) : "", soldOut ? t.music.soldOut : few ? t.profilePage.onlyFewLeft(product.inventory_count) : "", buttonLabel]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(", ");

  const photo = (
    <div className={`relative w-full overflow-hidden rounded-[20px] bg-ringo-stone-100 ${featured ? "aspect-[4/3] md:aspect-auto md:h-full md:min-h-[280px]" : "aspect-[4/5]"}`}>
      {images[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={images[0]} alt="" loading={featured ? "eager" : "lazy"} className={`absolute inset-0 h-full w-full object-cover ${soldOut ? "opacity-60" : ""}`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "linear-gradient(145deg, rgb(var(--ringo-indigo) / 0.14), rgb(var(--ringo-indigo) / 0.04))" }}>
          <ShoppingBag size={featured ? 40 : 28} strokeWidth={1.5} className="text-ringo-indigo opacity-70" aria-hidden="true" />
        </div>
      )}
      {soldOut && (
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-ringo-stone-900">{t.music.soldOut}</span>
      )}
    </div>
  );

  const details = (
    <div className={`flex flex-1 flex-col gap-3 ${featured ? "justify-center p-1 pt-3 md:p-4" : "px-1 pt-3"}`}>
      <div className="flex flex-col gap-1">
        <p className={`font-semibold leading-snug tracking-[-0.01em] [overflow-wrap:anywhere] ${featured ? "font-display text-2xl md:text-3xl" : "line-clamp-2 text-[15px]"}`}>{product.name}</p>
        {product.description && (
          <p className={`leading-relaxed text-ringo-stone-600 [overflow-wrap:anywhere] ${featured ? "line-clamp-3 text-[15px]" : "line-clamp-2 text-xs"}`}>{product.description}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasPrice && (
          <span className={`font-bold tabular-nums ${featured ? "text-xl" : "text-[15px]"}`} suppressHydrationWarning>
            {formatPrice(product.price, currency)}
          </span>
        )}
        {few && <span className="text-xs font-semibold text-ringo-ember-dark">{t.profilePage.onlyFewLeft(product.inventory_count)}</span>}
      </div>
      <span
        aria-hidden="true"
        className={`inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-ringo-indigo px-4 text-sm font-semibold text-white ${featured ? "md:w-fit md:px-7" : "mt-auto"}`}
      >
        {buttonLabel}
        {featured && <ArrowRight size={15} />}
      </span>
    </div>
  );

  return (
    <a
      href={productHref(username, product.id, false)}
      aria-label={accessibleName}
      className={`ringo-lift ringo-lift--flat group flex flex-col rounded-[24px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[rgb(var(--ringo-indigo))] ${
        featured ? "!grid gap-2 rounded-[28px] border border-ringo-stone-200 bg-white p-3 md:grid-cols-2 md:gap-4" : ""
      }`}
    >
      {photo}
      {details}
    </a>
  );
}
