"use client";

import type { CSSProperties } from "react";
import { Phone } from "lucide-react";

// Deliberately reuses whatsapp_number rather than adding a separate phone
// field — asking a creator to enter the same number twice is friction
// for no real benefit in the overwhelming majority of cases where it's
// the same number either way.
export default function CallButton({
  number,
  radiusClass,
  buttonStyle,
  compact,
  onClick,
}: {
  number: string;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
  // Icon-only, shorter — same pattern as WhatsAppButton's own `compact`,
  // for a row of secondary contact actions that shouldn't compete with a
  // page's real primary buttons (e.g. Music's Book Now/Buy Now).
  compact?: boolean;
  onClick?: () => void;
}) {
  if (!number) return null;

  const cleanNumber = number.replace(/[^0-9+]/g, "");
  const radius = radiusClass || "rounded-card";
  const style: CSSProperties = buttonStyle || {
    backgroundColor: "transparent",
    border: "2px solid currentColor",
  };

  return (
    <a
      href={`tel:${cleanNumber}`}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 transition hover:brightness-95 ${
        compact ? "flex-1 py-1.5" : "px-4 py-2.5 text-sm font-medium"
      } ${radius}`}
      style={style}
    >
      <Phone size={compact ? 15 : 16} className="shrink-0" />
      {!compact && "Call"}
    </a>
  );
}