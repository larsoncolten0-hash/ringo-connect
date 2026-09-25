"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

// Keeps a dynamically-rendered page's data trustworthy without the operator ever needing to know
// about a hard reload (the exact gap that let a just-created Shop payout sit invisible in
// Admin -> Shop Payouts until one). Mounted once per persistent shell (AdminShell, DashboardShell)
// so every page under it is covered automatically, present and future — not a per-page opt-in list.
//
// Two triggers, both calling the same router.refresh() (re-runs the current route's Server
// Components with fresh data; never resets a Client Component's own local state, so an
// in-progress form/edit is untouched):
//
//  1. A CLIENT-SIDE navigation to a new pathname (a sidebar Link, browser back/forward, an
//     installed PWA's own history stack). Next's Router Cache can otherwise serve an
//     already-rendered snapshot of a `dynamic = "force-dynamic"` page for up to
//     staleTimes.dynamic (30s by default) after a navigation, regardless of that export — this
//     is what actually caused the observed staleness, not the server-side render itself. The
//     very first pathname a mounted shell sees (the page that was just server-rendered to load
//     this shell) is deliberately skipped, so a plain page load never pays for a redundant,
//     already-fresh refetch.
//  2. The tab/installed PWA regaining visibility (switching apps and back, or waking from the
//     background) — a case a route change never fires for at all, since nothing navigated.
//
// Both share one throttle timestamp, set to Next's own default dynamic staleTime (30s) — never
// more eager than the framework's own notion of "still fresh enough" would have been, so this
// never turns into a poll and never fires twice in quick succession (e.g. a Link click immediately
// followed by an app switch). It only ever piggybacks on a real navigation or a real return-to-
// foreground event — no timer, no extra dependency.
const MIN_INTERVAL_MS = 30_000;

export function useFreshOnReturn() {
  const router = useRouter();
  const pathname = usePathname();
  const lastPathname = useRef(pathname);
  const lastRefreshAt = useRef(0);

  const refresh = () => {
    const now = Date.now();
    if (now - lastRefreshAt.current < MIN_INTERVAL_MS) return;
    lastRefreshAt.current = now;
    router.refresh();
  };

  useEffect(() => {
    if (pathname === lastPathname.current) return;
    lastPathname.current = pathname;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    // iOS Safari/an installed PWA sometimes fires `focus` instead of (or alongside)
    // visibilitychange when returning to a backgrounded tab/app — listening to both costs
    // nothing extra since refresh() is already throttled and idempotent within MIN_INTERVAL_MS.
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
