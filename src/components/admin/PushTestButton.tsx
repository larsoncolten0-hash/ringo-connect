"use client";

import { useState } from "react";
import { BellRing, Loader2, Check, AlertTriangle } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";

// Self-contained "Send test notification" card for /admin/settings —
// exercises the whole pipeline end to end (this admin's own
// push_subscriptions row → web-push → the service worker's `push`
// listener) without waiting for a real booking/order/payout to trigger
// one. The bell here is the same NotificationBell already in AdminShell's
// sidebar — included again so "enable, then test" is a two-click flow on
// this one card instead of a trip back to the sidebar.
export default function PushTestButton() {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const sendTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/push-test", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResult({ ok: false, message: data?.error || "Could not send the test notification." });
        return;
      }
      setResult({ ok: true, message: "Sent — check this device's notifications." });
    } catch {
      setResult({ ok: false, message: "Could not send the test notification." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-ringo-text flex items-center gap-1.5">
          <BellRing size={15} className="text-ringo-indigo" />
          Push notifications
        </h2>
        <NotificationBell />
      </div>
      <p className="text-xs text-ringo-muted mb-4">
        Enable notifications with the bell above (once per device), then send yourself a test push to confirm the
        whole pipeline — server, VAPID keys, service worker — actually works before relying on it for real
        bookings, orders and payouts.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={sendTest}
          disabled={sending}
          className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-ringo-indigo text-white disabled:opacity-60"
        >
          {sending && <Loader2 size={14} className="animate-spin" />}
          {sending ? "Sending…" : "Send test notification"}
        </button>
        {result && (
          <span className={`text-xs flex items-center gap-1 ${result.ok ? "text-ringo-teal" : "text-ringo-coral"}`}>
            {result.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}
