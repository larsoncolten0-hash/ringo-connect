"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPushStatus, subscribeToPush } from "@/lib/push/subscribeClient";

const SUBSCRIBE_URL = "/api/customer/push/subscribe";

type State = "loading" | "on" | "off" | "denied" | "unsupported" | "busy" | "failed";

// The optional "Never miss an update" step shown after connecting. Reuses
// the EXISTING browser push plumbing (getPushStatus / subscribeToPush —
// the same helpers the dashboard toggle and the community join page use);
// the only new part is the URL it registers the subscription with, which
// stores it against the Ringo CUSTOMER (customer_push_subscriptions),
// never the legacy push_subscriptions table.
//
// Never prompts on its own: getPushStatus only READS state. The browser
// permission dialog appears only from the "Receive Notifications" click. If
// permission was already granted, the existing browser subscription is
// silently registered to this customer (no dialog) and the state shows
// "Notifications On"; if it was denied, an explanation is shown instead of
// a request that would silently do nothing.
export default function ConnectedNotificationsPrompt({
  profileName,
  accent,
  onDone,
}: {
  profileName: string;
  accent: string;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await getPushStatus();
      if (cancelled) return;
      if (!status.supported) return setState("unsupported");
      if (status.permission === "denied") return setState("denied");
      if (status.permission === "granted" && status.subscribed) {
        // Already allowed on this device — attach it to this customer
        // without asking again.
        const result = await subscribeToPush({ subscribeUrl: SUBSCRIBE_URL });
        if (!cancelled) setState(result.ok ? "on" : "off");
        return;
      }
      setState("off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    if (state === "busy") return;
    // subscribeToPush must be the FIRST await in this click handler — iOS
    // silently drops permission requests otherwise (see its own comment).
    const pending = subscribeToPush({ subscribeUrl: SUBSCRIBE_URL });
    setState("busy");
    const result = await pending;
    setState(result.ok ? "on" : result.error === "permission_denied" ? "denied" : "failed");
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ringo-border/70 p-4 text-left">
      <div className="flex items-center gap-2">
        <BellRing size={16} style={{ color: accent }} />
        <p className="text-sm font-semibold text-ringo-text">{t.connect.notifTitle}</p>
      </div>
      <p className="text-sm text-ringo-muted">{t.connect.notifBody(profileName)}</p>

      {state === "on" && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <Check size={14} /> {t.connect.notifOn}
        </p>
      )}
      {state === "denied" && <p className="text-xs text-ringo-muted">{t.connect.notifDenied}</p>}
      {state === "unsupported" && <p className="text-xs text-ringo-muted">{t.connect.notifUnsupported}</p>}
      {state === "failed" && <p className="text-xs text-red-600">{t.connect.notifFailed}</p>}

      {(state === "off" || state === "busy" || state === "failed") && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={enable}
            disabled={state === "busy"}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {state === "busy" ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />}
            {t.connect.notifReceive}
          </button>
          <button onClick={onDone} className="rounded-xl px-4 py-3 text-sm text-ringo-muted hover:bg-ringo-muted/10 transition">
            {t.connect.notifLater}
          </button>
        </div>
      )}

      {(state === "on" || state === "denied" || state === "unsupported" || state === "loading") && (
        <button
          onClick={onDone}
          disabled={state === "loading"}
          className="rounded-xl px-4 py-3 text-sm font-medium text-ringo-text bg-ringo-muted/10 hover:bg-ringo-muted/15 transition disabled:opacity-50"
        >
          {t.connect.done}
        </button>
      )}
    </div>
  );
}
