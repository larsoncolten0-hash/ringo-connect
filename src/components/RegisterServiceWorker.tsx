"use client";

import { useEffect } from "react";

// Registers the minimal service worker (public/pwa-sw.js) — mounted from
// ProfileView.tsx, DashboardShell.tsx, EventScannerView.tsx, and
// AdminShell.tsx, the only four places "Add to Home Screen" is offered,
// never on auth pages. Safe to share between them: the worker never
// caches pages (see pwa-sw.js), so mounting it on the dashboard, the
// admin console, or the (unauthenticated, token-based) scanner too can't
// leak a stale private page across sessions. See AddToHomeScreen.tsx for
// why this exists (some Chrome/Android versions still gate the install
// prompt on a registered service worker) — it's also what makes Web Push
// possible at all, since a push subscription belongs to a service worker
// registration (see src/lib/push/client.ts).
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
