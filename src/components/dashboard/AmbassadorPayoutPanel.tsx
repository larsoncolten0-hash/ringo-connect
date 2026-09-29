"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import type { MyPayoutOverview } from "@/lib/ambassador/payouts";

// Ambassador Program — the caller's own payout balances, private destination,
// request button and history. Every figure comes from the server-resolved
// overview (keyed by the session user). PRIVACY: the browser only ever holds
// the MASKED destination label; when the person types a new destination it goes
// to the server and is never echoed back. The request button sends only the
// role — no amount, no destination — so nothing here can influence what is
// paid or where it goes. The minimum and cooldown shown are informational: the
// database enforces both.
export default function AmbassadorPayoutPanel({ overview }: { overview: MyPayoutOverview }) {
  const { t, locale } = useLanguage();
  const p = t.ambassadorPayouts;
  const router = useRouter();
  const dest = overview.destination;

  const [editing, setEditing] = useState(!dest);
  const [method, setMethod] = useState<"mobile_money" | "bank">("mobile_money");
  const [provider, setProvider] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [busy, setBusy] = useState<"save" | "request" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const fmt = (n: number) => formatPrice(n, overview.currency, locale);
  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  const errors = p.errors as Record<string, string>;
  const statusLabels = p.status as Record<string, string>;

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { res, json: await res.json().catch(() => ({})) };
  }

  async function saveDestination() {
    setBusy("save");
    setMessage(null);
    try {
      const { res, json } = await post("/api/ambassador/payout-destination", {
        role: overview.role,
        method,
        details: method === "mobile_money" ? { provider, phone } : { accountName, accountNumber, bankName },
      });
      if (res.ok && json.ok) {
        setMessage({ kind: "ok", text: json.coolingDown ? p.destinationSavedCooling(when(json.usableAfter)) : p.destinationSaved });
        // Clear what was typed; the server keeps it, the browser does not.
        setPhone("");
        setAccountName("");
        setAccountNumber("");
        setBankName("");
        setEditing(false);
        router.refresh();
      } else {
        setMessage({ kind: "error", text: errors[json.code] || errors.unavailable });
      }
    } catch {
      setMessage({ kind: "error", text: errors.network });
    } finally {
      setBusy(null);
    }
  }

  async function requestPayout() {
    setBusy("request");
    setMessage(null);
    try {
      const { res, json } = await post("/api/ambassador/payouts", { role: overview.role });
      if (res.ok && json.ok) {
        setMessage({ kind: "ok", text: p.requested(fmt(Number(json.amount))) });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: errors[json.code] || errors.unavailable });
      }
    } catch {
      setMessage({ kind: "error", text: errors.network });
    } finally {
      setBusy(null);
    }
  }

  const input = "w-full rounded-lg border border-ringo-border/60 bg-ringo-bg px-3 py-2 text-sm text-ringo-text";
  const canRequest = overview.available > 0 && !!dest && !dest.coolingDown;

  return (
    <section className="max-w-5xl mx-auto px-4 pb-10 flex flex-col gap-4">
      <h2 className="text-base font-semibold text-ringo-text flex items-center gap-2">
        <Wallet size={16} className="text-ringo-indigo" /> {p.title}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          [p.available, overview.available],
          [p.awaitingApproval, overview.awaitingApproval],
          [p.inPayout, overview.inPayout],
          [p.paid, overview.paid],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4">
            <p className="text-xs text-ringo-muted">{label as string}</p>
            <p className="text-lg font-semibold text-ringo-text">{fmt(value as number)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ringo-text">{p.destinationTitle}</h3>
        {dest ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ringo-text">{p.destinationCurrent(dest.maskedLabel)}</p>
            {dest.coolingDown && <p className="text-xs text-amber-600">{p.destinationCoolingDown(when(dest.usableAfter))}</p>}
          </div>
        ) : (
          <p className="text-sm text-ringo-muted">{p.destinationNone}</p>
        )}

        {dest && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="self-start text-sm font-medium text-ringo-indigo">
            {p.changeDestination}
          </button>
        )}

        {editing && (
          <>
            {dest && <p className="text-xs text-ringo-muted">{p.destinationHint}</p>}
            <label className="text-xs text-ringo-muted flex flex-col gap-1">
              {p.method}
              <select value={method} onChange={(e) => setMethod(e.target.value as "mobile_money" | "bank")} className={input}>
                <option value="mobile_money">{p.mobileMoney}</option>
                <option value="bank">{p.bank}</option>
              </select>
            </label>
            {method === "mobile_money" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-ringo-muted flex flex-col gap-1">
                  {p.provider}
                  <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
                    <option value="mtn">MTN</option>
                    <option value="orange">Orange</option>
                  </select>
                </label>
                <label className="text-xs text-ringo-muted flex flex-col gap-1">
                  {p.phone}
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" className={input} />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs text-ringo-muted flex flex-col gap-1">
                  {p.accountName}
                  <input value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="off" className={input} />
                </label>
                <label className="text-xs text-ringo-muted flex flex-col gap-1">
                  {p.accountNumber}
                  <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} autoComplete="off" className={input} />
                </label>
                <label className="text-xs text-ringo-muted flex flex-col gap-1">
                  {p.bankName}
                  <input value={bankName} onChange={(e) => setBankName(e.target.value)} autoComplete="off" className={input} />
                </label>
              </div>
            )}
            <button type="button" onClick={saveDestination} disabled={busy !== null} className="self-start text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
              {busy === "save" ? p.destinationSaving : p.destinationSave}
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ringo-text">{p.requestTitle}</h3>
          <p className="text-xs text-ringo-muted mt-0.5">{p.requestHint}</p>
          {overview.minimumPayout != null && <p className="text-xs text-ringo-muted mt-0.5">{p.minimumNote(fmt(overview.minimumPayout))}</p>}
        </div>
        {overview.available <= 0 ? <p className="text-sm text-ringo-muted">{p.nothingAvailable}</p> : null}
        <div className="flex items-center gap-3">
          <button type="button" onClick={requestPayout} disabled={busy !== null || !canRequest} className="text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
            {busy === "request" ? p.requesting : p.requestCta}
          </button>
        </div>
      </div>

      {message && <p className={`text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}

      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
        <h3 className="text-sm font-semibold text-ringo-text px-4 pt-4">{p.historyTitle}</h3>
        {overview.payouts.length === 0 ? (
          <p className="text-sm text-ringo-muted px-4 py-4">{p.noPayouts}</p>
        ) : (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                <th className="px-4 py-2 font-medium">{p.colAmount}</th>
                <th className="px-4 py-2 font-medium">{p.colStatus}</th>
                <th className="px-4 py-2 font-medium">{p.colDate}</th>
              </tr>
            </thead>
            <tbody>
              {overview.payouts.map((row) => (
                <tr key={row.id} className="border-b border-ringo-border/40 last:border-0">
                  <td className="px-4 py-2 text-ringo-text">{formatPrice(row.amount, row.currency, locale)}</td>
                  <td className="px-4 py-2 text-ringo-muted">{statusLabels[row.status] || row.status}</td>
                  <td className="px-4 py-2 text-ringo-muted">{new Date(row.requestedAt).toLocaleDateString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
