"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api } from "@/components/loyalty/format";

// The customer's marketing consent, per connected profile and per channel (email, push). Everything is OFF until the customer turns it on; turning it off always works. The server is the source of
// truth: a switch only changes after the API confirmed it. Separate from order, booking, ticket and loyalty notifications (not touched here). There is no WhatsApp option.
type Channel = "email" | "push";
type ChannelState = { on: boolean; state: "on" | "pending" | "off"; reason: string };
type Item = { profile_id: string; profile_name: string; email: ChannelState; push: ChannelState };

function Switch({ checked, disabled, label, hint, name, onChange }: { checked: boolean; disabled?: boolean; label: string; hint: string; name: string; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2.5 ${disabled ? "opacity-60" : ""}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ringo-text">{label}</span>
        <span className="block text-xs text-ringo-muted">{hint}</span>
      </span>
      <input type="checkbox" role="switch" aria-label={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-9 shrink-0 cursor-pointer accent-ringo-indigo" />
    </label>
  );
}

export default function ConsentSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useLanguage();
  const c = t.myRingo.connections.consent;
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items?: Item[] }>("/api/customer/consent").then((r) => {
      if (alive) setItems(r.status === 200 && Array.isArray(r.data?.items) ? r.data!.items! : []);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function set(profileId: string, channel: Channel, enabled: boolean) {
    if (busy) return;
    setBusy(`${profileId}:${channel}`);
    setMessage(null);
    const res = await api<{ item?: Item; error?: string }>("/api/customer/consent", { method: "PUT", body: { profile_id: profileId, channel, enabled } });
    setBusy(null);
    if (res.status === 200 && res.data?.item) {
      const item = res.data.item;
      setItems((prev) => (prev || []).map((i) => (i.profile_id === item.profile_id ? item : i)));
      setMessage({ kind: "ok", text: enabled ? c.savedOn : c.savedOff });
    } else if (res.status === 503) {
      setMessage({ kind: "error", text: c.unavailable });
    } else if (res.status === 409 || res.status === 404) {
      setMessage({ kind: "error", text: c.notConnected });
    } else {
      setMessage({ kind: "error", text: c.failed });
    }
  }

  if (items === null) return <p className="mt-8 text-xs text-ringo-muted">{c.loading}</p>;

  const hintFor = (s: ChannelState, base: string, channel: Channel): string => {
    if (s.reason === "removed_by_creator") return c.removed;
    if (s.reason === "unsubscribed") return c.unsubscribed;
    if (s.state === "pending") return s.reason === "email_unconfirmed" && channel === "email" ? c.pendingEmail : c.pendingApply;
    return base;
  };

  return (
    <section className="mt-8 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4" aria-labelledby="consent-title">
      <h2 id="consent-title" className="text-sm font-semibold text-ringo-text">{c.title}</h2>
      <p className="mt-1 text-xs text-ringo-muted">{c.intro}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-ringo-muted">{c.empty}</p>
      ) : (
        <div className="mt-2 divide-y divide-ringo-border/50">
          {items.map((i) => (
            <div key={i.profile_id} className="py-2">
              <p className="text-sm font-semibold text-ringo-text">{i.profile_name}</p>
              <Switch checked={i.email.state !== "off"} disabled={busy !== null} label={c.emailLabel} name={`${i.profile_name} - ${c.emailLabel}`} hint={hintFor(i.email, c.emailHint, "email")} onChange={(v) => set(i.profile_id, "email", v)} />
              <Switch checked={i.push.state !== "off"} disabled={busy !== null} label={c.pushLabel} name={`${i.profile_name} - ${c.pushLabel}`} hint={hintFor(i.push, c.pushHint, "push")} onChange={(v) => set(i.profile_id, "push", v)} />
            </div>
          ))}
        </div>
      )}
      <div aria-live="polite" role="status">
        {message && <p className={`mt-2 text-xs font-medium ${message.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
