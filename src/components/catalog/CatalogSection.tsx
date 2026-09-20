"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { useLanguage } from "@/components/LanguageProvider";
import { productHref, productImages } from "./productHref";

// The public profile's Catalog / Merch / Services section. An editorial
// grid instead of a collapsible list: one large feature card up top, then
// portrait cards two-up — big photography, a frosted price tag, a quiet
// arrow, soft rounded corners, a gentle fade-up as each card enters view.
// Every card opens the item's own detail page (see ProductDetailView);
// the buy/WhatsApp actions live there, not crammed onto a half-width card.
export default function CatalogSection({
  label,
  products,
  username,
  currency,
  isMusic,
  accent,
  textColor,
  borderTint,
  squareCorners,
  preview,
  onOpen,
}: {
  label: string;
  products: any[];
  username: string;
  currency: string;
  isMusic: boolean;
  accent: string;
  textColor: string;
  borderTint: string;
  squareCorners: boolean;
  // Inside the dashboard editor's live preview, cards shouldn't navigate away.
  preview?: boolean;
  onOpen: (product: any) => void;
}) {
  const sorted = [...products].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <section id="merch" className="flex flex-col gap-4 scroll-mt-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
            {label}
          </span>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ backgroundColor: hexToRgba(accent, 0.12), color: accent }}
        >
          {sorted.length}
        </span>
      </div>
      <div className="h-px w-full" style={{ backgroundColor: borderTint }} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-6">
        {sorted.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            featured={sorted.length >= 3 && i === 0}
            index={i}
            href={productHref(username, product.id, isMusic)}
            currency={currency}
            accent={accent}
            textColor={textColor}
            squareCorners={squareCorners}
            preview={preview}
            onOpen={() => onOpen(product)}
          />
        ))}
      </div>
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
  preview,
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
  preview?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const images = productImages(product);
  const soldOut = product.inventory_count === 0;
  const radius = squareCorners ? "rounded-lg" : "rounded-[22px]";

  const body = (
    <>
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
            className={`h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] ${soldOut ? "opacity-60" : ""}`}
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

        <span
          className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          style={{ backgroundColor: "rgba(255,255,255,0.92)", color: "#111" }}
          aria-hidden
        >
          <ArrowUpRight size={16} strokeWidth={2.2} />
        </span>
      </div>

      <div className="px-1 pt-3">
        <p className={`font-semibold leading-snug tracking-[-0.01em] line-clamp-2 ${featured ? "text-base" : "text-[15px]"}`}>{product.name}</p>
        {product.description && (
          <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ opacity: 0.6 }}>
            {product.description}
          </p>
        )}
      </div>
    </>
  );

  const motionProps = reduceMotion
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
    <motion.a href={href} onClick={onOpen} className={`${cls} active:scale-[0.985] transition-transform`} aria-label={product.name} {...motionProps}>
      {body}
    </motion.a>
  );
}
