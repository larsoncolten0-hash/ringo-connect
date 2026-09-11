// Minimal service worker for "Add to Home Screen" installability only.
//
// Deliberately does NOT cache anything — no caches.open, no offline
// support, nothing stored. Some Chrome/Android versions still gate the
// native install prompt on a registered service worker with a `fetch`
// handler even though a manifest alone is often enough today; this exists
// purely to satisfy that check, never to promise offline access or cache
// any page (which could otherwise risk serving stale private dashboard,
// booking, or subscriber data — see the implementation plan). Every fetch
// is passed straight through to the network, unmodified.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
