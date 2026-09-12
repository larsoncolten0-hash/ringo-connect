"use client";

import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getBookingConfig } from "@/lib/categories";

// The universal "Book Now" affordance — renders nothing unless the profile
// owner has actually turned bookings on. Category-aware wording comes from
// categories.ts's BookingConfig; an owner-set booking_button_text always
// wins over the category default, the same override precedence
// default_whatsapp_message already uses. Links to the dedicated booking
// page (src/app/[username]/book) instead of opening an on-page form — a
// full screen there, rather than a modal stacked over this one, so the
// booking flow doesn't compete with everything else on the profile.
export default function BookingButton({
  profile,
  accent,
  className,
  style,
}: {
  profile: any;
  accent: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { locale } = useLanguage();

  if (!profile?.bookings_enabled) return null;

  const config = getBookingConfig(profile.category);
  const label = profile.booking_button_text?.trim() || config.buttonLabel[locale];

  return (
    <Link href={`/${profile.username}/book`} className={className} style={style}>
      <CalendarCheck size={16} />
      {label}
    </Link>
  );
}
