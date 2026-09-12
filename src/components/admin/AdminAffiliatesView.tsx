"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Handshake, Users, Banknote, Trophy, Ban, ShieldCheck, Zap, RefreshCw, Wallet, SlidersHorizontal } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import type { AdminAffiliateOverview } from "@/lib/affiliate";
import type { AffiliateSettings } from "@/lib/affiliateSettings";

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  paid: "bg-ringo-teal/10 text-ringo-teal",
  rejected: "bg-red-500/10 text-red-500",
};

const STATUS_ORDER: Record<string, number> = { requested: 0, processing: 1, paid: 2, rejected: 3 };

function StatTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-ringo-indigo/10">
          <Icon size={12} className="text-ringo-indigo" />
        </span>
        <p className="text-xs text-ringo-muted">{label}</p>
      </div>
      <p className="text-xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em]">{value}</p>
    </div>
  );
}

export default function AdminAffiliatesView({
  overview: initialOverview,
  initialSettings,
}: {
  overview: AdminAffiliateOverview;
  initialSettings: AffiliateSettings;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [statusFilter, setStatusFilter] = useState<"all" | "requested" | "processing" | "paid" | "rejected">("requested");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [fapshiBalance, setFapshiBalance] = useState<{ balance: number; currency: string } | null>(null);
  const [fapshiBalanceError, setFapshiBalanceError] = useState("");

  useEffect(() => {
    fetch("/api/admin/affiliate/balance")
      .then((res) => res.json())
      .then((data) => {
        if (data.balance) setFapshiBalance(data.balance);
        else setFapshiBalanceError(data.error || "Unavailable");
      })
      .catch(() => setFapshiBalanceError("Unavailable"));
  }, []);

  const resolvePayout = async (id: string, action: "paid" | "rejected") => {
    const note = window.prompt(
      action === "paid" ? "Optional note for this payout (e.g. transaction reference):" : "Reason for rejecting (optional):",
      ""
    );
    if (note === null) return; // cancelled

    setResolvingId(id);
    const res = await fetch(`/api/admin/affiliate/payouts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: note || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setResolvingId(null);
    if (!res.ok) {
      alert(data.error || "Could not update this payout.");
      return;
    }
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) => (p.id === id ? { ...p, status: action, processedAt: new Date().toISOString() } : p)),
    }));
    router.refresh();
  };

  const sendViaFapshi = async (id: string) => {
    if (!window.confirm("Send this amount via Fapshi Mobile Money right now? This moves real money.")) return;
    setSendingId(id);
    const res = await fetch(`/api/admin/affiliate/payouts/${id}/send`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setSendingId(null);
    if (!res.ok) {
      alert(data.error || "Could not start the Fapshi disbursement.");
      return;
    }
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) => (p.id === id ? { ...p, status: "processing", fapshiTransId: data.transId } : p)),
    }));
    setStatusFilter("processing");
  };

  const checkFapshiStatus = async (id: string) => {
    setCheckingId(id);
    const res = await fetch(`/api/admin/affiliate/payouts/${id}/check`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setCheckingId(null);
    if (!res.ok) {
      alert(data.error || "Could not check this payout's status.");
      return;
    }
    if (data.status === "CREATED") {
      alert("Still in progress at Fapshi — check again in a moment.");
      return;
    }
    // SUCCESSFUL -> paid, FAILED/EXPIRED -> back to requested (retryable).
    // Set locally rather than relying on router.refresh() alone — this
    // component seeds its state from props once on mount, so a refreshed
    // server prop wouldn't otherwise be reflected without a remount.
    const nextStatus = data.status === "SUCCESSFUL" ? "paid" : "requested";
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) =>
        p.id === id ? { ...p, status: nextStatus, processedAt: nextStatus === "paid" ? new Date().toISOString() : p.processedAt } : p
      ),
    }));
    router.refresh();
  };

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    if (!window.confirm(suspended ? "Suspend this affiliate's ability to earn commissions?" : "Re-enable this affiliate?")) return;
    await fetch(`/api/admin/affiliate/users/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended }),
    });
    router.refresh();
  };

  const filteredPayouts = [...overview.payouts]
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || +new Date(b.requestedAt) - +new Date(a.requestedAt));

  const currencies = Object.keys(overview.totalsByCurrency);

  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Affiliate program</h1>
        <p className="text-sm text-ringo-muted mt-1">
          Commissions are computed automatically whenever a referred creator's payment succeeds. This page is for
          program settings and payout requests.
        </p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatTile label="Affiliates with referrals" value={overview.affiliateCount} icon={Handshake} />
        <StatTile label="Referred users" value={overview.referredUserCount} icon={Users} />
        {currencies.map((cur) => (
          <StatTile
            key={cur}
            label={`Outstanding (${cur})`}
            value={formatPrice(overview.totalsByCurrency[cur].outstanding, cur)}
            icon={Banknote}
          />
        ))}
        <StatTile
          label="Fapshi balance"
          value={fapshiBalance ? formatPrice(fapshiBalance.balance, fapshiBalance.currency) : fapshiBalanceError ? "—" : "…"}
          icon={Wallet}
        />
      </div>
      {fapshiBalanceError && (
        <p className="text-xs text-ringo-muted -mt-3 flex items-center gap-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          Fapshi balance unavailable ({fapshiBalanceError}) — Mobile Money payouts can still be sent, this just can't preview
          the float first.
        </p>
      )}

      {/* Settings now live centrally — see Price Controls — so changing
          them never means hunting between two edit surfaces. This is a
          read-only glance plus a link. */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-ringo-muted">
          {initialSettings.affiliateEnabled ? "Enabled" : "Disabled"} · {Math.round(initialSettings.affiliateCommissionRate * 10000) / 100}%
          commission · {initialSettings.affiliateHoldDays}-day hold
        </p>
        <Link
          href="/admin/price-controls"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ringo-indigo hover:underline"
        >
          <SlidersHorizontal size={13} />
          Edit in Price Controls
        </Link>
      </div>

      {/* Payout requests */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-4 flex-wrap gap-3">
          <h2 className="text-sm font-medium text-ringo-text">Payout requests</h2>
          <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1">
            {(["requested", "processing", "all", "paid", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs font-medium px-3 py-1 rounded-full capitalize transition ${
                  statusFilter === s ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {filteredPayouts.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-14">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <Banknote size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No payout requests here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Affiliate</th>
                  <th className="font-normal">Amount</th>
                  <th className="font-normal">Method</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Requested</th>
                  <th className="font-normal px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayouts.map((p) => (
                  <tr key={p.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <p className="text-ringo-text font-medium truncate max-w-[180px]">
                        {p.affiliate.username ? `@${p.affiliate.username}` : p.affiliate.email}
                      </p>
                      <p className="text-xs text-ringo-muted truncate max-w-[180px]">{p.affiliate.email}</p>
                    </td>
                    <td className="text-ringo-text tabular-nums">{formatPrice(p.amount, p.currency)}</td>
                    <td className="text-ringo-muted capitalize">{(p.payoutMethod || "—").replace("_", " ")}</td>
                    <td>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLES[p.status]}`}>
                        {p.status}
                      </span>
                      {p.status === "processing" && p.fapshiTransId && (
                        <p className="text-[10px] text-ringo-muted mt-1 font-mono truncate max-w-[120px]">{p.fapshiTransId}</p>
                      )}
                    </td>
                    <td className="text-ringo-muted">{new Date(p.requestedAt).toLocaleDateString("en-US")}</td>
                    <td className="px-5 text-right">
                      {p.status === "requested" || p.status === "processing" ? (
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {p.status === "requested" && p.currency === "XAF" && p.payoutMethod === "mobile_money" && (
                            <button
                              onClick={() => sendViaFapshi(p.id)}
                              disabled={sendingId === p.id}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
                            >
                              <Zap size={11} />
                              {sendingId === p.id ? "Sending…" : "Send via Fapshi"}
                            </button>
                          )}
                          {p.status === "processing" && (
                            <button
                              onClick={() => checkFapshiStatus(p.id)}
                              disabled={checkingId === p.id}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-indigo text-ringo-indigo disabled:opacity-50"
                            >
                              <RefreshCw size={11} className={checkingId === p.id ? "animate-spin" : ""} />
                              Check status
                            </button>
                          )}
                          <button
                            onClick={() => resolvePayout(p.id, "paid")}
                            disabled={resolvingId === p.id}
                            className="text-xs px-3 py-1.5 rounded-card bg-ringo-teal text-white disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                          <button
                            onClick={() => resolvePayout(p.id, "rejected")}
                            disabled={resolvingId === p.id}
                            className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-ringo-muted">
                          {p.processedAt ? new Date(p.processedAt).toLocaleDateString("en-US") : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top affiliates */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <h2 className="text-sm font-medium text-ringo-text p-5 pb-4 flex items-center gap-2">
          <Trophy size={14} className="text-ringo-indigo" />
          Top affiliates
        </h2>
        {overview.topAffiliates.length === 0 ? (
          <p className="text-sm text-ringo-muted px-5 pb-5">No commissions have been earned yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Affiliate</th>
                  <th className="font-normal">Referrals</th>
                  <th className="font-normal">Lifetime earnings</th>
                  <th className="font-normal px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.topAffiliates.map((a) => (
                  <tr key={a.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <p className="text-ringo-text font-medium truncate max-w-[180px]">
                        {a.username ? `@${a.username}` : a.email}
                      </p>
                    </td>
                    <td className="text-ringo-text tabular-nums">{a.referralCount}</td>
                    <td className="text-ringo-text tabular-nums">
                      {Object.entries(a.lifetimeByCurrency)
                        .map(([cur, amt]) => formatPrice(amt, cur))
                        .join(" + ") || "—"}
                    </td>
                    <td className="px-5 text-right">
                      <button
                        onClick={() => toggleSuspend(a.id, true)}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-muted hover:border-red-500 hover:text-red-500 transition-colors"
                      >
                        <Ban size={12} />
                        Suspend
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ringo-muted px-5 py-3 border-t border-ringo-border/60 flex items-center gap-1.5">
          <ShieldCheck size={12} className="shrink-0" />
          Suspending an affiliate stops new commissions from accruing to them — it doesn't touch their account or
          existing balance.
        </p>
      </div>
    </div>
  );
}
