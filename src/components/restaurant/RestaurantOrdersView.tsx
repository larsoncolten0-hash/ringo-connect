"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useSound } from "@/components/SoundProvider";
import { formatPrice } from "@/lib/currency";
import { nextStatus, STATUS_COLOR, type OrderStatus } from "@/lib/orderStatus";

const FILTERS: (OrderStatus | "all")[] = ["all", "pending", "accepted", "preparing", "ready", "served", "completed", "cancelled"];

// Polls rather than subscribing to Supabase Realtime — this project's
// Realtime config isn't something this codebase can verify from the
// repo alone (see the migration's own note on this), so polling is the
// safe default; swapping in a Realtime channel later is a drop-in
// replacement for the interval below, nothing else here would need to change.
export default function RestaurantOrdersView({
  profileId,
  currency,
  initialOrders,
}: {
  profileId: string;
  currency: string;
  initialOrders: any[];
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const knownIds = useRef(new Set(initialOrders.map((o) => o.id)));
  // Status changes still in flight (order id -> the status being applied). The poll below must not overwrite one with the database's pre-change state, or
  // the button flickers back to "Accept" for a moment after it was pressed.
  const pending = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const { play } = useSound();

  useEffect(() => {
    const poll = async () => {
      // nobody is looking at a hidden tab: it does not ask for 100 orders with their items every 6 seconds (it catches up as soon as it is visible again)
      if (document.visibilityState === "hidden") return;
      const { data } = await supabase
        .from("orders")
        .select("*, order_items(*), restaurant_tables(label)")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!data) return;
      // knownIds starts seeded from the orders the page already rendered,
      // so this only ever fires for an order that arrived after the page
      // was open — never on the initial load itself.
      if (data.some((o) => !knownIds.current.has(o.id))) {
        setHasNew(true);
        play("notification");
      }
      knownIds.current = new Set(data.map((o) => o.id));
      setOrders(data.map((o) => (pending.current.has(o.id) ? { ...o, status: pending.current.get(o.id) } : o)));
    };
    const interval = setInterval(poll, 6000);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profileId]);

  // Both routed through an API route (rather than a direct client update)
  // so the customer's status-update email can actually be sent — sendEmail
  // is server-only, the Resend API key must never reach the browser. See
  // that route for the RLS ownership check and the order_status_history
  // insert, both now handled server-side.
  // Applies a status change optimistically, and puts the order back (with a notice) if the server did not accept it. Before, a refused change (a lost
  // connection, a permission change) left the order showing the new status until the next poll quietly flipped it back.
  const applyStatus = async (order: any, status: string) => {
    const previous = order.status;
    pending.current.set(order.id, status);
    setError(null);
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("status_update_failed");
    } catch {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: previous } : o)));
      setError(t.restaurant.orderUpdateFailed);
    } finally {
      pending.current.delete(order.id);
    }
  };

  const advanceStatus = async (order: any) => {
    const next = nextStatus(order.status, order.order_type);
    if (!next) return;
    await applyStatus(order, next);
  };

  const cancelOrder = async (order: any) => {
    if (!window.confirm(t.restaurant.cancelOrder + "?")) return;
    await applyStatus(order, "cancelled");
  };

  const actionLabel = (status: OrderStatus) =>
    ({
      pending: t.restaurant.acceptOrder,
      accepted: t.restaurant.startPreparing,
      preparing: t.restaurant.markReady,
      ready: t.restaurant.markServed,
      served: t.restaurant.markCompleted,
    }[status as "pending" | "accepted" | "preparing" | "ready" | "served"]);

  const filtered = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  const canCancel = (status: string) => !["completed", "cancelled", "refunded"].includes(status);

  return (
    <div className="flex flex-col gap-4">
      {hasNew && (
        <button
          onClick={() => setHasNew(false)}
          className="flex items-center gap-2 text-sm font-medium text-ringo-indigo bg-ringo-indigo/10 rounded-card px-3.5 py-2.5 w-fit"
        >
          <Bell size={14} /> {t.restaurant.newOrderBadge}
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-card border border-ringo-coral/30 bg-ringo-coral/5 px-4 py-3 text-sm text-ringo-coral">
          {error}
        </p>
      )}

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label={t.restaurant.ordersLabel}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`shrink-0 inline-flex min-h-[44px] items-center text-xs font-medium px-4 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 ${
              filter === f ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border text-ringo-muted"
            }`}
          >
            {f === "all" ? t.restaurant.allOrders : t.restaurant.orderStatus[f] ?? f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>}

      <div className="flex flex-col gap-2">
        {filtered.map((order) => {
          const expanded = expandedId === order.id;
          const next = nextStatus(order.status, order.order_type);
          return (
            <div key={order.id} className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : order.id)}
                className="w-full flex items-center gap-3 p-3.5 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ringo-text">
                    #{order.order_number}
                    {order.restaurant_tables?.label && <span className="text-ringo-muted"> · {order.restaurant_tables.label}</span>}
                  </p>
                  <p className="text-xs text-ringo-muted">{order.customer_name}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[order.status] || ""}`}>
                  {t.restaurant.orderStatus[order.status] ?? order.status}
                </span>
                <span className="text-sm font-semibold text-ringo-text shrink-0" suppressHydrationWarning>
                  {formatPrice(order.total, currency, locale)}
                </span>
                <ChevronDown size={15} className={`shrink-0 text-ringo-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>

              {expanded && (
                <div className="px-3.5 pb-3.5 flex flex-col gap-2 border-t border-ringo-border/70 pt-3">
                  {(order.order_items || []).map((item: any) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-ringo-text">
                        {item.quantity} × {item.item_name_snapshot}
                        {item.notes && <span className="text-ringo-muted"> — {item.notes}</span>}
                      </span>
                      <span className="text-ringo-muted" suppressHydrationWarning>
                        {formatPrice(item.line_total, currency, locale)}
                      </span>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    {next && (
                      <button
                        onClick={() => advanceStatus(order)}
                        className="text-xs font-medium px-3.5 py-2 rounded-card bg-ringo-indigo text-white"
                      >
                        {actionLabel(order.status)}
                      </button>
                    )}
                    {canCancel(order.status) && (
                      <button
                        onClick={() => cancelOrder(order)}
                        className="text-xs font-medium px-3.5 py-2 rounded-card border border-ringo-border text-ringo-muted hover:text-red-500"
                      >
                        {t.restaurant.cancelOrder}
                      </button>
                    )}
                    <Link
                      href={`/dashboard/restaurant/orders/${order.id}`}
                      className="text-xs font-medium px-3.5 py-2 rounded-card border border-ringo-border text-ringo-text"
                    >
                      {t.restaurant.viewReceipt}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
