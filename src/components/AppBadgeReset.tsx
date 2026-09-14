"use client";

import { useEffect } from "react";

// Clears the home-screen notification badge the moment an installed PWA
// (profile, dashboard, admin, or scanner — see RegisterServiceWorker.tsx's
// own comment for why all four share that one file) is actually opened.
// Mounted alongside RegisterServiceWorker in the same four places, since
// "has a badge" and "is installable" are the same four surfaces.
//
// Two separate clears, deliberately: navigator.clearAppBadge() is fired
// immediately for instant feedback (iOS/desktop honor it right away, no
// round trip needed), and /api/push/reset-badge additionally zeroes the
// server-side counter (push_subscriptions.badge_count) so the NEXT push
// starts counting from 0 again instead of the badge silently jumping back
// to a stale high number. See 2026-10-09_push_badge_count.sql.
//
// Only runs anything at all when actually launched as an installed app —
// a plain browser tab has no home-screen badge to clear, so there's
// nothing to do (and no reason to spend the round trip) otherwise.
export default function AppBadgeReset() {
  useEffect(() => {
    const isStandalone =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true);
    if (!isStandalone) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    (async () => {
      try {
        if ("clearAppBadge" in navigator) {
          await (navigator as any).clearAppBadge();
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return; // nothing subscribed on this device — no server-side counter to reset

        await fetch("/api/push/reset-badge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      } catch {
        // Best-effort only — a failed clear/reset leaves the badge
        // exactly as it was, never breaks the page over this.
      }
    })();
  }, []);

  return null;
}
