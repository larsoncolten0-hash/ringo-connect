"use client";

import { useEffect, useState } from "react";
import { Bell, X, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPushStatus, subscribeToPush } from "@/lib/push/subscribeClient";

// Asked once per browser, then never again regardless of the answer —
// same "don't nag" posture as the browser's own permission dialog, which
// this is deliberately timed to trigger (calling subscribeToPush() is
// what actually pops it).
const DISMISS_KEY = "ringo-push-prompt-dismissed";

// A proactive "turn on notifications?" prompt, shown automatically
// instead of requiring someone to notice and click a header icon — the
// bell icon this replaces (still available as a manual control in
// AvatarMenu's account menu and /admin/settings, see
// PushNotificationBell.tsx) was too easy to miss entirely. Mounted once
// each in DashboardShell and AdminShell.
export default function PushPermissionPrompt({ subscribeUrl, body }: { subscribeUrl: string; body: string }) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    (async () => {
      if (typeof window === "undefined" || localStorage.getItem(DISMISS_KEY)) return;
      const status = await getPushStatus();
      if (cancelled) return;
      // Only when the browser genuinely hasn't decided yet — already
      // granted (subscribed via the manual toggle elsewhere) or already
      // denied both make asking again either redundant or a dead end.
      if (status.supported && status.permission === "default") {
        // A beat after first paint so it never fights the page's own
        // initial render for attention.
        timer = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, 1500);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      await subscribeToPush({ subscribeUrl });
    } finally {
      localStorage.setItem(DISMISS_KEY, "1");
      setBusy(false);
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-24 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-80 z-50 animate-fade-in"
      role="dialog"
      aria-label={t.pushNotifications.promptTitle}
    >
      <div className="rounded-2xl border border-ringo-border/70 bg-ringo-surface shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] p-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Bell size={16} className="text-ringo-indigo" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ringo-text">{t.pushNotifications.promptTitle}</p>
            <p className="text-xs text-ringo-muted mt-0.5">{body}</p>
          </div>
          <button
            onClick={dismiss}
            aria-label={t.pushNotifications.promptDismiss}
            className="shrink-0 w-6 h-6 -mt-1 -mr-1 flex items-center justify-center rounded-full text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3.5">
          <button
            onClick={enable}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-full bg-ringo-indigo text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {t.pushNotifications.promptEnable}
          </button>
          <button
            onClick={dismiss}
            className="text-sm font-medium py-2 px-3 rounded-full text-ringo-muted hover:bg-ringo-muted/10 transition-colors"
          >
            {t.pushNotifications.promptDismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
