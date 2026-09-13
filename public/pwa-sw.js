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

// OS-level push notifications (see src/lib/push/) — the only other job
// this worker has, and unlike the fetch handler above, this one is
// supposed to do something. `event.data` is whatever JSON payload
// src/lib/push/webpush.ts's deliverToSubscription() sent
// (PushPayload: { category, title, body, url, data }).
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with no/unparseable body still deserves *a* notification
    // rather than silently doing nothing.
  }

  const title = payload.title || "Ringo Connect";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Collapses rapid-fire pushes of the same kind (e.g. several order
    // status updates) into one notification slot instead of stacking —
    // the OS shows only the latest with a given tag.
    tag: payload.category,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open tab on its target URL
// if one exists, otherwise opens a new one — standard PWA notification
// click behavior.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
