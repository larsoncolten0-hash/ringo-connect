"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPushStatus, subscribeToPush, unsubscribeFromPush } from "@/lib/push/subscribeClient";
import { useInstallPrompt } from "./useInstallPrompt";

const SUBSCRIBE_URL = "/api/customer/push/subscribe";
const UNSUBSCRIBE_URL = "/api/customer/push/unsubscribe";
const STATUS_URL = "/api/customer/push/status";

type State = "loading" | "on" | "off" | "denied" | "unsupported" | "ios-needs-install" | "busy" | "failed";

// Customer push notifications for THIS device, kept strictly separate from
// Connect: connecting to a profile never turns these on, and this card is the
// one place (besides the optional prompt right after connecting) that asks
// for the browser permission — only ever from a click, never on load.
//
// Reuses the existing helpers (getPushStatus / subscribeToPush /
// unsubscribeFromPush) and the existing customer route; subscriptions are
// stored in customer_push_subscriptions only. "On" means THIS device's push
// endpoint is registered for THIS customer (checked against the server), not
// merely that the browser holds some subscription — it might belong to the
// creator dashboard.
export default function NotificationsCard() {
  const { t } = useLanguage();
  const { state: installState } = useInstallPrompt();
  const n = t.myRingo.notifications;
  const [state, setState] = useState<State>("loading");

  const refresh = useCallback(async () => {
    const status = await getPushStatus();
    if (!status.supported) {
      // iOS only exposes push to installed apps; explain that instead of "unsupported".
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      return setState(ios ? "ios-needs-install" : "unsupported");
    }
    if (status.permission === "denied") return setState("denied");
    if (status.permission !== "granted" || !status.subscribed) return setState("off");

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) return setState("off");
      const res = await fetch(STATUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const data = await res.json().catch(() => null);
      setState(res.ok && data?.registered === true ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, installState]);

  const enable = async () => {
    if (state === "busy") return;
    // First await in the click handler — iOS drops permission requests otherwise.
    const pending = subscribeToPush({ subscribeUrl: SUBSCRIBE_URL });
    setState("busy");
    const result = await pending;
    if (result.ok) return setState("on");
    setState(result.error === "permission_denied" ? "denied" : "failed");
  };

  const disable = async () => {
    if (state === "busy") return;
    setState("busy");
    const result = await unsubscribeFromPush(UNSUBSCRIBE_URL);
    if (!result.ok) return setState("failed");
    setState("off");
  };

  const message: Record<State, string | null> = {
    loading: n.checking,
    on: n.on,
    off: n.off,
    denied: n.denied,
    unsupported: n.unsupported,
    "ios-needs-install": n.iosHint,
    busy: null,
    failed: n.failed,
  };
  const Icon = state === "on" ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            state === "on" ? "bg-emerald-500/10 text-emerald-600" : "bg-ringo-indigo/10 text-ringo-indigo"
          }`}
        >
          <Icon size={19} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ringo-text">{n.title}</p>
          <p className="mt-0.5 text-xs text-ringo-muted">{n.body}</p>
          {message[state] && (
            <p className={`mt-1.5 text-xs font-medium ${state === "on" ? "text-emerald-600" : state === "failed" ? "text-red-600" : "text-ringo-muted"}`}>
              {message[state]}
            </p>
          )}
        </div>
      </div>

      {(state === "off" || state === "failed" || (state === "busy")) && (
        <button
          onClick={enable}
          disabled={state === "busy"}
          className="flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
        >
          {state === "busy" && <Loader2 size={15} className="animate-spin" />}
          {n.enable}
        </button>
      )}
      {state === "on" && (
        <button
          onClick={disable}
          className="rounded-xl border border-ringo-border px-4 py-2.5 text-sm font-medium text-ringo-muted transition hover:bg-ringo-muted/10"
        >
          {n.disable}
        </button>
      )}
    </div>
  );
}
