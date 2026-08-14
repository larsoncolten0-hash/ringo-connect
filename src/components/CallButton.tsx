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
  onClick,
}: {
  number: string;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
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
      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:brightness-95 ${radius}`}
      style={style}
    >
      <Phone size={16} className="shrink-0" />
      Call
    </a>
  );
}