"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, Banknote, Users, Search } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import AdminProtectionTabs from "./AdminProtectionTabs";
import AdminProtectionStatusBadge from "./AdminProtectionStatusBadge";
import type { ProtectionAdminOverview, ProtectionTransactionStatus } from "@/lib/protection/adminOverview";
import type { AdminProtectionTransactionRow } from "@/lib/protection/adminTransactions";

// Mirrors AdminShopPayoutsView.tsx's own shape/conventions (StatTile grid, status-pill filter,
// table) — the closest existing analog for an admin financial monitoring list. Read-only: every
// action (dispute resolution) happens on the transaction detail page, through the EXISTING Phase 7
// resolve-dispute route — this view never mutates anything itself.

function StatTile({ label, value, icon: Icon, tone = "indigo" }: { label: string; value: string | number; icon: any; tone?: "indigo" | "coral" | "teal" }) {
  const toneClass = tone === "coral" ? "bg-ringo-coral/10 text-ringo-coral" : tone === "teal" ? "bg-ringo-teal/10 text-ringo-teal" : "bg-ringo-indigo/10 text-ringo-indigo";
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${toneClass}`}>
          <Icon size={12} />
        </span>
        <p className="text-xs text-ringo-muted">{label}</p>
      </div>
      <p className="text-xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em]">{value}</p>
    </div>
  );
}

const STATUS_FILTERS: (ProtectionTransactionStatus | "all" | "disputed_only" | "refund_only")[] = [
  "all",
  "protected",
  "fulfillment_started",
  "awaiting_confirmation",
  "disputed_only",
  "released",
  "refund_only",
  "payment_failed",
  "expired",
  "cancelled",
];
const FILTER_LABEL: Record<string, string> = { all: "All", disputed_only: "Disputed", refund_only: "Refunds" };

export default function AdminProtectionView({ overview, transactions }: { overview: ProtectionAdminOverview; transactions: AdminProtectionTransactionRow[] }) {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [sellerQuery, setSellerQuery] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (statusFilter === "disputed_only" && !t.hasDispute) return false;
      if (statusFilter === "refund_only" && !t.hasRefund) return false;
      if (statusFilter !== "all" && statusFilter !== "disputed_only" && statusFilter !== "refund_only" && t.status !== statusFilter) return false;
      if (sellerQuery.trim() && !`${t.sellerUsername || ""} ${t.sellerName || ""}`.toLowerCase().includes(sellerQuery.trim().toLowerCase())) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!t.id.toLowerCase().includes(q) && !t.orderId.toLowerCase().includes(q) && !t.orderReference.toLowerCase().includes(q)) return false;
      }
      if (dateFrom && new Date(t.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(t.createdAt) > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    });
  }, [transactions, statusFilter, sellerQuery, search, dateFrom, dateTo]);

  const currencies = Object.keys(overview.totalsByCurrency);

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">Shop</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">Ringo Protection</h1>
        <p className="text-sm text-ringo-muted max-w-lg">Operational visibility into Protection transactions, disputes and refund requests. Monitoring only — every action still goes through its own dedicated engine/route.</p>
      </div>

      <AdminProtectionTabs />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-xs text-ringo-muted mb-1.5">Protection</p>
          <AdminProtectionStatusBadge status={overview.protectionEnabled ? "released" : "cancelled"} />
          <p className="mt-1 text-[11px] text-ringo-muted">{overview.protectionEnabled ? "Enabled" : "Disabled"}</p>
        </div>
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-xs text-ringo-muted mb-1.5">Refund provider</p>
          <AdminProtectionStatusBadge status={overview.refundProviderEnabled ? "released" : "cancelled"} />
          <p className="mt-1 text-[11px] text-ringo-muted">{overview.refundProviderEnabled ? "Enabled" : "Disabled — requests only"}</p>
        </div>
        <StatTile label="Open disputes" value={overview.disputesOpenCount} icon={ShieldAlert} tone="coral" />
        <StatTile label="Refunds requested" value={overview.refundsRequestedCount} icon={Banknote} tone="coral" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(overview.countsByStatus).map(([status, count]) => (
          <div key={status} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-3">
            <AdminProtectionStatusBadge status={status} />
            <p className="mt-2 text-lg font-display font-medium text-ringo-text tabular-nums">{count}</p>
          </div>
        ))}
      </div>

      {currencies.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-ringo-border/70">
            <p className="text-sm font-semibold text-ringo-text">Amounts by currency</p>
            <p className="text-xs text-ringo-muted mt-0.5">Distinct figures — never blended into one total.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Currency</th>
                  <th className="font-normal">Protected volume (lifetime)</th>
                  <th className="font-normal">Protection fees</th>
                  <th className="font-normal">Pending seller amount</th>
                  <th className="font-normal">Released to sellers</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((cur) => {
                  const t = overview.totalsByCurrency[cur];
                  return (
                    <tr key={cur} className="border-b border-ringo-border/40 last:border-0">
                      <td className="py-3 px-5 font-medium text-ringo-text">{cur}</td>
                      <td className="tabular-nums text-ringo-text">{formatPrice(t.protectedVolume, cur)}</td>
                      <td className="tabular-nums text-ringo-text">{formatPrice(t.feesCollected, cur)}</td>
                      <td className="tabular-nums text-ringo-text">{formatPrice(t.pendingSellerAmount, cur)}</td>
                      <td className="tabular-nums text-ringo-text">{formatPrice(t.releasedToSellers, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-ringo-border/70">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-ringo-text">Transactions</p>
            <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1 flex-wrap">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs font-medium px-3 py-1 rounded-full capitalize transition ${statusFilter === s ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"}`}
                >
                  {FILTER_LABEL[s] || s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-ringo-border/70 px-3 py-1.5">
              <Search size={13} className="text-ringo-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Transaction/order id or reference" className="bg-transparent text-xs outline-none w-56" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-ringo-border/70 px-3 py-1.5">
              <Users size={13} className="text-ringo-muted" />
              <input value={sellerQuery} onChange={(e) => setSellerQuery(e.target.value)} placeholder="Seller username or name" className="bg-transparent text-xs outline-none w-44" />
            </div>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-full border border-ringo-border/70 px-3 py-1.5 text-xs bg-transparent" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-full border border-ringo-border/70 px-3 py-1.5 text-xs bg-transparent" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-14">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <ShieldCheck size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No Protection transactions match these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Order</th>
                  <th className="font-normal">Seller</th>
                  <th className="font-normal">Protected</th>
                  <th className="font-normal">Fee</th>
                  <th className="font-normal">Total</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Created</th>
                  <th className="font-normal px-5">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <Link href={`/admin/protection/${t.id}`} className="text-ringo-indigo font-medium hover:underline">
                        {t.orderReference}
                      </Link>
                    </td>
                    <td className="text-ringo-text">{t.sellerUsername ? `@${t.sellerUsername}` : t.sellerName || "—"}</td>
                    <td className="tabular-nums text-ringo-text">{formatPrice(t.productAmount, t.currency)}</td>
                    <td className="tabular-nums text-ringo-text">{formatPrice(t.feeAmount, t.currency)}</td>
                    <td className="tabular-nums text-ringo-text">{formatPrice(t.customerTotal, t.currency)}</td>
                    <td>
                      <AdminProtectionStatusBadge status={t.status} />
                    </td>
                    <td className="text-ringo-muted">{new Date(t.createdAt).toLocaleDateString("en-US")}</td>
                    <td className="px-5">
                      <div className="flex gap-1.5">
                        {t.hasDispute && <ShieldAlert size={13} className="text-red-500" aria-label="Disputed" />}
                        {t.hasRefund && <Banknote size={13} className="text-amber-500" aria-label="Refund requested" />}
                        {t.isReleased && <ShieldCheck size={13} className="text-ringo-teal" aria-label="Released" />}
                      </div>
                    </td>
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
