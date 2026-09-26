"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import AdminProtectionTabs from "./AdminProtectionTabs";
import AdminProtectionStatusBadge from "./AdminProtectionStatusBadge";
import type { AdminProtectionRefundRow } from "@/lib/protection/adminRefunds";

// Phase 12: monitoring list only — the manual refund action itself lives on each transaction's own
// detail page (AdminProtectionDetail.tsx), reached via the Order link below. Automatic provider
// refunds stay capability-gated (protection_refund_provider_enabled) and dormant; every refund here
// is recorded manually by an admin after sending the transfer themselves via Fapshi's own app.
const FILTERS = ["all", "requested", "processing", "completed", "failed"] as const;

export default function AdminProtectionRefundsView({ refunds }: { refunds: AdminProtectionRefundRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("requested");

  const filtered = useMemo(() => (filter === "all" ? refunds : refunds.filter((r) => r.status === filter)), [refunds, filter]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">Shop</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">Ringo Protection</h1>
        <p className="text-sm text-ringo-muted max-w-lg">
          Refund requests created by dispute resolution. Every refund is sent manually by an admin via Fapshi's own app — open a transaction to record the result once you've sent it.
        </p>
      </div>

      <AdminProtectionTabs />

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex items-center px-5 py-3.5 border-b border-ringo-border/70">
          <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-xs font-medium px-3 py-1 rounded-full capitalize transition ${filter === f ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-14">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <Banknote size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No refund requests here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Order</th>
                  <th className="font-normal">Seller</th>
                  <th className="font-normal">Amount</th>
                  <th className="font-normal">Destination</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Requested</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <Link href={`/admin/protection/${r.transactionId}`} className="text-ringo-indigo font-medium hover:underline">
                        {r.orderReference}
                      </Link>
                    </td>
                    <td className="text-ringo-text">{r.sellerName || "—"}</td>
                    <td className="tabular-nums text-ringo-text">{formatPrice(r.amount, r.currency)}</td>
                    <td className="text-ringo-muted">{r.destinationPhone ? `${r.destinationPhone} (${r.destinationNetwork})` : "Not yet supplied"}</td>
                    <td>
                      <AdminProtectionStatusBadge status={r.status} />
                      {r.failureReason && <p className="mt-1 text-[10px] text-red-500 truncate max-w-[160px]">{r.failureReason}</p>}
                    </td>
                    <td className="text-ringo-muted">{new Date(r.requestedAt).toLocaleDateString("en-US")}</td>
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
