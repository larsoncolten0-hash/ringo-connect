"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, Phone, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import EmptyState from "@/components/editor/EmptyState";
import { FulfillmentChip, PaymentChip } from "@/components/shop/ShopStatus";
import { ORDER_GROUPS, type OrderGroup, type SellerOrderPage } from "@/lib/productCheckout/sellerOrders";

export const shopHref = (group: OrderGroup, page: number) => {
  const q = new URLSearchParams();
  if (group !== "sales") q.set("group", group);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/dashboard/shop?${s}` : "/dashboard/shop";
};

export function formatWhen(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// Seller's product orders: three filters (Sales / To fulfill / Unpaid), one card per order, paginated.
// Everything shown comes from the read model (sellerOrders.ts); nothing is calculated here.
export default function ShopOrdersView({ data }: { data: SellerOrderPage }) {
  const { t, locale } = useLanguage();
  const s = t.shopOrders;
  const groupLabel: Record<OrderGroup, string> = { sales: s.groupSales, to_fulfill: s.groupToFulfill, unpaid: s.groupUnpaid };
  const empty: Record<OrderGroup, { title: string; hint: string }> = {
    sales: { title: s.emptySalesTitle, hint: s.emptySalesHint },
    to_fulfill: { title: s.emptyToFulfillTitle, hint: s.emptyToFulfillHint },
    unpaid: { title: s.emptyUnpaidTitle, hint: s.emptyUnpaidHint },
  };

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{s.title}</h1>
        <p className="text-sm text-ringo-muted max-w-lg">{s.subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {ORDER_GROUPS.map((g) => {
          const active = g === data.group;
          return (
            <Link
              key={g}
              href={shopHref(g, 1)}
              role="tab"
              aria-selected={active}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                active ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border/70 text-ringo-muted hover:text-ringo-text"
              }`}
            >
              {groupLabel[g]}
              {g === "to_fulfill" && data.toFulfillCount > 0 && (
                <span className="rounded-full bg-amber-500 text-white text-[11px] leading-none px-1.5 py-1 tabular-nums">{data.toFulfillCount}</span>
              )}
            </Link>
          );
        })}
      </div>

      {data.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={empty[data.group].title} hint={empty[data.group].hint} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((o) => (
            <li key={o.id}>
              <Link
                href={`/dashboard/shop/${o.id}`}
                className="block rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-ringo-indigo/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ringo-muted tabular-nums">
                      {s.orderLabel} {o.reference}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ringo-text truncate">
                      {o.product}
                      {o.extraItems > 0 && <span className="ml-1 text-ringo-muted font-normal">{s.moreItems(o.extraItems)}</span>}
                    </p>
                    <p className="text-xs text-ringo-muted">{s.quantityShort(o.quantity)}</p>
                  </div>
                  <p className="shrink-0 text-base font-semibold text-ringo-text tabular-nums">{formatPrice(o.gross, o.currency, locale)}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PaymentChip state={o.payment} />
                  <FulfillmentChip state={o.fulfillment} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ringo-muted">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <User size={12} className="shrink-0" />
                    <span className="truncate">{o.customerName}</span>
                    <Phone size={12} className="shrink-0 ml-1" />
                    <span className="tabular-nums">{o.customerPhone}</span>
                  </span>
                  <time dateTime={o.createdAt} suppressHydrationWarning>
                    {formatWhen(o.createdAt, locale)}
                  </time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.total > 0 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="pagination">
          {data.page > 1 ? (
            <Link href={shopHref(data.group, data.page - 1)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-ringo-border/70 px-4 py-1.5 font-medium text-ringo-text">
              <ChevronLeft size={14} />
              {s.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ringo-muted tabular-nums">
            {s.pageOf(data.page, data.pageCount)} · {s.totalOrders(data.total)}
          </span>
          {data.page < data.pageCount ? (
            <Link href={shopHref(data.group, data.page + 1)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-ringo-border/70 px-4 py-1.5 font-medium text-ringo-text">
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
