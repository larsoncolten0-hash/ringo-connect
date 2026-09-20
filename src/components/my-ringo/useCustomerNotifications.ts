"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxItem } from "@/lib/customer/inbox";

// The My Ringo bell's data: the unread count (polled cheaply, and re-checked whenever the app
// comes back into view) and the notification list (loaded when the panel opens). The unread
// count is also written to the app-icon badge, so a notification that was swiped away still
// leaves a number on the icon until it is read. Mounted once, in the shell.

const POLL_MS = 20000;

function setIconBadge(count: number) {
  try {
    const nav = navigator as any;
    if (count > 0 && "setAppBadge" in nav) nav.setAppBadge(count).catch(() => {});
    else if (count === 0 && "clearAppBadge" in nav) nav.clearAppBadge().catch(() => {});
  } catch {
    // Badging API missing or blocked: the in-app bell still shows the count.
  }
}

export function useCustomerNotifications() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const openRef = useRef(false);

  const applyUnread = useCallback((n: number) => {
    setUnread(n);
    setIconBadge(n);
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch("/api/customer/notifications?count=1", { cache: "no-store" });
      if (res.ok) applyUnread((await res.json()).unread ?? 0);
    } catch {
      // Offline or a transient error: keep the last known count.
    }
  }, [applyUnread]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/customer/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        applyUnread(data.unread ?? 0);
      }
    } catch {
      // Keep whatever list is already showing.
    } finally {
      setLoading(false);
    }
  }, [applyUnread]);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (openRef.current) loadItems();
      else refreshCount();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") (openRef.current ? loadItems : refreshCount)();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshCount, loadItems]);

  const setPanelOpen = useCallback(
    (open: boolean) => {
      openRef.current = open;
      if (open) loadItems();
    },
    [loadItems]
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      const now = new Date().toISOString();
      setItems((prev) => prev && prev.map((i) => (ids.includes(i.id) && !i.readAt ? { ...i, readAt: now } : i)));
      try {
        const res = await fetch("/api/customer/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (res.ok) applyUnread((await res.json()).unread ?? 0);
      } catch {
        refreshCount();
      }
    },
    [applyUnread, refreshCount]
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev && prev.map((i) => (i.readAt ? i : { ...i, readAt: now })));
    applyUnread(0);
    try {
      await fetch("/api/customer/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      refreshCount();
    }
  }, [applyUnread, refreshCount]);

  return { unread, items, loading, setPanelOpen, markRead, markAllRead };
}

export type CustomerNotifications = ReturnType<typeof useCustomerNotifications>;
