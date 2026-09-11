"use client";

import { useEffect } from "react";

// Registers the minimal, non-caching service worker (public/pwa-sw.js) —
// mounted only from ProfileView.tsx, never on dashboard/auth pages, so its
// footprint stays limited to exactly where "Add to Home Screen" lives. See
// AddToHomeScreen.tsx for why this exists (some Chrome/Android versions
// still gate the install prompt on a registered service worker).
export default function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/pwa-sw.js").catch(() => {
        // Registration can fail (unsupported browser, blocked storage,
        // etc.) — never break the page over this; the profile still works
        // as a normal website either way, only "Add to Home Screen" might
        // not be offered.
      });
    }
  }, []);

  return null;
}
