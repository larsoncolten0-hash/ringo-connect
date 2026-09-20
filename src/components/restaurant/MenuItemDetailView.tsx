"use client";

import Link from "next/link";
import { ArrowLeft, Clock, ShoppingCart } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ShareButton from "@/components/ShareButton";
import ImageGallery from "@/components/ImageGallery";
import { formatPrice } from "@/lib/currency";

// A single menu item, in full: photos, name, price, description, prep time. Same chrome as the
// music item pages (sticky bar with back + the public Share control, creator accent color). The
// primary button opens the ordering page with this dish already added to the cart.
export default function MenuItemDetailView({ profile, item, categoryName }: { profile: any; item: any; categoryName: string | null }) {
  const { t, locale } = useLanguage();
  const accent = profile.theme_color || "#1F9D55";
  const currency = profile.currency || "USD";
  const menuHref = `/r/${profile.username}`;
  const images: string[] = (item.image_urls?.length ? item.image_urls : [item.image_url]).filter(Boolean);
  const unavailable = item.available === false;
  const canOrder = !unavailable && profile.ordering_enabled !== false;

  return (
    <div className="min-h-screen bg-white pb-28" style={{ color: "#14202B" }}>
      <div className="sticky top-0 z-20 bg-white border-b flex items-center gap-3 px-4 py-3" style={{ borderColor: "#E5E7EB" }}>
        <Link href={menuHref} className="shrink-0" aria-label={t.restaurant.backToMenu}>
          <ArrowLeft size={19} />
        </Link>
        <p className="text-sm font-semibold flex-1 truncate">{profile.name || profile.username}</p>
        <ShareButton
          accent={accent}
          title={item.name}
          backdropTop="top-[60px]"
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

      <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
        {images.length > 0 ? (
          <ImageGallery images={images} alt={item.name} className="w-full aspect-square rounded-2xl" imgClassName="object-cover" />
        ) : (
          <div className="w-full aspect-square rounded-2xl" style={{ backgroundColor: "#F3F4F6" }} />
        )}

        <div>
          {categoryName && (
            <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ opacity: 0.5 }}>
              {categoryName}
            </p>
          )}
          <h1 className="font-display text-xl font-bold mt-0.5">{item.name}</h1>
          <p className="text-lg font-bold mt-1" style={{ color: accent }} suppressHydrationWarning>
            {formatPrice(item.price, currency, locale)}
          </p>
          {item.prep_time_minutes ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ opacity: 0.65 }}>
              <Clock size={13} />
              {t.restaurant.prepTimeAbout(item.prep_time_minutes)}
            </p>
          ) : null}
          {unavailable && (
            <span className="inline-block mt-2 text-[11px] px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F3F4F6" }}>
              {t.restaurant.currentlyUnavailable}
            </span>
          )}
        </div>

        {item.description && (
          <p className="text-sm whitespace-pre-wrap" style={{ opacity: 0.8 }}>
            {item.description}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-white/95 backdrop-blur border-t px-4 py-3" style={{ borderColor: "#E5E7EB", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="max-w-md mx-auto flex gap-2.5">
          <Link href={menuHref} className="px-4 py-3 rounded-full text-sm font-medium border" style={{ borderColor: "#E5E7EB" }}>
            {t.restaurant.viewFullMenu}
          </Link>
          {canOrder ? (
            <Link
              href={`${menuHref}?add=${item.id}`}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              <ShoppingCart size={16} />
              {t.restaurant.addToOrder}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
