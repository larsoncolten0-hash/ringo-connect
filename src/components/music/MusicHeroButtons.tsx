"use client";

import { CalendarCheck, ShoppingBag } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import WhatsAppButton from "@/components/WhatsAppButton";
import CallButton from "@/components/CallButton";
import SaveContactButton from "@/components/SaveContactButton";

// Mirrors RestaurantHeroButtons' structure (two big primary pills + a row
// of smaller contact icons) for the same "similar to the Restaurant
// category" reason the brief asks for. Book Now has no real
// booking/calendar system behind it (none exists in Ringo) — it opens
// WhatsApp with a ready-made message, the same hand-off every other
// not-yet-built request flow on Ringo Connect already uses. Buy Now goes
// to the real storefront at /m/[username].
export default function MusicHeroButtons({
  t,
  profile,
  accent,
  textColor,
}: {
  t: Translations;
  profile: any;
  accent: string;
  textColor: string;
}) {
  const cleanNumber = (profile.whatsapp_number || "").replace(/[^0-9]/g, "");
  const bookHref = cleanNumber
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(t.music.bookNowWhatsappMessage)}`
    : undefined;

  return (
    <div className="flex flex-col items-center gap-2.5 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
      <div className="flex gap-2.5 w-full">
        {bookHref && (
          <a
            href={bookHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition hover:brightness-95 active:scale-[0.98]"
            style={{ border: `2px solid ${accent}`, color: accent }}
          >
            <CalendarCheck size={16} />
            {t.music.bookNowButton}
          </a>
        )}
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
        <div className="flex gap-2.5 w-full">
          <div className="flex-1">
            <WhatsAppButton
              number={profile.whatsapp_number}
              message={profile.default_whatsapp_message}
              radiusClass="rounded-full"
              buttonStyle={{ backgroundColor: "#25D366", color: "#fff", border: "2px solid transparent" }}
            />
          </div>
          <div className="flex-1">
            <CallButton
              number={profile.whatsapp_number}
              radiusClass="rounded-full"
              buttonStyle={{ backgroundColor: "transparent", color: textColor, border: `2px solid ${hexToRgba(textColor, 0.35)}` }}
            />
          </div>
          <div className="flex-1">
            <SaveContactButton
              profile={profile}
              radiusClass="rounded-full"
              buttonStyle={{ backgroundColor: "transparent", color: textColor, border: `2px solid ${hexToRgba(textColor, 0.35)}` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
