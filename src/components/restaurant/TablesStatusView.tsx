"use client";

import { useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

export default function TablesStatusView({ tables, activeOrders }: { tables: any[]; activeOrders: any[] }) {
  const { t } = useLanguage();
  const [openTableId, setOpenTableId] = useState<string | null>(null);

  const orderForTable = (tableId: string) => activeOrders.find((o) => o.table_id === tableId);

  return (
    <div className="flex flex-col gap-2 max-w-md">
      {tables.length === 0 && (
        <p className="text-sm text-ringo-muted">
          {t.restaurant.noTablesYet}{" "}
          <Link href="/dashboard" className="text-ringo-indigo font-medium">
            {t.restaurant.addTable}
          </Link>
        </p>
      )}

      {tables.map((table) => {
        const order = orderForTable(table.id);
        const occupied = !!order;
        const open = openTableId === table.id;
        return (
          <div key={table.id} className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
            <button
              onClick={() => setOpenTableId(open ? null : table.id)}
              disabled={!occupied}
              className="w-full flex items-center gap-2.5 p-3.5 text-left disabled:cursor-default"
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${occupied ? "bg-red-500" : "bg-ringo-teal"}`} />
              <span className="flex-1 text-sm font-medium text-ringo-text">{table.label}</span>
              {table.enabled === false && (
                <span className="text-[10px] text-ringo-muted border border-ringo-border rounded-full px-2 py-0.5">
                  {t.restaurant.tableDisabled}
                </span>
              )}
              <span className={`text-xs font-medium ${occupied ? "text-red-500" : "text-ringo-teal"}`}>
                {occupied ? t.restaurant.tableOccupied : t.restaurant.tableAvailable}
              </span>
            </button>
            {open && order && (
              <div className="px-3.5 pb-3.5 border-t border-ringo-border pt-2.5 flex flex-col gap-1">
                <p className="text-xs text-ringo-muted">#{order.order_number} · {order.status}</p>
                {(order.order_items || []).map((item: any, i: number) => (
                  <p key={i} className="text-sm text-ringo-text">
                    {item.quantity} × {item.item_name_snapshot}
                  </p>
                ))}
                <Link href={`/dashboard/restaurant/orders/${order.id}`} className="text-xs font-medium text-ringo-indigo mt-1">
                  {t.restaurant.viewReceipt}
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
