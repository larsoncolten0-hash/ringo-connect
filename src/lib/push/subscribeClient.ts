"use client";

// Browser-side half of Web Push — reused by every "Enable notifications"
// UI in the app (NotificationBell.tsx for creators/admins, the community
// manage page for fans, RestaurantOrderPage.tsx for guest customers).
// Each surface just picks a different `subscribeUrl`/`extra` — the actual
// permission/PushManager/fetch dance is identical everywhere, so it lives
// here once instead of once per component.

// PushManager wants the VAPID public key as a raw Uint8Array, not the
// URL-safe base64 string it's normally handed around as.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushStatus {
  // false in unsupported browsers (no Notification/PushManager/SW at
  // all — Firefox/Chrome/Edge/Android all support this; iOS only once
  // added to the home screen) or when the site isn't served over HTTPS.
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return { supported: false, permission: "unsupported", subscribed: false };

  const permission = Notification.permission;
  if (permission !== "granted") return { supported: true, permission, subscribed: false };

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return { supported: true, permission, subscribed: !!existing };
  } catch {
    return { supported: true, permission, subscribed: false };
  }
}

export interface SubscribeToPushResult {
  ok: boolean;
  error?: string;
}

// Requests permission (if not already decided), subscribes via
// PushManager, and POSTs the subscription to `subscribeUrl` — `extra` is
// whatever that route needs to know WHO this is (nothing for the
// authenticated creator/admin route, a community unsubscribe_token for
// fans, an order id for guest restaurant customers).
export async function subscribeToPush({
  subscribeUrl,
  extra,
}: {
  subscribeUrl: string;
  extra?: Record<string, unknown>;
}): Promise<SubscribeToPushResult> {
  const status = await getPushStatus();
  if (!status.supported) return { ok: false, error: "unsupported" };

  const permission = status.permission === "unsupported" ? "default" : status.permission;
  const granted = permission === "granted" ? "granted" : await Notification.requestPermission();
  if (granted !== "granted") return { ok: false, error: "permission_denied" };

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return { ok: false, error: "not_configured" };

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed for TS's lib.dom Uint8Array<ArrayBufferLike> vs
        // BufferSource's ArrayBuffer-only typing mismatch — the actual
        // runtime value is exactly what PushManager.subscribe expects.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }

    const res = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent, ...extra }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, error: body?.error || `request_failed_${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "subscribe_failed" };
  }
}

// Unsubscribes both sides: the browser's own PushManager subscription
// AND the server-side row (matched by endpoint, so it works regardless
// of which owner kind created it).
export async function unsubscribeFromPush(unsubscribeUrl: string): Promise<SubscribeToPushResult> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const res = await fetch(unsubscribeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: res.ok };
  } catch (err: any) {
    return { ok: false, error: err?.message || "unsubscribe_failed" };
  }
}
