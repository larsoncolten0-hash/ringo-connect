"use client";

import type { CSSProperties } from "react";
import { FaWhatsapp } from "react-icons/fa6";

// Previously this button was hardcoded to a solid coral fill regardless
// of the page's own button style, on the reasoning that a fixed,
// recognizable "start a chat" color mattered more than brand matching.
// A concrete design reference showed WhatsApp rendered as an outlined
// button matching the page's own style, with just the icon in WhatsApp's
// brand green — so that's what this does now: the icon stays
// recognizable, the button container follows whatever style/radius/
// accent the creator has actually chosen for their page.
export default function WhatsAppButton({
  number,
  message,
  compact,
  radiusClass,
  buttonStyle,
  onClick,
}: {
  number: string;
  message?: string;
  compact?: boolean;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
  onClick?: () => void;
}) {
  if (!number) return null;

  const cleanNumber = number.replace(/[^0-9]/g, "");
  const href = `https://wa.me/${cleanNumber}${
    message ? `?text=${encodeURIComponent(message)}` : ""
  }`;
  const radius = radiusClass || "rounded-card";
  const style: CSSProperties = buttonStyle || {
    backgroundColor: "#FF6B4A",
    color: "#fff",
    border: "2px solid transparent",
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 transition hover:brightness-95 ${
        compact ? "flex-1 py-1.5" : "px-4 py-2.5 text-sm font-medium"
      } ${radius}`}
      style={style}
    >
      <FaWhatsapp size={compact ? 15 : 17} className="text-[#25D366] shrink-0" />
      {!compact && "WhatsApp"}
    </a>
  );
}