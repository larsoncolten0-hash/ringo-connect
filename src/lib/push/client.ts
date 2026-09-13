"use client";

// Browser-side Web Push subscribe/unsubscribe helpers — used by
// AdminAppControls.tsx today, but deliberately generic (no admin-specific
// wording or imports) so a future creator-facing notification toggle can
// reuse it unchanged. Pairs with src/lib/push/send.ts on the server and
// the `push`/`notificationclick` handlers in public/pwa-sw.js.

// PushManager.subscribe() needs the VAPID public key as a raw Uint8Array,
// not the base64url string it's generated/stored as — this is the
// standard conversion (see the Web Push protocol's own examples).
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

export type PushStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed";

// Whether this browser can do Web Push at all — checked before rendering
// any toggle, same "no dead button" rule the rest of this app's
// install/notification UI already follows (see AddToHomeScreen.tsx).
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Current state, checked against both the browser's own permission and
// whether an actual subscription still exists (permission can be granted
// while the subscription itself expired or was revoked server-side).
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

// Requests permission (if needed), subscribes this browser, and saves the
// subscription server-side. Safe to call again on an already-subscribed
// browser — PushManager.subscribe() just hands back the existing
// subscription, and the save is an upsert (see /api/push/subscribe).
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: "Push notifications aren't supported on this browser." };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { ok: false, error: "Push notifications aren't configured yet." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notification permission was not granted." };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || "Could not save your subscription." };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not enable notifications." };
  }
}

// Unsubscribes this browser both locally and server-side. Local
// unsubscribe still happens even if the server call fails — a stale
// server-side row just means one dead endpoint web-push will clean up the
// next time it 404s/410s sending to it (see src/lib/push/send.ts).
export async function disablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: true };

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return { ok: true };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not disable notifications." };
  }
}
