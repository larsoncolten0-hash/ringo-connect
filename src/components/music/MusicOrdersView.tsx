"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { STATUS_COLOR } from "@/lib/orderStatus";

const FILTERS = ["all", "pending", "completed", "cancelled", "refunded"] as const;

// Mirrors RestaurantOrdersView's polling pattern exactly (see that file's
// own note on why polling rather than Realtime). The status lifecycle is
// simpler here — digital goods/tickets/support have no kitchen prep steps,
// just pending → completed, plus a separate payment_status flag.
//
// Marking an order Paid here is the one and only place payment_status can
// ever become 'paid' anywhere in this app — and that flag is exactly what
// /api/music/tracks/[id]/audio checks before ever handing out a signed URL
// to a track's full protected file. Skipping this action isn't a cosmetic
// gap: it's the only way a fan's purchase actually unlocks.
export default function MusicOrdersView({
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const knownIds = useRef(new Set(initialOrders.map((o) => o.id)));
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    const poll = async () => {
      const { data } = await supabase
        .from("music_orders")
        .select("*, music_order_items(*)")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!data) return;
      if (data.some((o) => !knownIds.current.has(o.id))) setHasNew(true);
      knownIds.current = new Set(data.map((o) => o.id));
      setOrders(data);
    };
    const interval = setInterval(poll, 6000);
    return () => clearInterval(interval);
  }, [profileId]);

  const markPaid = async (order: any) => {
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, payment_status: "paid" } : o)));
    await supabase.from("music_orders").update({ payment_status: "paid" }).eq("id", order.id);
  };

  const markCompleted = async (order: any) => {
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "completed" } : o)));
    await supabase.from("music_orders").update({ status: "completed" }).eq("id", order.id);
  };

  const cancelOrder = async (order: any) => {
    if (!window.confirm(t.restaurant.cancelOrder + "?")) return;
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "cancelled" } : o)));
    await supabase.from("music_orders").update({ status: "cancelled" }).eq("id", order.id);
  };

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

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border capitalize transition ${
              filter === f ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border text-ringo-muted"
            }`}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>}

      <div className="flex flex-col gap-2">
        {filtered.map((order) => {
          const expanded = expandedId === order.id;
          return (
            <div key={order.id} className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : order.id)}
                className="w-full flex items-center gap-3 p-3.5 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ringo-text">#{order.order_number}</p>
                  <p className="text-xs text-ringo-muted">{order.customer_name}</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full capitalize shrink-0 ${
                    order.payment_status === "paid" ? "bg-ringo-teal/10 text-ringo-teal" : "bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {order.payment_status}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize shrink-0 ${STATUS_COLOR[order.status] || ""}`}>
                  {order.status}
                </span>
                <span className="text-sm font-semibold text-ringo-text shrink-0" suppressHydrationWarning>
                  {formatPrice(order.total, currency, locale)}
                </span>
                <ChevronDown size={15} className={`shrink-0 text-ringo-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>

              {expanded && (
                <div className="px-3.5 pb-3.5 flex flex-col gap-2 border-t border-ringo-border/70 pt-3">
                  {(order.music_order_items || []).map((item: any) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-ringo-text">
                        {item.quantity} × {item.name_snapshot}
                      </span>
                      <span className="text-ringo-muted" suppressHydrationWarning>
                        {formatPrice(item.line_total, currency, locale)}
                      </span>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {order.payment_status !== "paid" && (
                      <button
                        onClick={() => markPaid(order)}
                        className="text-xs font-medium px-3.5 py-2 rounded-card bg-ringo-teal text-white"
                      >
                        {t.music.markPaidLabel}
                      </button>
                    )}
                    {order.status !== "completed" && (
                      <button
                        onClick={() => markCompleted(order)}
                        className="text-xs font-medium px-3.5 py-2 rounded-card bg-ringo-indigo text-white"
                      >
                        {t.restaurant.markCompleted}
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
                      href={`/dashboard/music/orders/${order.id}`}
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
