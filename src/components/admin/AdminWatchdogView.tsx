"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { renderWatchdogAlert } from "@/lib/watchdog/alerts";
import type { WatchdogParams, WatchdogRuleCode, WatchdogSeverity } from "@/lib/watchdog/rules";

export type WatchdogRow = {
  id: string;
  created_at: string;
  rule_code: WatchdogRuleCode;
  severity: WatchdogSeverity;
  event_type: string;
  subject_user_id: string | null;
  params: WatchdogParams | null;
  status: "open" | "acknowledged" | "resolved";
  acknowledged_at: string | null;
  resolved_at: string | null;
};

const SEVERITY_STYLE: Record<WatchdogSeverity, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
};
const STATUS_STYLE: Record<WatchdogRow["status"], string> = {
  open: "bg-red-50 text-red-700 border-red-200",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// The incident feed, and nothing more: severity, rule, a plain-language summary, when, status, and the two status buttons. No charts, no scores. The summary is rendered
// from the rule code + a few safe values in the viewer's language; the row holds no message, phone number, email or destination.
export default function AdminWatchdogView({ rows, limit }: { rows: WatchdogRow[]; limit: number }) {
  const { t, locale } = useLanguage();
  const f = t.watchdog.feed;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function move(id: string, status: "acknowledged" | "resolved") {
    setBusy(id);
    setError(false);
    try {
      const res = await fetch(`/api/admin/watchdog/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) setError(true);
      else router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{f.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ringo-muted">{f.subtitle}</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{f.actionFailed}</p>}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-ringo-muted">{f.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const alert = renderWatchdogAlert(locale, r.rule_code, r.severity, r.params || {});
            const payoutId = typeof r.params?.payoutId === "string" ? r.params.payoutId : null;
            return (
              <li key={r.id} className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[r.severity]}`}>{t.watchdog.severity[r.severity]}</span>
                  <span className="text-xs font-mono text-ringo-muted">{r.rule_code}</span>
                  <span className="text-sm font-medium">{alert.ruleTitle}</span>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{f[r.status]}</span>
                </div>
                <p className="mt-2 text-sm">{alert.body}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ringo-muted">
                  <span>{new Date(r.created_at).toLocaleString(locale)}</span>
                  {r.subject_user_id && <span>{f.account}: <span className="font-mono">{r.subject_user_id.slice(0, 8)}</span></span>}
                  {payoutId && <span>{f.reference}: <span className="font-mono">{payoutId.slice(0, 8)}</span></span>}
                  {r.acknowledged_at && <span>{f.acknowledgedAt}: {new Date(r.acknowledged_at).toLocaleString(locale)}</span>}
                  {r.resolved_at && <span>{f.resolvedAt}: {new Date(r.resolved_at).toLocaleString(locale)}</span>}
                </p>
                {r.status !== "resolved" && (
                  <div className="mt-3 flex gap-2">
                    {r.status === "open" && (
                      <button type="button" disabled={busy === r.id} onClick={() => move(r.id, "acknowledged")} className="min-h-[44px] rounded-lg border px-3 text-sm font-medium disabled:opacity-50">
                        {f.acknowledge}
                      </button>
                    )}
                    <button type="button" disabled={busy === r.id} onClick={() => move(r.id, "resolved")} className="min-h-[44px] rounded-lg border px-3 text-sm font-medium disabled:opacity-50">
                      {f.resolve}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length >= limit && <p className="text-xs text-ringo-muted">{f.showing(limit)}</p>}
    </div>
  );
}
