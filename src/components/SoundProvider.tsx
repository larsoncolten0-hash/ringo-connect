"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as tones from "@/lib/sound/tones";

export type SoundKind =
  | "success"
  | "notification"
  | "warning"
  | "error"
  | "scanValid"
  | "scanInvalid"
  | "scanAlreadyUsed";

const PLAYERS: Record<SoundKind, () => void> = {
  success: tones.playSuccess,
  notification: tones.playNotification,
  warning: tones.playWarning,
  error: tones.playError,
  scanValid: tones.playScanValid,
  scanInvalid: tones.playScanInvalid,
  scanAlreadyUsed: tones.playScanAlreadyUsed,
};

type SoundContextValue = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  // Fire-and-forget by design: sound is a nice-to-have layered on top of
  // an interface that already communicates everything visually (a save
  // checkmark, a colored full-screen scan result), so play() never throws,
  // never returns a promise a caller needs to await, and is a total no-op
  // whenever the preference is off or the browser can't play audio.
  play: (kind: SoundKind) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);

// Global, persisted, off-by-default-only-if-the-user-turns-it-off sound
// preference — mirrors ThemeToggle/LanguageProvider's own
// localStorage-backed pattern exactly. Mounted once at the root layout, so
// it covers every route including public profile pages; that's safe
// because this provider itself never calls play() — it only ever *unlocks*
// the audio context on the page's first tap, which produces no sound of
// its own. A public profile only ever goes silent-or-not based on whether
// something on that page calls play(), and nothing on ProfileView does.
export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("ringo-sound");
    if (saved === "off") setEnabledState(false);
  }, []);

  useEffect(() => {
    // Mobile Safari/Chrome refuse to produce sound from an AudioContext
    // until a genuine user gesture has touched the page — a scan result
    // or a save can happen from code, not directly inside a click, so this
    // primes the context on the very first tap/click/key anywhere on the
    // page instead of requiring every call site to think about it.
    const unlock = () => tones.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem("ringo-sound", next ? "on" : "off");
    } catch {}
  }, []);

  const play = useCallback(
    (kind: SoundKind) => {
      if (!enabled) return;
      try {
        PLAYERS[kind]();
      } catch {
        // Audio is always optional — a synthesis failure must never
        // surface to the user or interrupt the action it was reacting to.
      }
    },
    [enabled]
  );

  const value = useMemo(() => ({ enabled, setEnabled, play }), [enabled, setEnabled, play]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used within a SoundProvider");
  return ctx;
}
