"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { STATUS_COLOR } from "@/lib/orderStatus";

// Owner-side view of a music order — same underlying data (music_orders +
// music_order_items snapshots) the fan's own confirmation screen in
// MusicStorePage reads via the public /api/music/orders/[id] route.
export default function MusicReceiptView({ artistName, currency, order }: { artistName: string; currency: string; order: any }) {
  const { t, locale } = useLanguage();

  return (
    <div className="max-w-md">
      <Link href="/dashboard/music/orders" className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4 w-fit">
        <ArrowLeft size={15} />
        {t.restaurant.ordersLabel}
      </Link>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="font-display font-bold text-ringo-text">{artistName}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[order.status] || ""}`}>{order.status}</span>
        </div>
        <p className="text-xs text-ringo-muted mb-4">
          {t.restaurant.orderNumberLabel} #{order.order_number} ·{" "}
          {new Date(order.created_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
        </p>

        <div className="flex flex-col gap-1.5 text-sm border-t border-ringo-border pt-3">
          {(order.music_order_items || []).map((item: any) => (
            <div key={item.id} className="flex justify-between">
              <span className="text-ringo-text">
                {item.quantity} × {item.name_snapshot}
              </span>
              <span className="text-ringo-muted" suppressHydrationWarning>
                {formatPrice(item.line_total, currency, locale)}
              </span>
            </div>
          ))}
          <div className="flex justify-between font-bold text-ringo-text pt-1.5 mt-1 border-t border-ringo-border">
            <span>{t.restaurant.totalLabel}</span>
            <span suppressHydrationWarning>{formatPrice(order.total, currency, locale)}</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-ringo-border text-xs text-ringo-muted flex flex-col gap-0.5">
          <p>
            {order.customer_name} · {order.customer_phone}
          </p>
          <p className="capitalize">
            {t.restaurant.paymentMethodLabel}: {order.payment_method.replace("_", " ")} ({order.payment_status})
          </p>
        </div>
        <p className="text-center text-xs text-ringo-muted mt-4">{t.music.receiptThankYou}</p>
      </div>

      <button
        onClick={() => window.print()}
        className="flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-card border border-ringo-border text-ringo-text mt-3"
      >
        <Printer size={14} /> {t.restaurant.printReceipt}
      </button>
    </div>
  );
}
