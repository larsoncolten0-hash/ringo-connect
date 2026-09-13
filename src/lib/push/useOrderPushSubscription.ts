"use client";

import { useCallback, useEffect, useState } from "react";
import { getPushStatus, subscribeToPush } from "./subscribeClient";

export type OrderPushStatus = "loading" | "unsupported" | "denied" | "off" | "on";

// Push subscription state for ONE guest order — shared by
// RestaurantOrderPage.tsx's own confirmation step (right after checkout)
// and the standalone /order/[id] tracking page (reached later, e.g. from
// a notification, a bookmark, or a second visit).
//
// This is also where the "don't ask a returning customer again" rule
// (see PART 3 of the notifications plan) actually lives: a
// push_subscriptions row is keyed one-to-one by order_id (see
// 2026-09-24_push_notifications.sql), so watching a NEW order requires
// re-POSTing to /api/push/subscribe-order with the new order's id even
// when the browser's own Notification.permission is already "granted"
// and PushManager already holds a subscription from a previous order —
// otherwise the existing endpoint just stays silently pointed at the old
// order and the customer stops getting updates on this one.
//
// subscribeToPush() itself is what makes silently re-associating safe:
// it only ever calls Notification.requestPermission() when the current
// permission is "default" (see subscribeClient.ts) — calling it while
// permission is already "granted" reuses the existing browser
// subscription object and never shows a prompt. So the branch below is
// exactly PART 7's four cases: "granted" re-associates with zero UI,
// "default" waits for the caller to invoke `enable()` from a real click,
// "denied" is surfaced as-is for the caller to explain, and unsupported
// browsers get a stable "unsupported" state to hide the control on.
export function useOrderPushSubscription(orderId: string | null | undefined) {
  const [status, setStatus] = useState<OrderPushStatus>("loading");

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    (async () => {
      const current = await getPushStatus();
      if (cancelled) return;

      if (!current.supported) {
        setStatus("unsupported");
        return;
      }
      if (current.permission === "denied") {
        setStatus("denied");
        return;
      }
      if (current.permission === "granted") {
        // Silent re-association — no permission prompt (already decided),
        // no "Notify me?" button shown, no extra tap for a returning
        // customer. Covers both "already subscribed for a previous order"
        // and "granted via the account/community toggle on this same
        // browser but never subscribed for an order before."
        const result = await subscribeToPush({ subscribeUrl: "/api/push/subscribe-order", extra: { orderId } });
        if (!cancelled) setStatus(result.ok ? "on" : "off");
        return;
      }

      // "default" — genuinely undecided; wait for enable() from a click.
      setStatus("off");
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const enable = useCallback(async () => {
    if (!orderId || status === "unsupported" || status === "on") return;
    setStatus("loading");
    const result = await subscribeToPush({ subscribeUrl: "/api/push/subscribe-order", extra: { orderId } });
    setStatus(result.ok ? "on" : result.error === "permission_denied" ? "denied" : "off");
  }, [orderId, status]);

  return { status, enable };
}
