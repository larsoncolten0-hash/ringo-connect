"use client";

import { useState, useMemo } from "react";
import {
  Copy,
  Check,
  Share2,
  Users,
  UserCheck,
  Wallet,
  Clock,
  Banknote,
  AlertTriangle,
  PauseCircle,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import StatCard from "@/components/analytics/StatCard";
import AffiliateEarningsChart from "./AffiliateEarningsChart";
import type { AffiliateOverview } from "@/lib/affiliate";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-ringo-indigo/10 text-ringo-indigo",
  available: "bg-ringo-teal/10 text-ringo-teal",
  requested: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  paid: "bg-ringo-teal/10 text-ringo-teal",
  reversed: "bg-red-500/10 text-red-500",
  rejected: "bg-red-500/10 text-red-500",
};

export default function AffiliateView({ overview: initial, siteUrl }: { overview: AffiliateOverview; siteUrl: string }) {
  const { t, locale } = useLanguage();
  const [overview, setOverview] = useState(initial);
  const [copied, setCopied] = useState(false);

  const referralLink = `${siteUrl.replace(/\/$/, "")}/?ref=${overview.affiliateCode}`;
  const currencies = useMemo(() => Object.keys(overview.totalsByCurrency), [overview.totalsByCurrency]);
  const [chartCurrency, setChartCurrency] = useState(currencies[0] || "XAF");
  const activeCurrency = currencies.includes(chartCurrency) ? chartCurrency : currencies[0] || "XAF";

  const chartData = useMemo(
    () => overview.monthly.filter((m) => m.currency === activeCurrency).map(({ month, amount }) => ({ month, amount })),
    [overview.monthly, activeCurrency]
  );

  const refresh = async () => {
    const res = await fetch("/api/affiliate/dashboard");
    if (res.ok) {
      const data = await res.json();
      setOverview(data.overview);
    }
  };

  const statusLabel = (status: string) => (t.affiliate as any)[`status${status[0].toUpperCase()}${status.slice(1)}`] || status;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure
      // context) — the link is still visible and selectable by hand.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ url: referralLink, title: "Ringo Connect" });
      } catch {
        // User cancelled the share sheet — not an error.
      }
    } else {
      copyLink();
    }
  };

  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">{t.affiliate.eyebrow}</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{t.affiliate.title}</h1>
        <p className="text-sm text-ringo-muted max-w-lg">{t.affiliate.subtitle}</p>
      </div>

      {!overview.settings.enabled && (
        <Banner icon={PauseCircle} tone="amber">
          {t.affiliate.disabledNotice}
        </Banner>
      )}
      {overview.suspended && (
        <Banner icon={AlertTriangle} tone="red">
          {t.affiliate.suspendedNotice}
        </Banner>
      )}

      {/* Referral link */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="text-sm font-medium text-ringo-text mb-1">{t.affiliate.yourLink}</p>
        <p className="text-xs text-ringo-muted mb-3">{t.affiliate.commissionRateNote(overview.settings.commissionRatePct)}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
            <p className="text-sm text-ringo-text truncate font-mono">{referralLink}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={copyLink}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t.affiliate.copied : t.affiliate.copy}
            </button>
            <button
              onClick={shareLink}
              aria-label="Share"
              className="flex items-center justify-center w-10 h-10 shrink-0 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
            >
              <Share2 size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label={t.affiliate.statReferrals} value={overview.referralCount} icon={Users} accent="indigo" />
        <StatCard label={t.affiliate.statActive} value={overview.activeReferralCount} icon={UserCheck} accent="teal" />
        {currencies.slice(0, 2).map((cur) => (
          <StatCard
            key={cur}
            label={`${t.affiliate.statAvailable} (${cur})`}
            value={formatPrice(overview.totalsByCurrency[cur].available, cur, locale)}
            icon={Wallet}
            accent="coral"
          />
        ))}
        {currencies.length === 0 && (
          <StatCard label={t.affiliate.statAvailable} value={formatPrice(0, "USD", locale)} icon={Wallet} accent="coral" />
        )}
      </div>

      {/* Balances + payout requests, per currency */}
      {currencies.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {currencies.map((cur) => (
            <BalanceCard
              key={cur}
              currency={cur}
              totals={overview.totalsByCurrency[cur]}
              minPayout={cur === "XAF" ? overview.settings.minPayoutXaf : overview.settings.minPayoutUsd}
              holdDays={overview.settings.holdDays}
              hasPayoutMethod={!!overview.payoutMethod}
              disabled={!overview.settings.enabled || overview.suspended}
              onRequested={refresh}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Earnings chart */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-medium text-ringo-text">{t.affiliate.earningsOverTime}</p>
          {currencies.length > 1 && (
            <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1">
              {currencies.map((cur) => (
                <button
                  key={cur}
                  onClick={() => setChartCurrency(cur)}
                  className={`text-xs font-medium px-3 py-1 rounded-full transition ${
                    activeCurrency === cur ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          )}
        </div>
        {chartData.length === 0 ? (
          <EmptyState text={t.affiliate.noEarningsYet} />
        ) : (
          <AffiliateEarningsChart data={chartData} currency={activeCurrency} />
        )}
      </div>

      {/* Referrals table */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <p className="text-sm font-medium text-ringo-text p-5 pb-0">{t.affiliate.yourReferrals}</p>
        {overview.referrals.length === 0 ? (
          <div className="p-5">
            <EmptyState text={t.affiliate.noReferralsYet} />
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">{t.affiliate.colReferral}</th>
                  <th className="font-normal">{t.affiliate.colPlan}</th>
                  <th className="font-normal px-5">{t.affiliate.colJoined}</th>
                </tr>
              </thead>
              <tbody>
                {overview.referrals.map((r) => (
                  <tr key={r.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        {r.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-8 h-8 rounded-full bg-ringo-indigo/10 text-ringo-indigo text-xs font-medium flex items-center justify-center shrink-0">
                            {(r.username || r.email)[0]?.toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-ringo-text font-medium truncate max-w-[160px]">
                            {r.username ? `@${r.username}` : r.email}
                          </p>
                          {r.username && <p className="text-xs text-ringo-muted truncate max-w-[160px]">{r.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="text-ringo-text capitalize">{r.planName}</td>
                    <td className="text-ringo-muted px-5">{new Date(r.createdAt).toLocaleDateString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Commission history */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-5 pb-0">
          <p className="text-sm font-medium text-ringo-text">{t.affiliate.commissionHistory}</p>
          <p className="text-xs text-ringo-muted mt-1 flex items-center gap-1.5">
            <Clock size={12} className="shrink-0" />
            {t.affiliate.holdNotice(overview.settings.holdDays)}
          </p>
        </div>
        {overview.commissions.length === 0 ? (
          <div className="p-5">
            <EmptyState text={t.affiliate.noCommissionsYet} />
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">{t.affiliate.colFrom}</th>
                  <th className="font-normal">{t.affiliate.colAmount}</th>
                  <th className="font-normal">{t.affiliate.colStatus}</th>
                  <th className="font-normal px-5">{t.affiliate.colDate}</th>
                </tr>
              </thead>
              <tbody>
                {overview.commissions.slice(0, 50).map((c) => {
                  const isHeld = c.status === "pending" && new Date(c.availableAt).getTime() > Date.now();
                  const displayStatus = isHeld ? "pending" : c.status === "pending" ? "available" : c.status;
                  return (
                    <tr key={c.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                      <td className="py-3 px-5 text-ringo-text">{c.referredEmail}</td>
                      <td className="text-ringo-text tabular-nums">{formatPrice(c.amount, c.currency, locale)}</td>
                      <td>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[displayStatus]}`}>
                          {statusLabel(displayStatus)}
                        </span>
                      </td>
                      <td className="text-ringo-muted px-5">{new Date(c.createdAt).toLocaleDateString(locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payout method + history */}
      <div className="grid lg:grid-cols-2 gap-4">
        <PayoutMethodForm overview={overview} onSaved={refresh} t={t} />

        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
          <p className="text-sm font-medium text-ringo-text p-5 pb-3">{t.affiliate.payoutHistory}</p>
          {overview.payouts.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState text={t.affiliate.noPayoutsYet} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[360px]">
                <thead>
                  <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                    <th className="py-2 px-5 font-normal">{t.affiliate.colAmount}</th>
                    <th className="font-normal">{t.affiliate.colStatus}</th>
                    <th className="font-normal px-5">{t.affiliate.colDate}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.payouts.map((p) => (
                    <tr key={p.id} className="border-b border-ringo-border/40 last:border-0">
                      <td className="py-2.5 px-5 text-ringo-text tabular-nums">{formatPrice(p.amount, p.currency, locale)}</td>
                      <td>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[p.status]}`}>
                          {statusLabel(p.status)}
                        </span>
                      </td>
                      <td className="text-ringo-muted px-5">{new Date(p.requestedAt).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Banner({ icon: Icon, tone, children }: { icon: any; tone: "amber" | "red"; children: React.ReactNode }) {
  const styles =
    tone === "amber"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
      : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
  return (
    <div className={`flex items-start gap-2.5 rounded-card border p-4 text-sm ${styles}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <p>{children}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10">
      <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
        <Wallet size={16} className="text-ringo-muted" />
      </span>
      <p className="text-sm text-ringo-muted max-w-xs">{text}</p>
    </div>
  );
}

function BalanceCard({
  currency,
  totals,
  minPayout,
  holdDays,
  hasPayoutMethod,
  disabled,
  onRequested,
  locale,
  t,
}: {
  currency: string;
  totals: { pending: number; available: number; requested: number; paid: number };
  minPayout: number;
  holdDays: number;
  hasPayoutMethod: boolean;
  disabled: boolean;
  onRequested: () => Promise<void>;
  locale: string;
  t: any;
}) {
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const canRequest = hasPayoutMethod && !disabled && totals.available >= minPayout && totals.available > 0;

  const request = async () => {
    setRequesting(true);
    setMessage(null);
    const res = await fetch("/api/affiliate/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency }),
    });
    const data = await res.json().catch(() => ({}));
    setRequesting(false);
    if (!res.ok) {
      setMessage({ type: "error", text: data.error || "Could not request a payout." });
      return;
    }
    setMessage({ type: "success", text: t.affiliate.requestSuccess });
    await onRequested();
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ringo-text">{currency}</p>
        <Banknote size={15} className="text-ringo-muted" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-display font-medium text-ringo-teal tabular-nums">{formatPrice(totals.available, currency, locale)}</p>
          <p className="text-[11px] text-ringo-muted mt-0.5">{t.affiliate.statAvailable}</p>
        </div>
        <div>
          <p className="text-lg font-display font-medium text-ringo-text tabular-nums">{formatPrice(totals.pending, currency, locale)}</p>
          <p className="text-[11px] text-ringo-muted mt-0.5">{t.affiliate.statPending}</p>
        </div>
        <div>
          <p className="text-lg font-display font-medium text-ringo-text tabular-nums">{formatPrice(totals.paid, currency, locale)}</p>
          <p className="text-[11px] text-ringo-muted mt-0.5">{t.affiliate.statPaid}</p>
        </div>
      </div>

      <p className="text-xs text-ringo-muted">{t.affiliate.minPayoutNote(formatPrice(minPayout, currency, locale))}</p>

      {message && (
        <p className={`text-xs ${message.type === "success" ? "text-ringo-teal" : "text-red-500"}`}>{message.text}</p>
      )}

      {!hasPayoutMethod ? (
        <p className="text-xs text-ringo-muted">{t.affiliate.addPayoutMethodFirst}</p>
      ) : (
        <button
          onClick={request}
          disabled={!canRequest || requesting}
          className="w-full text-sm font-medium py-2.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ringo-indigo/90 transition-colors"
        >
          {requesting ? t.affiliate.requestingPayout : t.affiliate.requestPayoutFor(currency)}
        </button>
      )}
    </div>
  );
}

function PayoutMethodForm({
  overview,
  onSaved,
  t,
}: {
  overview: AffiliateOverview;
  onSaved: () => Promise<void>;
  t: any;
}) {
  const [method, setMethod] = useState<"mobile_money" | "paypal" | "bank">(
    (overview.payoutMethod as any) || "mobile_money"
  );
  const [provider, setProvider] = useState(overview.payoutDetails?.provider || "mtn");
  const [phone, setPhone] = useState(overview.payoutDetails?.phone || "");
  const [paypalEmail, setPaypalEmail] = useState(overview.payoutDetails?.email || "");
  const [accountName, setAccountName] = useState(overview.payoutDetails?.accountName || "");
  const [accountNumber, setAccountNumber] = useState(overview.payoutDetails?.accountNumber || "");
  const [bankName, setBankName] = useState(overview.payoutDetails?.bankName || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    const details =
      method === "mobile_money"
        ? { provider, phone: phone.trim() }
        : method === "paypal"
        ? { email: paypalEmail.trim() }
        : { accountName: accountName.trim(), accountNumber: accountNumber.trim(), bankName: bankName.trim() };

    const res = await fetch("/api/affiliate/payout-method", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, details }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Could not save.");
      return;
    }
    setSaved(true);
    await onSaved();
    setTimeout(() => setSaved(false), 2000);
  };

  const inputClass =
    "border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text outline-none focus:ring-2 focus:ring-ringo-indigo/40 focus:border-ringo-indigo transition";

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-ringo-text">{t.affiliate.payoutMethod}</p>
        <p className="text-xs text-ringo-muted mt-0.5">{t.affiliate.payoutMethodHint}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(["mobile_money", "paypal", "bank"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`text-xs font-medium py-2 rounded-card border transition ${
              method === m ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border text-ringo-muted"
            }`}
          >
            {m === "mobile_money" ? t.affiliate.methodMobileMoney : m === "paypal" ? t.affiliate.methodPaypal : t.affiliate.methodBank}
          </button>
        ))}
      </div>

      {method === "mobile_money" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="text-xs text-ringo-muted">{t.affiliate.mobileMoneyProvider}</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
              <option value="mtn">{t.affiliate.mtnMomo}</option>
              <option value="orange">{t.affiliate.orangeMoney}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="text-xs text-ringo-muted">{t.affiliate.phoneNumber}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="677 123 456" />
          </label>
        </div>
      )}

      {method === "paypal" && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ringo-muted">{t.affiliate.paypalEmail}</span>
          <input
            type="email"
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>
      )}

      {method === "bank" && (
        <div className="grid gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">{t.affiliate.bankAccountName}</span>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.affiliate.bankAccountNumber}</span>
              <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.affiliate.bankName}</span>
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
            </label>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1.5">
          <AlertTriangle size={12} />
          {error}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="self-start flex items-center gap-1.5 px-4 py-2.5 rounded-card border border-ringo-border text-ringo-text text-sm font-medium hover:border-ringo-indigo hover:text-ringo-indigo disabled:opacity-50 transition-colors"
      >
        {saved && <Check size={14} className="text-ringo-teal" />}
        {saving ? "…" : saved ? t.affiliate.methodSaved : t.affiliate.saveMethod}
      </button>
    </div>
  );
}
