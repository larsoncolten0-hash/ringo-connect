"use client";

import { useEffect, useState } from "react";

// Wraps a resource detail view (an order receipt, a booking, a community
// subscriber) with a brief, subtle highlight when the page was reached via
// a notification — see src/lib/notificationLinks.ts's withArrivalRef,
// which appends `?ref=push` to every dashboard deep-link it builds. Purely
// cosmetic (PART 18 of the notifications plan — "make it clear this is
// the item that generated the notification"), never used for access
// control: the resource itself is always fetched/authorized the normal
// way by the server component around this one, regardless of this query
// param's presence.
//
// Reads/strips `ref=push` via plain browser APIs (location.search,
// history.replaceState) rather than next/navigation's useSearchParams —
// that hook requires a Suspense boundary around anything that might be
// statically rendered, which would mean wrapping every call site; a
// resource detail page is never statically generated anyway (each one
// already sets `export const dynamic = "force-dynamic"`), so reaching for
// the plain DOM API here avoids that ceremony for a purely cosmetic touch.
// Stripping the param means refreshing or coming back to this same URL
// later never re-triggers the highlight.
export default function HighlightOnArrival({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ref") !== "push") return;

    setActive(true);
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);

    const timer = setTimeout(() => setActive(false), 900);
    return () => clearTimeout(timer);
  }, []);

  return <div className={`ringo-arrival-highlight-wrap ${active ? "ringo-arrival-highlight-active" : ""} ${className}`}>{children}</div>;
}
