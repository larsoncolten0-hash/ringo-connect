"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import { useOrderPushSubscription } from "@/lib/push/useOrderPushSubscription";

type TrackedOrder = {
  id: string;
  order_number: number;
  status: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  table_label: string | null;
  restaurant_name: string | null;
  restaurant_username: string | null;
  currency: string;
  items: { name: string; quantity: number; line_total: number }[];
};

// The standalone page a guest restaurant customer's push notification
// deep-links to (see src/app/order/[id]/page.tsx) — the same live-status
// view RestaurantOrderPage.tsx shows right after checkout, just reachable
// as its own URL so a "your order is ready" push actually has somewhere
// to open to. Deliberately reads every line item from the server
// (GET /api/orders/[id]) rather than any client-side cart state — unlike
// RestaurantOrderPage, this component may be the very first thing that
// loads in this tab (arriving fresh from a notification), so there is no
// local cart to fall back on, and using the server's own order_items is
// the more correct source of truth either way (it reflects what was
// actually recorded, not what the client happened to still have in
// memory).
export default function GuestOrderTrackingView({ orderId }: { orderId: string }) {
  const { t, locale } = useLanguage();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { status: pushStatus, enable: enableOrderPush } = useOrderPushSubscription(orderId);

  // Same 4s poll as RestaurantOrderPage's confirmation step — no Realtime
  // dependency, works regardless of whether it's enabled on this project.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (res.ok) setOrder(await res.json());
      } catch {
        // transient network error — next tick tries again
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId]);

  const statusMessage = (status: string) =>
    ({
      pending: t.restaurant.statusPending,
      accepted: t.restaurant.statusAccepted,
      preparing: t.restaurant.statusPreparing,
      ready: t.restaurant.statusReady,
      served: t.restaurant.statusServed,
      completed: t.restaurant.statusCompleted,
      cancelled: t.restaurant.statusCancelled,
      refunded: t.restaurant.statusRefunded,
    }[status] || status);

  // Deleted/invalid/stale resource — a clean explanatory state instead of
  // an infinite spinner (see PART 20 of the notifications plan).
  if (notFound) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 text-center" style={{ color: "#14202B" }}>
        <p className="font-display text-lg font-bold">{t.restaurant.orderNotFoundTitle}</p>
        <p className="text-sm mt-1" style={{ opacity: 0.6 }}>
          {t.restaurant.orderNotFoundBody}
        </p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ color: "#14202B" }}>
        <Loader2 size={22} className="animate-spin" style={{ opacity: 0.4 }} />
      </div>
    );
  }

  const accent = "#1F9D55";

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
      <RegisterServiceWorker />
      <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
        <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
          <Check size={28} style={{ color: accent }} />
        </span>
        <h1 className="font-display text-xl font-bold">{order.restaurant_name}</h1>
        <p className="text-sm" style={{ opacity: 0.75 }}>
          {statusMessage(order.status)}
        </p>

        {pushStatus === "denied" ? (
          <p className="text-xs max-w-[280px]" style={{ opacity: 0.6 }}>
            {t.pushNotifications.permissionDenied}
          </p>
        ) : (
          pushStatus !== "unsupported" && (
            <button
              onClick={enableOrderPush}
              disabled={pushStatus === "loading" || pushStatus === "on"}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-70"
              style={
                pushStatus === "on"
                  ? { backgroundColor: `${accent}1a`, color: accent }
                  : { border: "1.5px solid #E5E7EB", color: "#14202B" }
              }
            >
              {pushStatus === "loading" ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
              {pushStatus === "on" ? t.pushNotifications.orderEnabled : t.pushNotifications.orderEnable}
            </button>
          )
        )}

        <div className="w-full rounded-2xl border p-4 text-left mt-2" style={{ borderColor: "#E5E7EB" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="font-semibold">{order.restaurant_name}</p>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${accent}1a`, color: accent }}>
              {statusMessage(order.status).split(" ")[0]}
            </span>
          </div>
          <p className="text-xs mb-3" style={{ opacity: 0.6 }}>
            {t.restaurant.orderNumberLabel} #{order.order_number}
            {order.table_label && ` · ${t.restaurant.tableLabel} ${order.table_label}`}
          </p>
          <div className="flex flex-col gap-1.5 text-sm border-t pt-3" style={{ borderColor: "#E5E7EB" }}>
            {order.items.map((l, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {l.quantity} × {l.name}
                </span>
                <span suppressHydrationWarning>{formatPrice(l.line_total, order.currency, locale)}</span>
              </div>
            ))}
            {order.delivery_fee > 0 && (
              <div className="flex justify-between" style={{ opacity: 0.7 }}>
                <span>{t.restaurant.deliveryFeeLine}</span>
                <span suppressHydrationWarning>{formatPrice(order.delivery_fee, order.currency, locale)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1.5 mt-1 border-t" style={{ borderColor: "#E5E7EB" }}>
              <span>{t.restaurant.totalLabel}</span>
              <span suppressHydrationWarning>{formatPrice(order.total, order.currency, locale)}</span>
            </div>
          </div>
        </div>

        {order.restaurant_username && (
          <Link href={`/${order.restaurant_username}`} className="text-sm font-medium mt-1" style={{ color: accent }}>
            {t.restaurant.backToMenu}
          </Link>
        )}
      </div>
    </div>
  );
}
