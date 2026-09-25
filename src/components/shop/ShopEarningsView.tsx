"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote, ChevronLeft, ChevronRight, Loader2, Percent, ShoppingBag, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import StatCard from "@/components/analytics/StatCard";
import EmptyState from "@/components/editor/EmptyState";
import { formatWhen } from "@/components/shop/ShopOrdersView";
import type { SellerEarningsPage } from "@/lib/productCheckout/sellerOrders";
import type { MyShopPayoutOverview } from "@/lib/shopPayouts";

const earningsHref = (page: number) => (page > 1 ? `/dashboard/shop/earnings?page=${page}` : "/dashboard/shop/earnings");

const PAYOUT_STATUS_TONE: Record<string, string> = {
  requested: "bg-amber-500/10 text-amber-600",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  paid: "bg-ringo-teal/10 text-ringo-teal",
  rejected: "bg-red-500/10 text-red-500",
};

// The payout card: balance/request-button/history, mirroring MusicEarningsView.tsx's own card
// closely — same underlying shape (available/pending/requested/paid, a Request Payout button
// gated on a minimum + an on-file payout method). Scoped to XAF only, the only currency the
// whole Fapshi collection flow this feeds from ever produces.
function PayoutCard({ overview: initial }: { overview: MyShopPayoutOverview }) {
  const { t, locale } = useLanguage();
  const p = t.shopOrders.earnings.payout;
  const [overview, setOverview] = useState(initial);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const totals = overview.totals;
  const hasPayoutMethod = !!overview.payoutMethod;
  const canRequest = hasPayoutMethod && totals.available >= overview.settings.minPayoutXaf && totals.available > 0;

  const requestPayout = async () => {
    setRequesting(true);
    setMessage(null);
    const res = await fetch("/api/shop/payouts", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setRequesting(false);
    if (!res.ok) {
      setMessage({ type: "error", text: data.code === "demo_payout_disabled" ? t.demo.payoutDisabledBody : data.error || "Could not request a payout." });
      return;
    }
    setMessage({ type: "success", text: p.requestSuccess });
    window.location.reload();
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={p.statAvailable} value={formatPrice(totals.available, "XAF", locale)} icon={Banknote} accent="teal" />
        <StatCard label={p.statPending} value={formatPrice(totals.pending, "XAF", locale)} icon={Banknote} accent="indigo" />
        <StatCard label={p.statRequested} value={formatPrice(totals.requested, "XAF", locale)} icon={Banknote} accent="slate" />
        <StatCard label={p.statPaid} value={formatPrice(totals.paid, "XAF", locale)} icon={Banknote} accent="teal" />
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <p className="text-xs text-ringo-muted">{p.minPayoutNote(formatPrice(overview.settings.minPayoutXaf, "XAF", locale))}</p>

        {message && <p className={`text-xs ${message.type === "success" ? "text-ringo-teal" : "text-red-500"}`}>{message.text}</p>}

        {!hasPayoutMethod ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-ringo-muted">{p.addPayoutMethodFirst}</p>
            <Link href="/dashboard/affiliate" className="text-xs font-medium text-ringo-indigo whitespace-nowrap">
              {p.goToPayoutSettings}
            </Link>
          </div>
        ) : (
          <button
            onClick={requestPayout}
            disabled={!canRequest || requesting}
            className="self-start flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            {requesting && <Loader2 size={14} className="animate-spin" />}
            {requesting ? p.requesting : p.requestButton}
          </button>
        )}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="px-4 py-3 border-b border-ringo-border/70">
          <p className="text-sm font-semibold text-ringo-text">{p.payoutHistory}</p>
        </div>
        {overview.payouts.length === 0 ? (
          <div className="py-8">
            <EmptyState icon={Banknote} title={p.noneYet} />
          </div>
        ) : (
          <div className="divide-y divide-ringo-border/40">
            {overview.payouts.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ringo-text" suppressHydrationWarning>
                    {formatPrice(row.amount, row.currency, locale)}
                  </p>
                  <p className="text-xs text-ringo-muted">{new Date(row.requestedAt).toLocaleDateString(locale)}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYOUT_STATUS_TONE[row.status] || ""}`}>
                  {(p as any)[`status${row.status[0].toUpperCase()}${row.status.slice(1)}`] || row.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Earnings from the immutable commerce_sale_earnings records: gross, Ringo commission and seller
// earnings are exactly what was stored when each order was paid. The records list itself never
// changes; payoutOverview (above it) is the only part of this page that reflects withdrawable
// balance/history.
export default function ShopEarningsView({ data, payoutOverview }: { data: SellerEarningsPage; payoutOverview: MyShopPayoutOverview | null }) {
  const { t, locale } = useLanguage();
  const s = t.shopOrders;
  const e = s.earnings;
  const cur = data.totals.currency;
  const money = (n: number, c = cur) => formatPrice(n, c, locale);

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{e.title}</h1>
        <p className="text-sm text-ringo-muted max-w-lg">{e.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label={e.gross} value={money(data.totals.gross)} icon={ShoppingBag} accent="slate" />
        <StatCard label={e.commission} value={money(data.totals.commission)} icon={Percent} accent="indigo" />
        <StatCard label={e.net} value={money(data.totals.net)} icon={Banknote} accent="teal" />
      </div>

      <p className="text-xs text-ringo-muted">
        {e.paidOrders(data.totals.count)} · {e.recordsOnly}
        {data.totals.reversedCount > 0 && <> {e.reversedCount(data.totals.reversedCount)}</>}
      </p>

      {payoutOverview && <PayoutCard overview={payoutOverview} />}

      <h2 className="text-sm font-semibold text-ringo-text -mb-2">{e.recordsTitle}</h2>
      {data.items.length === 0 ? (
        <EmptyState icon={Wallet} title={e.emptyTitle} hint={e.emptyHint} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((r) => (
            <li key={r.id}>
              <Link
                href={`/dashboard/shop/${r.orderId}`}
                className={`block rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-ringo-indigo/40 ${r.reversed ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ringo-text tabular-nums">
                      {s.orderLabel} {r.reference}
                    </p>
                    <p className="text-xs text-ringo-muted">
                      <time dateTime={r.createdAt} suppressHydrationWarning>
                        {formatWhen(r.createdAt, locale)}
                      </time>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-ringo-text tabular-nums">{money(r.net, r.currency)}</p>
                    {r.reversed && <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-500">{e.reversed}</span>}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-ringo-muted">{s.gross}</dt>
                    <dd className="font-medium text-ringo-text tabular-nums">{money(r.gross, r.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-ringo-muted">{e.rate(r.commissionRatePct)}</dt>
                    <dd className="font-medium text-ringo-text tabular-nums">− {money(r.commission, r.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-ringo-muted">{s.net}</dt>
                    <dd className="font-medium text-ringo-text tabular-nums">{money(r.net, r.currency)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.total > 0 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="pagination">
          {data.page > 1 ? (
            <Link href={earningsHref(data.page - 1)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-ringo-border/70 px-4 py-1.5 font-medium text-ringo-text">
              <ChevronLeft size={14} />
              {s.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ringo-muted tabular-nums">{s.pageOf(data.page, data.pageCount)}</span>
          {data.page < data.pageCount ? (
            <Link href={earningsHref(data.page + 1)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-ringo-border/70 px-4 py-1.5 font-medium text-ringo-text">
              {s.next}
              <ChevronRight size={14} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
