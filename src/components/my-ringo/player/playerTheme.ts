"use client";

import { useCallback, useSyncExternalStore } from "react";

// The music player's own light/dark choice, independent of the rest of My Ringo. Dark is the
// default; the pick is remembered on this device and shared live between the mini and full
// player. The palette itself is the app's existing `.dark` CSS variables (globals.css),
// applied by putting the `dark` class on the player's root element.
export type PlayerTheme = "dark" | "light";

const KEY = "ringo-player-theme";
const listeners = new Set<() => void>();

function read(): PlayerTheme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePlayerTheme(): { theme: PlayerTheme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as PlayerTheme);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, read() === "dark" ? "light" : "dark");
    } catch {
      // Storage blocked: the toggle just won't persist.
    }
    listeners.forEach((l) => l());
  }, []);
  return { theme, toggle };
}
