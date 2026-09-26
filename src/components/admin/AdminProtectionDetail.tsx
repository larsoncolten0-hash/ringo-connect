"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import AdminProtectionStatusBadge from "./AdminProtectionStatusBadge";
import type { AdminProtectionTransactionDetail } from "@/lib/protection/adminTransactions";

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm border-b border-ringo-border/50 last:border-0">
      <dt className="text-xs font-medium text-ringo-muted">{name}</dt>
      <dd className="text-right text-ringo-text tabular-nums min-w-0 break-words">{children}</dd>
    </div>
  );
}
const card = "rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

const ACTOR_LABEL: Record<string, string> = { system: "System (auto)", seller: "Seller", customer: "Customer", admin: "Admin" };

export default function AdminProtectionDetail({ detail }: { detail: AdminProtectionTransactionDetail }) {
  const [resolving, setResolving] = useState<"release" | "refund" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedNote, setResolvedNote] = useState<string | null>(null);

  const resolveDispute = async (action: "release" | "refund") => {
    const label = action === "release" ? "release the protected funds to the seller" : "request a refund (this only creates a pending refund record — it does NOT move real money)";
    if (!window.confirm(`Resolve this dispute to ${label}?`)) return;
    setResolving(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/protection/transactions/${detail.id}/resolve-dispute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "internal_error");
      } else {
        setResolvedNote(body.alreadyResolved ? `Already resolved (${body.resolution}).` : `Resolved: ${body.resolution}.`);
      }
    } catch {
      setError("network_error");
    } finally {
      setResolving(null);
    }
  };

  const money = (n: number) => formatPrice(n, detail.currency, "en");
  const canResolve = detail.dispute && detail.dispute.status === "open" && !resolvedNote;

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <Link href="/admin/protection" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-ringo-muted hover:text-ringo-text w-fit">
        <ArrowLeft size={15} />
        Back to Protection
      </Link>

      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">Ringo Protection</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{detail.orderReference}</h1>
        <div className="mt-2 flex items-center gap-2">
          <AdminProtectionStatusBadge status={detail.status} />
          {detail.sellerUsername && <span className="text-sm text-ringo-muted">@{detail.sellerUsername}</span>}
        </div>
      </div>

      {resolvedNote && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-ringo-teal/10 px-3.5 py-2.5 text-sm font-medium text-ringo-teal">
          <Check size={15} />
          {resolvedNote}
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-500">{error}</p>}

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">Transaction</h2>
        <dl>
          <Row name="Transaction ID">
            <span className="font-mono text-xs">{detail.id}</span>
          </Row>
          <Row name="Order ID">
            <span className="font-mono text-xs">{detail.orderId}</span>
          </Row>
          <Row name="Customer reference">
            <span className="font-mono text-xs">{detail.customerId || "Guest"}</span>
          </Row>
          <Row name="Protected amount">{money(detail.productAmount)}</Row>
          <Row name="Protection fee">
            {money(detail.feeAmount)} ({(detail.feeRate * 100).toFixed(2)}%)
          </Row>
          <Row name="Customer total">{money(detail.customerTotal)}</Row>
          <Row name="Seller protected amount">{money(detail.sellerProtectedAmount)}</Row>
          <Row name="Created">{fmt(detail.createdAt)}</Row>
          <Row name="Updated">{fmt(detail.updatedAt)}</Row>
          {detail.autoReleaseAt && <Row name="Auto-release at">{fmt(detail.autoReleaseAt)}</Row>}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">Payment</h2>
        {detail.payment ? (
          <dl>
            <Row name="Status">{detail.payment.status}</Row>
            {detail.payment.medium && <Row name="Method">{detail.payment.medium}</Row>}
            {detail.payment.providerStatus && <Row name="Provider status">{detail.payment.providerStatus}</Row>}
            {detail.payment.confirmedAt && <Row name="Confirmed">{fmt(detail.payment.confirmedAt)}</Row>}
          </dl>
        ) : (
          <p className="text-sm text-ringo-muted">No payment attempt recorded yet.</p>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">Release</h2>
        {detail.release ? (
          <dl>
            <Row name="Earnings status">{detail.release.status}</Row>
            <Row name="Net amount">{formatPrice(detail.release.netAmount, detail.release.currency, "en")}</Row>
            <Row name="Available at">{fmt(detail.release.availableAt)}</Row>
            <Row name="Payout status">{detail.release.payoutStatus || "Not yet requested by seller"}</Row>
          </dl>
        ) : (
          <p className="text-sm text-ringo-muted">Not released — no commerce_sale_earnings row exists for this transaction yet.</p>
        )}
        {detail.releasedAt && <p className="mt-2 text-xs text-ringo-muted">Released {fmt(detail.releasedAt)}.</p>}
      </section>

      {detail.dispute && (
        <section className={card}>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ringo-text mb-1">
            <ShieldAlert size={15} className="text-red-500" />
            Dispute
          </h2>
          <dl>
            <Row name="Status">{detail.dispute.status.replace(/_/g, " ")}</Row>
            <Row name="Reason">{detail.dispute.reason}</Row>
            {detail.dispute.message && <Row name="Message">{detail.dispute.message}</Row>}
            <Row name="Opened">{fmt(detail.dispute.openedAt)}</Row>
            {detail.dispute.resolvedAt && <Row name="Resolved">{fmt(detail.dispute.resolvedAt)}</Row>}
          </dl>
          {canResolve && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => void resolveDispute("release")}
                disabled={!!resolving}
                className="inline-flex items-center gap-1.5 rounded-full bg-ringo-teal px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
              >
                {resolving === "release" && <Loader2 size={12} className="animate-spin" />}
                <ShieldCheck size={12} />
                Resolve — release to seller
              </button>
              <button
                onClick={() => void resolveDispute("refund")}
                disabled={!!resolving}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-500 px-4 py-2 text-xs font-medium text-red-500 disabled:opacity-60"
              >
                {resolving === "refund" && <Loader2 size={12} className="animate-spin" />}
                Resolve — request refund
              </button>
            </div>
          )}
          {!canResolve && !resolvedNote && detail.dispute.status !== "open" && (
            <p className="mt-2 text-xs text-ringo-muted">Already resolved: {detail.dispute.status.replace(/_/g, " ")}.</p>
          )}
        </section>
      )}

      {detail.refund && (
        <section className={card}>
          <h2 className="text-sm font-semibold text-ringo-text mb-1">Refund</h2>
          <dl>
            <Row name="Status">
              <AdminProtectionStatusBadge status={detail.refund.status} />
            </Row>
            <Row name="Amount">{formatPrice(detail.refund.amount, detail.refund.currency, "en")}</Row>
            <Row name="Destination">{detail.refund.destinationPhone ? `${detail.refund.destinationPhone} (${detail.refund.destinationNetwork})` : "Not yet supplied"}</Row>
            {detail.refund.providerReference && <Row name="Provider reference">{detail.refund.providerReference}</Row>}
            {detail.refund.providerStatus && <Row name="Provider status">{detail.refund.providerStatus}</Row>}
            {detail.refund.failureReason && <Row name="Failure reason">{detail.refund.failureReason}</Row>}
            <Row name="Requested">{fmt(detail.refund.requestedAt)}</Row>
            {detail.refund.processingStartedAt && <Row name="Processing started">{fmt(detail.refund.processingStartedAt)}</Row>}
            {detail.refund.completedAt && <Row name="Completed">{fmt(detail.refund.completedAt)}</Row>}
            {detail.refund.failedAt && <Row name="Failed">{fmt(detail.refund.failedAt)}</Row>}
          </dl>
          {detail.refund.status === "requested" && <p className="mt-2 text-xs text-ringo-muted">Pending manual/provider action — no money has moved yet.</p>}
        </section>
      )}

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-3">Event timeline</h2>
        {detail.events.length === 0 ? (
          <p className="text-sm text-ringo-muted">No events recorded.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {detail.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ringo-indigo" />
                <div className="min-w-0">
                  <p className="text-ringo-text">
                    <span className="capitalize">{e.fromStatus.replace(/_/g, " ")}</span> → <span className="font-medium capitalize">{e.toStatus.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-xs text-ringo-muted">
                    {fmt(e.createdAt)} · {ACTOR_LABEL[e.actorType] || e.actorType}
                    {e.reason ? ` · ${e.reason}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
