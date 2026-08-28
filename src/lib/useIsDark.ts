"use client";

import { useEffect, useState } from "react";

// ThemeToggle.tsx flips dark mode with a plain classList.toggle("dark") on
// <html> — no context/provider backs it. Anywhere a color has to be
// computed in JS rather than picked by a Tailwind `dark:` class (the
// world map's per-country fill, chosen from a data value) needs its own
// way to know the current theme AND react when it changes, hence the
// MutationObserver rather than a one-time read on mount.
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
