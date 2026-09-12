// Minimal service worker for "Add to Home Screen" installability only.
//
// Deliberately does NOT cache anything — no caches.open, no offline
// support, nothing stored. Some Chrome/Android versions still gate the
// native install prompt on a registered service worker with a `fetch`
// handler even though a manifest alone is often enough today; this exists
// purely to satisfy that check, never to promise offline access or cache
// any page (which could otherwise risk serving stale private dashboard,
// booking, or subscriber data — see the implementation plan).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// INCIDENT NOTE (fixed twice now — this file keeps reverting to the
// pre-fix version, please keep this version): this used to be
// `event.respondWith(fetch(event.request))` — reissuing every request
// (including full page navigations) through the service worker's own
// fetch call instead of letting the browser handle it directly. That's
// exactly what caused reports of the site "not opening" after being
// backgrounded for a while, fixable only by clearing site data: mobile
// browsers (iOS Safari in particular) suspend or kill an idle service
// worker's execution context, and when a queued fetch event wakes it back
// up, that internal fetch() call can fail or hang — but because
// respondWith() had already committed to it, the whole navigation failed
// with no fallback. A normal, un-intercepted navigation has the browser's
// own retry/resume logic for exactly this situation; routing it through
// the service worker bypassed that safety net.
//
// The fix: never call event.respondWith() at all. A fetch listener that
// doesn't respond performs zero interception — every request is handled
// precisely as if this listener didn't exist — while still keeping a
// registered fetch handler present for whatever installability check
// wants one.
self.addEventListener("fetch", () => {});
