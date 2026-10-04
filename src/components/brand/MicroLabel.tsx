import type { ReactNode } from "react";

// The technical micro-language: short status and data in the mono face. NFC · READY, CONNECTED, SCAN TO OPEN, RINGO ID 0042.
// For state and measurement ONLY. Never an eyebrow above a heading, never decoration: if it does not report something
// true about the thing next to it, it should not exist. Callers pass already-translated text (see t.brand.*).
//
// `surface` picks a contrast-safe color for where the label sits:
//   auto   follows the app theme (dark step on light, bright step on dark)
//   dark   an always-dark stage (a creator profile, the Ringo Card): the bright tokens
//   light  an always-light stage: the dark text steps
// `live` adds the signal dot, with one expanding ring (switched off by reduced motion; the dot and the text remain).
export type MicroTone = "gold" | "signal" | "muted";
export type MicroSurface = "auto" | "dark" | "light";

const COLOR: Record<MicroSurface, Record<MicroTone, string>> = {
  auto: { gold: "text-ringo-gold-text", signal: "text-ringo-signal-text", muted: "text-ringo-muted" },
  dark: { gold: "text-ringo-gold", signal: "text-ringo-signal", muted: "text-ringo-stone-300/80" },
  light: { gold: "text-ringo-gold-dark", signal: "text-ringo-signal-dark", muted: "text-ringo-stone-600" },
};

export default function MicroLabel({
  children,
  tone = "muted",
  surface = "auto",
  live = false,
  className = "",
}: {
  children: ReactNode;
  tone?: MicroTone;
  surface?: MicroSurface;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={["ringo-micro inline-flex items-center gap-2", COLOR[surface][tone], className].filter(Boolean).join(" ")}>
      {live && <span className="ringo-live-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
