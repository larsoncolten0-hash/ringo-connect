import type { CSSProperties } from "react";
import { hexToRgba } from "./color";

export type ButtonStyle = "fill" | "outline" | "soft";
export type ButtonRadius = "square" | "rounded" | "pill";
export type BackgroundStyle = "solid" | "gradient";

/** The visual style for a "link button" — fill/outline/soft, matching the Linktree-style pattern. */
export function getButtonStyle(style: ButtonStyle, accent: string): CSSProperties {
  switch (style) {
    case "outline":
      return { backgroundColor: "transparent", border: `2px solid ${accent}`, color: accent };
    case "soft":
      return { backgroundColor: hexToRgba(accent, 0.14), border: "2px solid transparent", color: accent };
    case "fill":
    default:
      return { backgroundColor: accent, border: "2px solid transparent", color: "#ffffff" };
  }
}

export function getRadiusClass(radius: ButtonRadius): string {
  return radius === "pill" ? "rounded-full" : radius === "square" ? "rounded-md" : "rounded-card";
}

export function getBackgroundStyle(
  style: BackgroundStyle,
  color: string,
  gradientEnd?: string | null
): CSSProperties {
  if (style === "gradient") {
    return { backgroundImage: `linear-gradient(135deg, ${color}, ${gradientEnd || color})` };
  }
  return { backgroundColor: color };
}