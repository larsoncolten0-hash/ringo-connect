"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import StatCard from "@/components/analytics/StatCard";
import EmptyState from "@/components/editor/EmptyState";
import type { MyMusicEarningsOverview } from "@/lib/musicEarnings";

const PAYOUT_STATUS_COLOR: Record<string, string> = {
  requested: "bg-amber-500/10 text-amber-600",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  paid: "bg-ringo-teal/10 text-ringo-teal",
  rejected: "bg-red-500/10 text-red-500",
};

// Mirrors AffiliateView.tsx's balance/payout-request card closely — same
// underlying shape (available/pending/requested/paid, a Request Payout
// button gated on a minimum + an on-file payout method). Scoped to XAF
// only: that's the only currency the whole Fapshi collection flow this
// feeds from ever produces (see musicEarnings.ts / the migration).
export default function MusicEarningsView({ overview: initial }: { overview: MyMusicEarningsOverview }) {
  const { t, locale } = useLanguage();
  const [overview, setOverview] = useState(initial);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const totals = overview.totalsByCurrency["XAF"] ?? { pending: 0, available: 0, requested: 0, paid: 0 };
  const hasPayoutMethod = !!overview.payoutMethod;
  const canRequest = hasPayoutMethod && totals.available >= overview.settings.minPayoutXaf && totals.available > 0;

  const requestPayout = async () => {
    setRequesting(true);
    setMessage(null);
    const res = await fetch("/api/music/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "XAF" }),
    });
    const data = await res.json().catch(() => ({}));
    setRequesting(false);
    if (!res.ok) {
      setMessage({ type: "error", text: data.error || "Could not request a payout." });
      return;
    }
    setMessage({ type: "success", text: t.music.earningsRequestSuccess });
    window.location.reload();
  };

  const pct = `${overview.settings.commissionRatePct % 1 === 0 ? overview.settings.commissionRatePct : overview.settings.commissionRatePct.toFixed(1)}%`;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{t.music.earningsTitle}</h1>
        <p className="text-sm text-ringo-muted max-w-lg">{t.music.earningsSubtitle(pct, overview.settings.holdDays)}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t.music.earningsStatAvailable} value={formatPrice(totals.available, "XAF", locale)} icon={Banknote} accent="teal" />
        <StatCard label={t.music.earningsStatPending} value={formatPrice(totals.pending, "XAF", locale)} icon={Banknote} accent="indigo" />
        <StatCard label={t.music.earningsStatRequested} value={formatPrice(totals.requested, "XAF", locale)} icon={Banknote} accent="slate" />
        <StatCard label={t.music.earningsStatPaid} value={formatPrice(totals.paid, "XAF", locale)} icon={Banknote} accent="teal" />
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <p className="text-xs text-ringo-muted">{t.music.earningsMinPayoutNote(formatPrice(overview.settings.minPayoutXaf, "XAF", locale))}</p>

        {message && <p className={`text-xs ${message.type === "success" ? "text-ringo-teal" : "text-red-500"}`}>{message.text}</p>}

        {!hasPayoutMethod ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-ringo-muted">{t.music.earningsAddPayoutMethodFirst}</p>
            <Link href="/dashboard/affiliate" className="text-xs font-medium text-ringo-indigo whitespace-nowrap">
              {t.music.earningsGoToAffiliate}
            </Link>
          </div>
        ) : (
          <button
            onClick={requestPayout}
            disabled={!canRequest || requesting}
            className="self-start flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            {requesting && <Loader2 size={14} className="animate-spin" />}
            {requesting ? t.music.earningsRequesting : t.music.earningsRequestButton("XAF")}
          </button>
        )}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="px-4 py-3 border-b border-ringo-border/70">
          <p className="text-sm font-semibold text-ringo-text">{t.music.earningsPayoutHistory}</p>
        </div>
        {overview.payouts.length === 0 ? (
          <div className="py-8">
            <EmptyState icon={Banknote} title={t.music.earningsNoneYet} />
          </div>
        ) : (
          <div className="divide-y divide-ringo-border/40">
            {overview.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ringo-text" suppressHydrationWarning>
                    {formatPrice(p.amount, p.currency, locale)}
                  </p>
                  <p className="text-xs text-ringo-muted">{new Date(p.requestedAt).toLocaleDateString(locale)}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYOUT_STATUS_COLOR[p.status] || ""}`}>
                  {(t.music as any)[`earningsPayoutStatus${p.status[0].toUpperCase()}${p.status.slice(1)}`] || p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
