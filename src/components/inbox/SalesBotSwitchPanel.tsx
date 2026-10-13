"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool, salesBotSwitchUrl } from "@/lib/inbox/client";

// The owner's Smart Card sales bot ON/OFF switch: one button, one call to our own route (the profile comes from the session, never from here; the database checks it again
// and logs the change). Nothing on this page sends a message. enabled === null means the saved value could not be read: the switch is then not offered.
export default function SalesBotSwitchPanel({ enabled, deploymentConfigured }: { enabled: boolean | null; deploymentConfigured: boolean }) {
  const { t } = useLanguage();
  const u = t.inbox.salesBotPage;
  const router = useRouter();
  const [on, setOn] = useState(enabled === true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  async function flip() {
    if (inFlight.current || enabled === null) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    const next = !on;
    const r = await callInboxTool("POST", salesBotSwitchUrl, { enabled: next });
    inFlight.current = false;
    setBusy(false);
    if (r.kind === "response" && r.body.ok) {
      setOn(next);
      router.refresh();
    } else setFailed(true);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="sales-bot-page">
      <div>
        <Link href="/dashboard/inbox" className="mb-2 inline-flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text">
          <ArrowLeft size={14} aria-hidden="true" />
          {u.back}
        </Link>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.help}</p>
      </div>

      {enabled === null ? (
        <p role="status" className="rounded-card border border-ringo-border p-3 text-sm text-ringo-muted">{u.unavailable}</p>
      ) : (
        <section className="rounded-card border border-ringo-border p-4" aria-labelledby="sb-status">
          <p id="sb-status" className="text-sm text-ringo-text">
            {u.statusLabel}{" "}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-ringo-muted/15 text-ringo-muted"}`}>{on ? u.statusOn : u.statusOff}</span>
          </p>
          <button
            type="button"
            onClick={() => void flip()}
            disabled={busy}
            data-testid="sales-bot-toggle"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? u.saving : on ? u.turnOff : u.turnOn}
          </button>
          {!deploymentConfigured && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{u.notConfigured}</p>}
          <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
            {failed && <p role="alert" className="text-red-600 dark:text-red-400">{u.saveFailed}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
