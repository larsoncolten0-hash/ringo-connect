"use client";

import { useEffect } from "react";

// Registers the minimal, non-caching service worker (public/pwa-sw.js) —
// mounted from ProfileView.tsx and DashboardShell.tsx, the only two places
// "Add to Home Screen" is offered, never on auth pages. Safe to share
// between them: the worker deliberately caches nothing (see pwa-sw.js), so
// mounting it on the dashboard too can't leak a stale private page across
// sessions. See AddToHomeScreen.tsx for why this exists (some Chrome/
// Android versions still gate the install prompt on a registered service
// worker).
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
