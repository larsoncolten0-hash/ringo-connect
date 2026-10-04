import type { CSSProperties } from "react";
import { accentTextOn, hexToRgba, readableOn } from "./color";

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

/**
 * The same three button styles, for a button that sits on a FIXED surface the creator did not pick (the light content panel of a Music
 * profile). The creator's accent stays the border and the fill; only the TEXT is chosen to be legible: the accent in a legible shade
 * (outline, soft) or whichever of ink / white reads on the accent (fill), instead of a gold label on cream or white on gold.
 */
export function getPanelButtonStyle(style: ButtonStyle, accent: string, surfaceHex: string): CSSProperties {
  switch (style) {
    case "outline":
      return { backgroundColor: "transparent", border: `2px solid ${accent}`, color: accentTextOn(surfaceHex, accent) };
    case "soft":
      return { backgroundColor: hexToRgba(accent, 0.14), border: "2px solid transparent", color: accentTextOn(surfaceHex, accent) };
    case "fill":
    default:
      return { backgroundColor: accent, border: "2px solid transparent", color: readableOn(accent) };
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