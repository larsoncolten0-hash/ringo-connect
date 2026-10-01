"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { REMINDER_DEFAULTS, REMINDER_RANGES } from "@/lib/receivables/constants";
import { callApi, inputClass, labelClass, primaryButton, useFormatters, useRecvErrorText } from "./shared";

type Settings = { auto_email_enabled: boolean; auto_enabled_at: string | null; remind_before_days: number | null; remind_on_due: boolean; overdue_every_days: number | null; max_auto_per_invoice: number; owner_alerts_enabled: boolean };

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

/** Reminder settings. Automatic email reminders and owner alerts are OFF by default; enabling automatic email needs a business email (reply address). */
export default function ReminderSettingsForm() {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const f = useFormatters();
  const [s, setS] = useState<Settings | null>(null);
  const [hasEmail, setHasEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await callApi("GET", "/api/receivables/settings");
      if (!res.ok) return setError(errorText(res.data));
      setS(res.data.settings);
      setHasEmail(res.data.business_email_present === true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await callApi("PUT", "/api/receivables/settings", {
      auto_email_enabled: s.auto_email_enabled, remind_before_days: s.remind_before_days, remind_on_due: s.remind_on_due, overdue_every_days: s.overdue_every_days,
      max_auto_per_invoice: s.max_auto_per_invoice, owner_alerts_enabled: s.owner_alerts_enabled,
    });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    setS(res.data);
    setSaved(true);
  };

  if (!s) return error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{r.loading}</span></div>;
  const set = (patch: Partial<Settings>) => { setSaved(false); setS({ ...s, ...patch }); };
  const auto = s.auto_email_enabled;
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{r.settingsTitle}</h1>
        <p className="text-sm text-ringo-muted">{r.settingsIntro}</p>
      </div>

      <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-4">
        <label className="flex items-start gap-3 text-sm text-ringo-text">
          <input type="checkbox" checked={auto} disabled={!hasEmail && !auto} onChange={(e) => set({ auto_email_enabled: e.target.checked })} className="accent-ringo-indigo mt-1" />
          <span><span className="font-medium">{r.autoEmail}</span><br /><span className="text-ringo-muted">{r.autoEmailHelp}</span></span>
        </label>
        {!hasEmail && <p className="text-sm text-amber-700 dark:text-amber-400">{r.needBusinessEmail} <Link href="/dashboard/documents/settings" className="text-ringo-indigo hover:underline">{r.businessDetails}</Link></p>}
        {auto && s.auto_enabled_at && <p className="text-xs text-ringo-muted">{r.enabledSince(f.when(s.auto_enabled_at))}</p>}

        {auto && (
          <div className="flex flex-col gap-4">
            <label className={labelClass}>
              {r.beforeDue}
              <select value={s.remind_before_days ?? ""} onChange={(e) => set({ remind_before_days: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass}>
                <option value="">{r.off}</option>
                {range(REMINDER_RANGES.beforeDays.min, REMINDER_RANGES.beforeDays.max).map((n) => <option key={n} value={n}>{r.daysBefore(n)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-ringo-text">
              <input type="checkbox" checked={s.remind_on_due} onChange={(e) => set({ remind_on_due: e.target.checked })} className="accent-ringo-indigo" />
              {r.onDueDay}
            </label>
            <label className={labelClass}>
              {r.overdueEvery}
              <select value={s.overdue_every_days ?? ""} onChange={(e) => set({ overdue_every_days: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass}>
                <option value="">{r.off}</option>
                {range(REMINDER_RANGES.overdueEveryDays.min, REMINDER_RANGES.overdueEveryDays.max).map((n) => (
                  <option key={n} value={n}>{r.daysEvery(n)}{n === REMINDER_DEFAULTS.overdueEveryDays ? ` (${r.defaultMarker})` : ""}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {r.maxPerInvoice}
              <select value={s.max_auto_per_invoice} onChange={(e) => set({ max_auto_per_invoice: Number(e.target.value) })} className={inputClass}>
                {range(REMINDER_RANGES.maxAutoPerInvoice.min, REMINDER_RANGES.maxAutoPerInvoice.max).map((n) => (
                  <option key={n} value={n}>{r.maxOption(n)}{n === REMINDER_DEFAULTS.maxAutoPerInvoice ? ` (${r.defaultMarker})` : ""}</option>
                ))}
              </select>
            </label>
            <p className="text-xs text-ringo-muted">{r.limitsInfo}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5">
        <label className="flex items-start gap-3 text-sm text-ringo-text">
          <input type="checkbox" checked={s.owner_alerts_enabled} onChange={(e) => set({ owner_alerts_enabled: e.target.checked })} className="accent-ringo-indigo mt-1" />
          <span><span className="font-medium">{r.ownerAlerts}</span><br /><span className="text-ringo-muted">{r.ownerAlertsHelp}</span></span>
        </label>
      </section>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {saved && <p role="status" className="text-sm text-emerald-600">{r.saved}</p>}
      <button onClick={save} disabled={busy} className={`${primaryButton} self-start`}>{busy ? <><Loader2 size={15} className="animate-spin" />{r.saving}</> : r.save}</button>
    </div>
  );
}
