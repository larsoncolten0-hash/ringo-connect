"use client";

import { Package } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import type { ShopReceiptData } from "@/lib/productCheckout/receipt";

// The customer-facing receipt for a Shop order (Increment 5B) — deliberately a simple,
// phone-first "here's what you bought" card, same audience and posture as the music/restaurant
// receipt pages (see src/app/shop/orders/[id]/page.tsx for the access-control reasoning).
const STATUS_TONE: Record<string, string> = {
  awaiting_payment: "#B45309",
  paid: "#059669",
  fulfilled: "#059669",
  cancelled: "#DC2626",
  expired: "#6B7280",
  refunded: "#6B7280",
  payment_review: "#B45309",
};

export default function ShopOrderReceiptView({ data }: { data: ShopReceiptData }) {
  const { t, locale } = useLanguage();
  const r = t.shopReceipt;

  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" });

  const statusLabel = r.status[data.status] ?? data.status;
  const statusColor = STATUS_TONE[data.status] || "#6B7280";
  const paymentStatusLabel = data.payment ? r.paymentStatus[data.payment.status] ?? data.payment.status : null;
  const paymentMethodLabel = data.payment?.method ? r.paymentMethod[data.payment.method] ?? data.payment.method : null;

  return (
    <div className="min-h-screen bg-white pb-16 flex flex-col items-center" style={{ color: "#14202B" }}>
      <div className="w-full max-w-sm px-4 py-6 flex flex-col gap-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider" style={{ opacity: 0.5 }}>
          Ringo Connect
        </p>

        <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid #E5E7EB" }}>
          <div className="px-5 pt-6 pb-4 text-center" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <p className="text-sm font-semibold" style={{ opacity: 0.6 }}>
              {r.orderLabel(data.orderNumber)}
            </p>
            <h1 className="mt-1 text-xl font-bold">{r.title}</h1>
            <p className="mt-1 text-sm" style={{ opacity: 0.6 }}>
              {r.from(data.sellerName)}
            </p>
            <span
              className="mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: `${statusColor}1A`, color: statusColor }}
            >
              {statusLabel}
            </span>
          </div>

          <div className="px-5 py-4" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
              {r.itemsTitle}
            </p>
            <ul className="flex flex-col gap-3">
              {data.items.map((item, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      style={{ border: "1px solid #E5E7EB" }}
                    />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#F3F4F6" }}>
                      <Package size={18} style={{ opacity: 0.4 }} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs" style={{ opacity: 0.6 }}>
                      {r.quantityTimesPrice(item.quantity, formatPrice(item.unitPrice, data.currency, locale))}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">{formatPrice(item.lineTotal, data.currency, locale)}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="px-5 py-4" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <div className="flex items-center justify-between text-sm" style={{ opacity: 0.7 }}>
              <span>{r.subtotal}</span>
              <span>{formatPrice(data.subtotal, data.currency, locale)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-base font-bold">
              <span>{r.total}</span>
              <span>{formatPrice(data.total, data.currency, locale)}</span>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
              {r.paymentTitle}
            </p>
            {data.payment ? (
              <div className="flex flex-col gap-1 text-sm">
                <p>{paymentStatusLabel}</p>
                {paymentMethodLabel && <p style={{ opacity: 0.6 }}>{paymentMethodLabel}</p>}
                {data.payment.confirmedAt && <p style={{ opacity: 0.6 }}>{r.paidOn(fmtDate(data.payment.confirmedAt))}</p>}
              </div>
            ) : (
              <p className="text-sm" style={{ opacity: 0.6 }}>
                {r.noPayment}
              </p>
            )}
            <p className="mt-3 text-xs" style={{ opacity: 0.5 }}>
              {r.placedOn(fmtDate(data.createdAt))}
            </p>
          </div>
        </div>

        <p className="text-center text-xs" style={{ opacity: 0.4 }}>
          {r.receiptLabel(data.receiptNumber)}
        </p>
      </div>
    </div>
  );
}
