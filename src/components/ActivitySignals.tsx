"use client";

import { useEffect } from "react";

const SESSION_PING_KEY = "ringo-session-pinged";

// Two invisible, one-shot client signals that feed the admin Users
// analytics view (see 2026-10-11_user_activity_and_pwa_tracking.sql for
// the columns, AdminUsersAnalytics.tsx for how they're reported). Neither
// blocks rendering or retries on failure — a missed ping just means
// slightly stale reporting data, never a broken page. Mounted once in the
// dashboard layout (not the public/admin ones — this is specifically
// about creator/subscriber engagement, which is what the admin Users view
// reports on).
export default function ActivitySignals() {
  useEffect(() => {
    // "Currently using as installed app" — matchMedia('(display-mode:
    // standalone)') is the standard cross-browser check; the `.standalone`
    // fallback catches older iOS Safari PWAs that don't report
    // display-mode correctly. Sent once per tab/session, not on every
    // mount — sessionStorage is enough of a gate for a signal this coarse.
    try {
      if (!sessionStorage.getItem(SESSION_PING_KEY)) {
        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true;
        fetch("/api/activity/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ standalone }),
        }).catch(() => {});
        sessionStorage.setItem(SESSION_PING_KEY, "1");
      }
    } catch {
      // sessionStorage unavailable (private mode, storage blocked) — worst
      // case this pings once per page load instead of once per session,
      // which is harmless.
    }

    // "Has installed at least once" — does NOT fire on iOS Safari (Apple
    // has never implemented this event), so this signal structurally
    // undercounts iOS home-screen installs. Nothing client-side can fix
    // that; the admin UI surfaces the caveat instead of hiding it.
    const handleInstalled = () => {
      fetch("/api/pwa/install", { method: "POST" }).catch(() => {});
    };
    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  return null;
}
