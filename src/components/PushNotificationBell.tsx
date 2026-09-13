"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { usePushToggle } from "@/lib/push/usePushToggle";
import { Bell, BellOff, BellRing } from "lucide-react";

// A compact manual on/off control for OS push notifications — kept only
// where someone has already gone looking for a settings-style control
// (the admin settings test card, and the account-menu toggle it mirrors
// in AvatarMenu.tsx). The ambient header/sidebar chrome no longer uses
// this: an easy-to-miss icon isn't how most people ever discover push at
// all, so DashboardShell/AdminShell now show PushPermissionPrompt.tsx
// instead — a proactive prompt that asks up front, the same way a native
// app's system permission dialog would.
//
// Named PushNotificationBell, not NotificationBell — that name is taken
// by a separate, complementary component: a persistent, cross-device
// in-app feed backed by the `notifications` table (see
// src/components/NotificationBell.tsx).
export default function PushNotificationBell({ variant = "default" }: { variant?: "default" | "onDark" }) {
  const { t } = useLanguage();
  const { status, busy, toggle } = usePushToggle("/api/push/subscribe");

  if (status === "unsupported") return null;

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
