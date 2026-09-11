"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getBookingConfig } from "@/lib/categories";
import BookingModal from "./BookingModal";

// The universal "Book Now" affordance — renders nothing unless the profile
// owner has actually turned bookings on. Category-aware wording comes from
// categories.ts's BookingConfig; an owner-set booking_button_text always
// wins over the category default, the same override precedence
// default_whatsapp_message already uses.
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
  const [open, setOpen] = useState(false);

  if (!profile?.bookings_enabled) return null;

  const config = getBookingConfig(profile.category);
  const label = profile.booking_button_text?.trim() || config.buttonLabel[locale];

  return (
    <>
      <button onClick={() => setOpen(true)} className={className} style={style}>
        <CalendarCheck size={16} />
        {label}
      </button>
      {open && <BookingModal profile={profile} accent={accent} onClose={() => setOpen(false)} />}
    </>
  );
}
