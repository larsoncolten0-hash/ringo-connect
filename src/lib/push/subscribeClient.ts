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

// Fired on `window` after a subscribe/unsubscribe actually changes the
// browser's PushManager subscription — usePushToggle.ts listens for this
// so every mounted toggle (AvatarMenu's account-menu switch,
// PushNotificationBell.tsx) re-checks and reflects the change immediately.
// Needed because PushPermissionPrompt.tsx calls subscribeToPush()
// directly rather than through the hook: without this, granting
// permission via that banner left every other toggle showing stale "off"
// state until a full page reload (each usePushToggle instance only ever
// checked getPushStatus() once, on its own mount).
export const PUSH_STATUS_CHANGE_EVENT = "ringo:push-status-changed";

function notifyPushStatusChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_STATUS_CHANGE_EVENT));
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
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return { ok: false, error: "unsupported" };

  // iOS Safari (Home Screen installs included) only honors
  // Notification.requestPermission() while it's still inside the
  // synchronous tail of the click that triggered it — even a single
  // microtask tick ahead of it (this used to `await getPushStatus()`
  // first) is enough for WebKit to silently drop the request: no dialog,
  // no error, nothing happens. Chrome is far more forgiving of an async
  // gap here, which is why this only ever showed up on iOS. So this has
  // to be the very first `await` anywhere in the
  // toggle()/enable()/subscribeToPush() chain from the click handler.
  const granted = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
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
    notifyPushStatusChanged();
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
    if (res.ok) notifyPushStatusChanged();
    return { ok: res.ok };
  } catch (err: any) {
    return { ok: false, error: err?.message || "unsubscribe_failed" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sign-out and sign-in on the same device.
//
// A push subscription belongs to a DEVICE, but the server stores it against an ACCOUNT. Signing out used to leave it registered, so the next person using
// that phone kept receiving the previous account's order and payment notifications. Signing out now removes it (see /auth/logout). To keep that from
// costing the owner their notifications when they sign back in, the account that had push ON remembers that on this device and turns it back on silently
// the next time THEY sign in (the browser permission is already granted, so nothing is asked).
//
//   * Only the same account resumes: the stored value is the account's id, so a different person signing in is never subscribed by it.
//   * Only when the browser still allows notifications.
//   * Never when the device already has a subscription: that one now belongs to whoever enabled it, and resuming would take it from them.
// Storage can be blocked (private mode): nothing is then remembered, and the account menu toggle still turns push on by hand.
// ---------------------------------------------------------------------------------------------------------------
export const PUSH_RESUME_KEY = "ringo-push-resume";

export function rememberPushResume(userId: string, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(PUSH_RESUME_KEY, userId);
  } catch {
    // not remembered
  }
}

function forgetPushResume(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(PUSH_RESUME_KEY);
  } catch {
    // nothing to forget
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export interface PushResumeDeps {
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
  getStatus: () => Promise<PushStatus>;
  subscribe: (opts: { subscribeUrl: string }) => Promise<SubscribeToPushResult>;
}

/** Turns push back on for `userId` if, and only if, that same account turned it off by signing out on this device. Resolves true when it did. */
export async function resumePushIfRemembered(
  userId: string,
  subscribeUrl: string,
  deps: PushResumeDeps = { storage: safeStorage(), getStatus: getPushStatus, subscribe: subscribeToPush }
): Promise<boolean> {
  let remembered: string | null = null;
  try {
    remembered = deps.storage?.getItem(PUSH_RESUME_KEY) ?? null;
  } catch {
    return false;
  }
  if (!remembered || remembered !== userId) return false;

  const status = await deps.getStatus();
  // Permission withdrawn, or the device is already subscribed (to someone else): the memory is spent either way.
  if (!status.supported || status.permission !== "granted" || status.subscribed) {
    forgetPushResume(deps.storage as any);
    return false;
  }
  const result = await deps.subscribe({ subscribeUrl });
  if (result.ok) forgetPushResume(deps.storage as any);
  return result.ok;
}
