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
  // The icon defaults to WhatsApp's own green so it stays recognizable
  // against a container that follows the page's own theme colors — but
  // when the container itself is filled with that same green (the
  // "authentic WhatsApp button" look, see MusicHeroButtons), a green icon
  // on a green fill disappears, so that call site overrides this to white.
  iconColor = "#25D366",
  onClick,
}: {
  number: string;
  message?: string;
  compact?: boolean;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
  iconColor?: string;
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
      <FaWhatsapp size={compact ? 15 : 17} style={{ color: iconColor }} className="shrink-0" />
      {!compact && "WhatsApp"}
    </a>
  );
}