"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import AdminProtectionTabs from "./AdminProtectionTabs";
import AdminProtectionStatusBadge from "./AdminProtectionStatusBadge";
import type { AdminProtectionDisputeRow } from "@/lib/protection/adminDisputes";

// Dedicated dispute-review view. Read-only list; every resolution happens on the transaction detail
// page via the EXISTING Phase 7 resolve-dispute route (this view never resolves anything itself —
// "DO NOT CREATE A SECOND RESOLUTION ENGINE").
const FILTERS = ["all", "open", "resolved_release", "resolved_refund"] as const;

export default function AdminProtectionDisputesView({ disputes }: { disputes: AdminProtectionDisputeRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const filtered = useMemo(() => {
    const rows = filter === "all" ? disputes : disputes.filter((d) => d.status === filter);
    return [...rows].sort((a, b) => (sort === "newest" ? +new Date(b.openedAt) - +new Date(a.openedAt) : +new Date(a.openedAt) - +new Date(b.openedAt)));
  }, [disputes, filter, sort]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">Shop</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">Ringo Protection</h1>
        <p className="text-sm text-ringo-muted max-w-lg">Disputes opened by customers on protected orders.</p>
      </div>

      <AdminProtectionTabs />

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ringo-border/70 flex-wrap gap-2">
          <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-xs font-medium px-3 py-1 rounded-full capitalize transition ${filter === f ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"}`}>
                {f.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <button onClick={() => setSort(sort === "newest" ? "oldest" : "newest")} className="text-xs font-medium text-ringo-indigo">
            {sort === "newest" ? "Newest first" : "Oldest first"}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-14">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <ShieldAlert size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No disputes here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Order</th>
                  <th className="font-normal">Seller</th>
                  <th className="font-normal">Protected</th>
                  <th className="font-normal">Reason</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Opened</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <Link href={`/admin/protection/${d.transactionId}`} className="text-ringo-indigo font-medium hover:underline">
                        {d.orderReference}
                      </Link>
                    </td>
                    <td className="text-ringo-text">{d.sellerName || "—"}</td>
                    <td className="tabular-nums text-ringo-text">{d.protectedAmount != null && d.currency ? formatPrice(d.protectedAmount, d.currency) : "—"}</td>
                    <td className="text-ringo-text truncate max-w-[220px]">{d.reason}</td>
                    <td>
                      <AdminProtectionStatusBadge status={d.status} />
                    </td>
                    <td className="text-ringo-muted">{new Date(d.openedAt).toLocaleDateString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
