"use client";

import { UtensilsCrossed, ShoppingCart, MapPin, Phone, CalendarDays } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";

// Replaces the generic WhatsApp/Call/Save row for Restaurant & Food
// profiles — two big primary actions (both go to the same /r/[username]
// ordering page; "View Menu" vs "Order Now" is a framing difference, not
// a different destination) plus the secondary contact/reserve row.
// Reserve Table has no real booking system yet (that's Phase 4 —
// Reservations) — it opens WhatsApp with a ready-made message, the same
// hand-off every not-yet-built action on Ringo Connect already uses.
export default function RestaurantHeroButtons({
  t,
  username,
  whatsappNumber,
  aboutLocation,
  accent,
}: {
  t: Translations;
  username: string;
  whatsappNumber?: string | null;
  aboutLocation?: string | null;
  accent: string;
}) {
  const menuHref = `/r/${username}`;
  const cleanNumber = (whatsappNumber || "").replace(/[^0-9]/g, "");
  const reserveHref = cleanNumber
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(t.restaurant.reserveTableWhatsappMessage)}`
    : undefined;
  const mapsHref = aboutLocation ? `https://www.google.com/maps/search/${encodeURIComponent(aboutLocation)}` : undefined;

  const iconButtons = [
    whatsappNumber && {
      href: `https://wa.me/${cleanNumber}`,
      icon: FaWhatsapp,
      label: "WhatsApp",
    },
    mapsHref && { href: mapsHref, icon: MapPin, label: t.profilePage.location },
    whatsappNumber && { href: `tel:${cleanNumber}`, icon: Phone, label: "Call" },
    reserveHref && { href: reserveHref, icon: CalendarDays, label: t.restaurant.reserveTableButton },
  ].filter(Boolean) as { href: string; icon: any; label: string }[];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
      <div className="flex gap-2.5 w-full">
        <a
          href={menuHref}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition hover:brightness-95 active:scale-[0.98]"
          style={{ backgroundColor: accent, color: "#fff" }}
        >
          <UtensilsCrossed size={16} />
          {t.restaurant.viewMenuButton}
        </a>
        <a
          href={menuHref}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition hover:brightness-95 active:scale-[0.98]"
          style={{ backgroundColor: accent, color: "#fff" }}
        >
          <ShoppingCart size={16} />
          {t.restaurant.orderNowButton}
        </a>
      </div>

      {iconButtons.length > 0 && (
        <div className="flex justify-center gap-5">
          {iconButtons.map((btn) => (
            <a key={btn.label} href={btn.href} target={btn.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="flex flex-col items-center gap-1.5">
              <span
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ backgroundColor: hexToRgba(accent, 0.14), color: accent }}
              >
                <btn.icon size={17} />
              </span>
              <span className="text-[11px]" style={{ opacity: 0.75 }}>
                {btn.label}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
