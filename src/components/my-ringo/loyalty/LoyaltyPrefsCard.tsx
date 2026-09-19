"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api } from "@/components/loyalty/format";

// The customer's loyalty notification preferences. Separate from (a) the per-device push
// permission in Me -> Notifications and (b) marketing consent, which stays per business on the
// connection. The server is the source of truth: a toggle is sent to the API and only kept if
// the save succeeded.
function Toggle({ checked, disabled, label, hint, onChange }: { checked: boolean; disabled?: boolean; label: string; hint: string; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-3 ${disabled ? "opacity-60" : ""}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ringo-text">{label}</span>
        <span className="block text-xs text-ringo-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-9 shrink-0 cursor-pointer accent-ringo-indigo"
      />
    </label>
  );
}

export default function LoyaltyPrefsCard({
  initial,
  emailConfirmed,
}: {
  initial: { notificationsEnabled: boolean; emailEnabled: boolean };
  emailConfirmed: boolean;
}) {
  const { t } = useLanguage();
  const p = t.myRingo.loyalty.prefs;
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(patch: { notifications_enabled?: boolean; email_enabled?: boolean }) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await api("/api/customer/loyalty/prefs", { method: "POST", body: patch });
    setBusy(false);
    if (res.status === 200 && res.data?.prefs) {
      setPrefs({ notificationsEnabled: res.data.prefs.notificationsEnabled, emailEnabled: res.data.prefs.emailEnabled });
      setMessage({ kind: "ok", text: p.saved });
    } else {
      setMessage({ kind: "error", text: p.failed });
    }
  }

  return (
    <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
      <h2 className="text-sm font-semibold text-ringo-text">{p.title}</h2>
      <p className="mt-1 text-xs text-ringo-muted">{p.body}</p>

      <div className="mt-2 divide-y divide-ringo-border/50">
        <Toggle checked={prefs.notificationsEnabled} disabled={busy} label={p.pushLabel} hint={p.pushHint} onChange={(v) => save({ notifications_enabled: v })} />
        <Toggle
          checked={prefs.emailEnabled}
          disabled={busy || !prefs.notificationsEnabled || !emailConfirmed}
          label={p.emailLabel}
          hint={emailConfirmed ? p.emailHint : p.emailNeedsConfirm}
          onChange={(v) => save({ email_enabled: v })}
        />
      </div>

      <p className="mt-2 text-xs text-ringo-muted">{p.marketingNote}</p>
      <div aria-live="polite" role="status">
        {message && <p className={`mt-2 text-xs font-medium ${message.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
