"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { nextStatus, type OrderStatus } from "@/lib/orderStatus";

// Deliberately shows only what's needed to cook and hand off an order —
// no prices, no customer phone number, no payment info. Same account as
// the rest of the dashboard for now (Ringo has no separate staff-login
// system yet — see the migration's design notes), but the VIEW itself is
// already built to the "kitchen sees only kitchen info" principle so it's
// ready the moment real chef/kitchen accounts exist.
export default function KitchenView({ profileId, initialOrders }: { profileId: string; initialOrders: any[] }) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [orders, setOrders] = useState(initialOrders);

  useEffect(() => {
    const poll = async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, order_type, status, created_at, restaurant_tables(label), order_items(id, item_name_snapshot, quantity, notes)")
        .eq("profile_id", profileId)
        .in("status", ["pending", "accepted", "preparing", "ready"])
        .order("created_at", { ascending: true });
      if (data) setOrders(data);
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [profileId]);

  const advance = async (order: any) => {
    const next = nextStatus(order.status, order.order_type);
    if (!next) return;
    if (next === "served" || next === "completed") {
      // Once it leaves "ready" it's off the kitchen's plate — pull it
      // from view immediately rather than waiting for the next poll.
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } else {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)));
    }
    await supabase.from("orders").update({ status: next }).eq("id", order.id);
    await supabase.from("order_status_history").insert({ order_id: order.id, status: next });
  };

  const actionLabel = (status: OrderStatus) =>
    ({
      pending: t.restaurant.acceptOrder,
      accepted: t.restaurant.startPreparing,
      preparing: t.restaurant.markReady,
      ready: t.restaurant.markServed,
    }[status as "pending" | "accepted" | "preparing" | "ready"]);

  const columns: { status: OrderStatus; label: string }[] = [
    { status: "pending", label: t.restaurant.pendingLabel },
    { status: "accepted", label: t.restaurant.acceptOrder },
    { status: "preparing", label: t.restaurant.preparingLabel },
    { status: "ready", label: t.restaurant.readyLabel },
  ];

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {columns.map((col) => {
        const colOrders = orders.filter((o) => o.status === col.status);
        return (
          <div key={col.status} className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">
              {col.label} ({colOrders.length})
            </p>
            {colOrders.map((order) => (
              <div key={order.id} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-3.5 flex flex-col gap-2">
                <p className="text-sm font-bold text-ringo-text">
                  #{order.order_number}
                  {order.restaurant_tables?.label && <span className="text-ringo-muted font-normal"> · {order.restaurant_tables.label}</span>}
                </p>
                <div className="flex flex-col gap-1">
                  {(order.order_items || []).map((item: any) => (
                    <p key={item.id} className="text-sm text-ringo-text">
                      {item.quantity} × {item.item_name_snapshot}
                      {item.notes && <span className="block text-xs text-ringo-muted">— {item.notes}</span>}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => advance(order)}
                  className="text-xs font-medium py-2 rounded-card bg-ringo-indigo text-white mt-1"
                >
                  {actionLabel(order.status)}
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
