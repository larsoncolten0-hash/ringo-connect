"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPushStatus, subscribeToPush, unsubscribeFromPush } from "@/lib/push/subscribeClient";

// The "Enable notifications" control for an authenticated Ringo Connect
// user — dropped into DashboardShell's header (creators) and AdminShell's
// sidebar (admins), the only two audiences with their own account and
// therefore the same subscribe endpoint (/api/push/subscribe, scoped by
// auth.uid() via RLS — see that route). Fans and guest restaurant
// customers use the same underlying subscribeClient helpers but through
// their own token/order-scoped routes instead of this component (see the
// community manage page and RestaurantOrderPage.tsx).
//
// Named PushNotificationBell, not NotificationBell — that name is taken
// by a separate, complementary component: a persistent, cross-device
// in-app feed backed by the `notifications` table (see
// src/components/NotificationBell.tsx and
// supabase/migrations/2026-09-12_notifications.sql), which was built
// independently and merged in alongside this one. This component is only
// ever the OS-level Web Push opt-in toggle — a per-device browser
// permission switch, not a list of what already happened.
//
// Same icon-button shape as ThemeToggle's `iconOnly` variant (w-9 h-9
// rounded-full) so it sits naturally next to it in either header.
export default function PushNotificationBell({ variant = "default" }: { variant?: "default" | "onDark" }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"loading" | "unsupported" | "off" | "on">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushStatus().then((s) => {
      if (cancelled) return;
      if (!s.supported) setStatus("unsupported");
      else setStatus(s.subscribed ? "on" : "off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "unsupported") return null;

  const toggle = async () => {
    if (busy || status === "loading") return;
    setBusy(true);
    try {
      if (status === "on") {
        await unsubscribeFromPush("/api/push/unsubscribe");
        setStatus("off");
      } else {
        const result = await subscribeToPush({ subscribeUrl: "/api/push/subscribe" });
        setStatus(result.ok ? "on" : "off");
      }
    } finally {
      setBusy(false);
    }
  };

  const label = status === "on" ? t.pushNotifications.enabled : t.pushNotifications.enable;
  const Icon = status === "on" ? BellRing : status === "loading" ? Bell : BellOff;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={label}
      aria-pressed={status === "on"}
      title={label}
      className={`w-9 h-9 flex items-center justify-center rounded-full transition disabled:opacity-60 ${
        status === "on"
          ? variant === "onDark"
            ? "text-white"
            : "text-ringo-indigo"
          : variant === "onDark"
            ? "text-white/50 hover:text-white hover:bg-white/10"
            : "text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10"
      }`}
    >
      <Icon size={17} />
    </button>
  );
}
