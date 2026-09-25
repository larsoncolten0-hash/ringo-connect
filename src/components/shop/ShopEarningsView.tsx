"use client";

import Link from "next/link";
import { Banknote, ChevronLeft, ChevronRight, Percent, ShoppingBag, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import StatCard from "@/components/analytics/StatCard";
import EmptyState from "@/components/editor/EmptyState";
import { formatWhen } from "@/components/shop/ShopOrdersView";
import type { SellerEarningsPage } from "@/lib/productCheckout/sellerOrders";

const earningsHref = (page: number) => (page > 1 ? `/dashboard/shop/earnings?page=${page}` : "/dashboard/shop/earnings");

// Earnings from the immutable commerce_sale_earnings records: gross, Ringo commission and seller
// earnings are exactly what was stored when each order was paid. Records only - no payout or balance.
export default function ShopEarningsView({ data }: { data: SellerEarningsPage }) {
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
