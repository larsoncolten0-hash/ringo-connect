"use client";

import type { CSSProperties } from "react";
import { UserPlus } from "lucide-react";
import { buildVCard, vCardFileName } from "@/lib/vcard";

// Lets a visitor save this profile straight into their phone's own
// Contacts app. A vCard (.vcf) data URI is what reliably opens the
// native "Add Contact" screen on iOS Safari — Safari renders a vCard
// data: URI inline as a contact card, but it commonly just downloads a
// Blob URL of the same content as an opaque file instead.
export default function SaveContactButton({
  profile,
  radiusClass,
  buttonStyle,
  compact,
  onClick,
}: {
  profile: any;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
  // Icon-only, shorter — same pattern as WhatsAppButton's own `compact`,
  // for a row of secondary contact actions that shouldn't compete with a
  // page's real primary buttons (e.g. Music's Book Now/Buy Now).
  compact?: boolean;
  onClick?: () => void;
}) {
  if (!profile?.whatsapp_number && !profile?.about_phone) return null;

  const pageUrl = typeof window !== "undefined" ? window.location.href : undefined;
  const vcard = buildVCard(profile, pageUrl);
  const href = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`;
  const radius = radiusClass || "rounded-card";
  const style: CSSProperties = buttonStyle || {
    backgroundColor: "transparent",
    border: "2px solid currentColor",
  };

  return (
    <a
      href={href}
      download={vCardFileName(profile)}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 transition hover:brightness-95 ${
        compact ? "flex-1 py-1.5" : "px-4 py-2.5 text-sm font-medium"
      } ${radius}`}
      style={style}
    >
      <UserPlus size={compact ? 15 : 16} className="shrink-0" />
      {!compact && "Save"}
    </a>
  );
}
