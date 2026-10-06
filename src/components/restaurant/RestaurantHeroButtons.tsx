"use client";

import { UtensilsCrossed, ShoppingCart, MapPin, Phone, CalendarDays } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { hexToRgba, readableOn } from "@/lib/color";
import { getBookingConfig } from "@/lib/categories";
import type { Translations } from "@/lib/i18n/translations";

// Replaces the generic WhatsApp/Call/Save row for Restaurant & Food
// profiles — two big primary actions (both go to the same /r/[username]
// ordering page; "View Menu" vs "Order Now" is a framing difference, not
// a different destination) plus the secondary contact/reserve row.
// "Reserve Table" links to the dedicated /[username]/book page (see
// BookingPage.tsx) once the owner has turned bookings on — its own full
// screen rather than a modal stacked over this one, so it doesn't fight
// the rest of the profile for room; until then it falls back to the same
// WhatsApp hand-off every not-yet-built action on Ringo Connect used to
// use, so nothing breaks for a restaurant that hasn't enabled it yet.
export default function RestaurantHeroButtons({
  t,
  profile,
  username,
  whatsappNumber,
  aboutLocation,
  accent,
  locale,
  radiusClass = "rounded-card",
}: {
  t: Translations;
  profile: any;
  username: string;
  whatsappNumber?: string | null;
  aboutLocation?: string | null;
  accent: string;
  locale: "en" | "fr";
  /** The owner's own button shape (rounded unless they chose otherwise). */
  radiusClass?: string;
}) {
  const menuHref = `/r/${username}`;
  const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
  const bookingsEnabled = !!profile?.bookings_enabled;
  const reserveHref = bookingsEnabled
    ? `/${username}/book`
    : cleanNumber
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(t.restaurant.reserveTableWhatsappMessage)}`
    : undefined;
  const reserveLabel = profile?.booking_button_text?.trim() || getBookingConfig(profile?.category).buttonLabel[locale] || t.restaurant.reserveTableButton;
  const mapsHref = aboutLocation ? `https://www.google.com/maps/search/${encodeURIComponent(aboutLocation)}` : undefined;

  const iconButtons = [
    whatsappNumber && {
      href: `https://wa.me/${cleanNumber}`,
      icon: FaWhatsapp,
      label: "WhatsApp",
    },
    mapsHref && { href: mapsHref, icon: MapPin, label: t.profilePage.location },
    whatsappNumber && { href: `tel:${cleanNumber}`, icon: Phone, label: t.profilePage.callButton },
    reserveHref && { href: reserveHref, icon: CalendarDays, label: reserveLabel },
  ].filter(Boolean) as { href: string; icon: any; label: string }[];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
      <div className="flex gap-2.5 w-full">
        {/* Both go to the menu page, so they are one decision, not two competing fills: ordering is the primary action (the filled accent), browsing the
            menu is the quiet secondary one (an accent border on the page's own text colour, so it reads on any theme). */}
        <a
          href={menuHref}
          className={`ringo-tactile flex-1 flex min-h-[44px] items-center justify-center gap-2 py-3 text-sm font-semibold transition hover:brightness-95 ${radiusClass}`}
          style={{ border: `1.5px solid ${accent}`, backgroundColor: hexToRgba(accent, 0.08), color: "inherit" }}
        >
          <UtensilsCrossed size={16} aria-hidden="true" />
          {t.restaurant.viewMenuButton}
        </a>
        <a
          href={menuHref}
          className={`ringo-tactile flex-1 flex min-h-[44px] items-center justify-center gap-2 py-3 text-sm font-semibold transition hover:brightness-95 ${radiusClass}`}
          style={{ border: `1.5px solid ${accent}`, backgroundColor: accent, color: readableOn(accent) }}
        >
          <ShoppingCart size={16} aria-hidden="true" />
          {t.restaurant.orderNowButton}
        </a>
      </div>

      {iconButtons.length > 0 && (
        <div className="flex justify-center gap-5">
          {iconButtons.map((btn) => {
            const inner = (
              <>
                <span
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: hexToRgba(accent, 0.14), color: accent }}
                >
                  <btn.icon size={17} />
                </span>
                <span className="text-[11px]" style={{ opacity: 0.75 }}>
                  {btn.label}
                </span>
              </>
            );
            return (
              <a
                key={btn.label}
                href={btn.href}
                target={btn.href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5"
              >
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
