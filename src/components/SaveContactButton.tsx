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
  onClick,
}: {
  profile: any;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
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
      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:brightness-95 ${radius}`}
      style={style}
    >
      <UserPlus size={16} className="shrink-0" />
      Save
    </a>
  );
}
