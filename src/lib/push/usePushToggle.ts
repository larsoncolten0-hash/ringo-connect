"use client";

import { useCallback, useEffect, useState } from "react";
import { getPushStatus, subscribeToPush, unsubscribeFromPush, PUSH_STATUS_CHANGE_EVENT } from "./subscribeClient";

// "error" is its own status, not folded into "off" — a plain "off" looks
// identical to someone who simply never turned it on, while "error"
// means enable() actually ran and failed (e.g. the server's VAPID key
// isn't configured for this deployment, or the subscribe POST failed).
// Surfacing it separately is what makes a silently-stuck toggle
// debuggable instead of looking like nothing happened at all.
export type PushToggleStatus = "loading" | "unsupported" | "denied" | "off" | "on" | "error";

// Shared state machine behind every push on/off control in the app
// (PushNotificationBell.tsx, AvatarMenu.tsx's account-menu toggle, and
// PushPermissionPrompt.tsx all use this instead of each re-implementing
// the same getPushStatus/subscribeToPush/unsubscribeFromPush dance) —
// one place to get the loading/unsupported/off/on state machine right.
//
// "denied" is its own status, not just another flavor of "off": once the
// browser's Notification permission is denied, requestPermission() never
// shows a prompt again — it resolves instantly and silently with
// "denied" (see subscribeClient.ts). Without surfacing that separately,
// a click on the toggle would look like it did nothing at all (no
// popup, no state change), same bug useOrderPushSubscription.ts already
// guards against for the guest order flow.
export function usePushToggle(subscribeUrl: string) {
  const [status, setStatus] = useState<PushToggleStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getPushStatus().then((s) => {
        if (cancelled) return;
        setStatus(!s.supported ? "unsupported" : s.permission === "denied" ? "denied" : s.subscribed ? "on" : "off");
      });

    refresh();
    // Re-checks whenever ANY toggle/prompt on the page actually changes
    // the subscription — see subscribeClient.ts's notifyPushStatusChanged
    // for why this is needed (PushPermissionPrompt.tsx enables push
    // without going through this hook at all).
    window.addEventListener(PUSH_STATUS_CHANGE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PUSH_STATUS_CHANGE_EVENT, refresh);
    };
  }, []);

  const enable = useCallback(async () => {
    if (busy || status === "loading" || status === "unsupported") return false;
    setBusy(true);
    setError(null);
    try {
      const result = await subscribeToPush({ subscribeUrl });
      setStatus(result.ok ? "on" : result.error === "permission_denied" ? "denied" : "error");
      if (!result.ok && result.error !== "permission_denied") setError(result.error || "subscribe_failed");
      return result.ok;
    } finally {
      setBusy(false);
    }
  }, [busy, status, subscribeUrl]);

  const disable = useCallback(async () => {
    if (busy || status !== "on") return;
    setBusy(true);
    try {
      await unsubscribeFromPush("/api/push/unsubscribe");
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }, [busy, status]);

  const toggle = useCallback(async () => {
    if (status === "on") await disable();
    else await enable();
  }, [status, enable, disable]);

  return { status, busy, error, enable, disable, toggle };
}
