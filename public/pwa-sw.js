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

// Web Push — see src/lib/push/send.ts (server side, what sends these) and
// src/lib/push/client.ts (browser side, what subscribes to them). The
// payload is always our own JSON ({ title, body, url }), never someone
// else's arbitrary push service — this worker isn't multi-tenant, it's
// bundled with this one app.
//
// Deliberately separate from the fetch/install/activate handlers above,
// which exist purely for installability (see the incident note) — a push
// handler that shows a notification is not "caching" or "intercepting"
// anything and carries none of that risk.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON (shouldn't happen — we always send JSON) — fall back to a
    // generic notification rather than dropping the push silently.
  }

  const title = data.title || "Ringo Connect";
  const options = {
    body: data.body || "",
    // Same generated PWA icons every manifest.webmanifest route falls
    // back to when there's no per-creator avatar — see
    // src/app/dashboard/manifest.webmanifest/route.ts.
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Carries where notificationclick below should take the person —
    // never rendered, purely internal.
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an already-open tab on its target URL
// when one exists, instead of always opening a new one — most of the time
// the dashboard or admin console is already open in a background tab.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => new URL(c.url).pathname === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
