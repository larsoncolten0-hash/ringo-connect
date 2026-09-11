"use client";

import Link from "next/link";
import { CalendarCheck, ShoppingBag } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { getBookingConfig } from "@/lib/categories";
import type { Translations } from "@/lib/i18n/translations";
import WhatsAppButton from "@/components/WhatsAppButton";
import CallButton from "@/components/CallButton";
import SaveContactButton from "@/components/SaveContactButton";

// Mirrors RestaurantHeroButtons' structure (two big primary pills + a row
// of smaller contact icons). Book Now links to the dedicated
// /[username]/book page (see BookingPage.tsx) once the artist has turned
// bookings on — its own full screen rather than a modal stacked over this
// one, so it doesn't fight the rest of the profile for room; until then it
// falls back to the same WhatsApp hand-off every other not-yet-built
// request flow on Ringo Connect used to use, so nothing breaks for an
// artist who hasn't enabled it yet. Buy Now goes to the real storefront
// at /m/[username].
export default function MusicHeroButtons({
  t,
  profile,
  accent,
  textColor,
  locale,
}: {
  t: Translations;
  profile: any;
  accent: string;
  textColor: string;
  locale: "en" | "fr";
}) {
  const cleanNumber = (profile.whatsapp_number || "").replace(/[^0-9]/g, "");
  const bookingsEnabled = !!profile.bookings_enabled;
  const bookHref = bookingsEnabled
    ? `/${profile.username}/book`
    : cleanNumber
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(t.music.bookNowWhatsappMessage)}`
    : undefined;
  const bookLabel = profile.booking_button_text?.trim() || getBookingConfig(profile.category).buttonLabel[locale] || t.music.bookNowButton;

  return (
    <div className="flex flex-col items-center gap-2.5 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
      <div className="flex gap-2.5 w-full">
        {bookHref &&
          (bookingsEnabled ? (
            <Link
              href={bookHref}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition hover:brightness-95 active:scale-[0.98]"
              style={{ border: `2px solid ${accent}`, color: accent }}
            >
              <CalendarCheck size={16} />
              {bookLabel}
            </Link>
          ) : (
            <a
              href={bookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition hover:brightness-95 active:scale-[0.98]"
              style={{ border: `2px solid ${accent}`, color: accent }}
            >
              <CalendarCheck size={16} />
              {bookLabel}
            </a>
          ))}
        <a
          href={`/m/${profile.username}`}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white transition hover:brightness-95 active:scale-[0.98]"
          style={{ backgroundColor: accent }}
        >
          <ShoppingBag size={16} />
          {t.music.buyNowButton}
        </a>
      </div>

      {profile.whatsapp_number && (
        // Compact/icon-only — Book Now and Buy Now above are the two
        // buttons this page actually wants attention on; WhatsApp/Call/
        // Save are secondary contact shortcuts and shouldn't compete with
        // them at the same size.
        <div className="flex gap-2 w-full max-w-[220px]">
          <div className="flex-1">
            <WhatsAppButton
              number={profile.whatsapp_number}
              message={profile.default_whatsapp_message}
              radiusClass="rounded-full"
              compact
              iconColor="#fff"
              buttonStyle={{ backgroundColor: "#25D366", color: "#fff", border: "2px solid transparent" }}
            />
          </div>
          <div className="flex-1">
            <CallButton
              number={profile.whatsapp_number}
              radiusClass="rounded-full"
              compact
              buttonStyle={{ backgroundColor: "transparent", color: textColor, border: `2px solid ${hexToRgba(textColor, 0.35)}` }}
            />
          </div>
          <div className="flex-1">
            <SaveContactButton
              profile={profile}
              radiusClass="rounded-full"
              compact
              buttonStyle={{ backgroundColor: "transparent", color: textColor, border: `2px solid ${hexToRgba(textColor, 0.35)}` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
