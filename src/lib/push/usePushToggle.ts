"use client";

import { useCallback, useEffect, useState } from "react";
import { getPushStatus, subscribeToPush, unsubscribeFromPush } from "./subscribeClient";

export type PushToggleStatus = "loading" | "unsupported" | "off" | "on";

// Shared state machine behind every push on/off control in the app
// (PushNotificationBell.tsx, AvatarMenu.tsx's account-menu toggle, and
// PushPermissionPrompt.tsx all use this instead of each re-implementing
// the same getPushStatus/subscribeToPush/unsubscribeFromPush dance) —
// one place to get the loading/unsupported/off/on state machine right.
export function usePushToggle(subscribeUrl: string) {
  const [status, setStatus] = useState<PushToggleStatus>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushStatus().then((s) => {
      if (cancelled) return;
      setStatus(!s.supported ? "unsupported" : s.subscribed ? "on" : "off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (busy || status === "loading" || status === "unsupported") return false;
    setBusy(true);
    try {
      const result = await subscribeToPush({ subscribeUrl });
      setStatus(result.ok ? "on" : "off");
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

  return { status, busy, enable, disable, toggle };
}
