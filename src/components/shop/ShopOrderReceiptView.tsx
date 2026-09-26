"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Package, ShieldCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import type { ShopReceiptData } from "@/lib/productCheckout/receipt";

// The customer-facing receipt for a Shop order (Increment 5B) — deliberately a simple,
// phone-first "here's what you bought" card, same audience and posture as the music/restaurant
// receipt pages (see src/app/shop/orders/[id]/page.tsx for the access-control reasoning).
const STATUS_TONE: Record<string, string> = {
  awaiting_payment: "#B45309",
  paid: "#059669",
  fulfilled: "#059669",
  cancelled: "#DC2626",
  expired: "#6B7280",
  refunded: "#6B7280",
  payment_review: "#B45309",
};

export default function ShopOrderReceiptView({ data }: { data: ShopReceiptData }) {
  const { t, locale } = useLanguage();
  const r = t.shopReceipt;
  const p = t.protectionCheckout;

  // Ringo Protection (Phase 6): local, optimistic override once the customer confirms — the server
  // remains the sole authority (this just avoids a full page reload to show the result). A second
  // tap while one request is in flight is ignored; the API call itself is idempotent regardless.
  const [confirmStatus, setConfirmStatus] = useState<"released" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Ringo Protection (Phase 7): same optimistic-override pattern for opening a dispute.
  const [disputeStatus, setDisputeStatus] = useState<"disputed" | null>(null);
  const [disputeFormOpen, setDisputeFormOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeMessage, setDisputeMessage] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const disputeInFlight = useRef(false);

  const protectionStatus = disputeStatus ?? confirmStatus ?? data.protection?.status ?? null;
  const disputeEligible = protectionStatus === "protected" || protectionStatus === "fulfillment_started" || protectionStatus === "awaiting_confirmation";

  const confirmReceipt = async () => {
    if (inFlight.current || !data.protection) return;
    inFlight.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/protection/transactions/${data.protection.transactionId}/confirm`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConfirmError(typeof body?.error === "string" ? body.error : "internal_error");
      } else {
        setConfirmStatus("released");
      }
    } catch {
      setConfirmError("network_error");
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  };

  const submitDispute = async () => {
    if (disputeInFlight.current || !data.protection) return;
    if (!disputeReason.trim()) {
      setDisputeError("invalid_request");
      return;
    }
    disputeInFlight.current = true;
    setDisputing(true);
    setDisputeError(null);
    try {
      const res = await fetch(`/api/protection/transactions/${data.protection.transactionId}/dispute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: disputeReason.trim(), message: disputeMessage.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisputeError(typeof body?.error === "string" ? body.error : "internal_error");
      } else {
        setDisputeStatus("disputed");
        setDisputeFormOpen(false);
      }
    } catch {
      setDisputeError("network_error");
    } finally {
      disputeInFlight.current = false;
      setDisputing(false);
    }
  };

  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" });

  const statusLabel = r.status[data.status] ?? data.status;
  const statusColor = STATUS_TONE[data.status] || "#6B7280";
  const paymentStatusLabel = data.payment ? r.paymentStatus[data.payment.status] ?? data.payment.status : null;
  const paymentMethodLabel = data.payment?.method ? r.paymentMethod[data.payment.method] ?? data.payment.method : null;

  return (
    <div className="min-h-screen bg-white pb-16 flex flex-col items-center" style={{ color: "#14202B" }}>
      <div className="w-full max-w-sm px-4 py-6 flex flex-col gap-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider" style={{ opacity: 0.5 }}>
          Ringo Connect
        </p>

        <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid #E5E7EB" }}>
          <div className="px-5 pt-6 pb-4 text-center" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <p className="text-sm font-semibold" style={{ opacity: 0.6 }}>
              {r.orderLabel(data.orderNumber)}
            </p>
            <h1 className="mt-1 text-xl font-bold">{r.title}</h1>
            <p className="mt-1 text-sm" style={{ opacity: 0.6 }}>
              {r.from(data.sellerName)}
            </p>
            <span
              className="mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: `${statusColor}1A`, color: statusColor }}
            >
              {statusLabel}
            </span>
          </div>

          <div className="px-5 py-4" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
              {r.itemsTitle}
            </p>
            <ul className="flex flex-col gap-3">
              {data.items.map((item, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      style={{ border: "1px solid #E5E7EB" }}
                    />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#F3F4F6" }}>
                      <Package size={18} style={{ opacity: 0.4 }} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs" style={{ opacity: 0.6 }}>
                      {r.quantityTimesPrice(item.quantity, formatPrice(item.unitPrice, data.currency, locale))}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">{formatPrice(item.lineTotal, data.currency, locale)}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="px-5 py-4" style={{ borderBottom: "1px solid #E5E7EB" }}>
            <div className="flex items-center justify-between text-sm" style={{ opacity: 0.7 }}>
              <span>{r.subtotal}</span>
              <span>{formatPrice(data.subtotal, data.currency, locale)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-base font-bold">
              <span>{r.total}</span>
              <span>{formatPrice(data.total, data.currency, locale)}</span>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
              {r.paymentTitle}
            </p>
            {data.payment ? (
              <div className="flex flex-col gap-1 text-sm">
                <p>{paymentStatusLabel}</p>
                {paymentMethodLabel && <p style={{ opacity: 0.6 }}>{paymentMethodLabel}</p>}
                {data.payment.confirmedAt && <p style={{ opacity: 0.6 }}>{r.paidOn(fmtDate(data.payment.confirmedAt))}</p>}
              </div>
            ) : (
              <p className="text-sm" style={{ opacity: 0.6 }}>
                {r.noPayment}
              </p>
            )}
            <p className="mt-3 text-xs" style={{ opacity: 0.5 }}>
              {r.placedOn(fmtDate(data.createdAt))}
            </p>
          </div>

          {data.protection && protectionStatus && (
            <div className="px-5 py-4" style={{ borderTop: "1px solid #E5E7EB" }}>
              <div className="mb-2 flex items-center gap-1.5">
                <ShieldCheck size={14} style={{ color: "#059669" }} />
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
                  {p.badge}
                </p>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span style={{ opacity: 0.6 }}>{p.productAmount}</span>
                  <span>{formatPrice(data.protection.protectedAmount, data.currency, locale)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ opacity: 0.6 }}>{p.protectionFee}</span>
                  <span>{formatPrice(data.protection.feeAmount, data.currency, locale)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between font-semibold">
                  <span>{p.statusLabels[protectionStatus] ?? protectionStatus}</span>
                </div>
              </div>

              {protectionStatus === "released" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: "#059669" }}>
                  <Check size={13} />
                  {p.confirmedBody}
                </p>
              )}

              {protectionStatus === "fulfillment_started" && (
                <p className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {p.fulfillmentStartedNote}
                </p>
              )}

              {protectionStatus === "disputed" && (
                <p className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {p.disputedBody}
                </p>
              )}

              {protectionStatus === "resolved_release" && (
                <p className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {p.resolvedReleaseNote}
                </p>
              )}

              {protectionStatus === "resolved_refund" && !data.protection.refund && (
                <p className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {p.refundRequestedNote}
                </p>
              )}

              {data.protection.refund && (
                <p className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {p.refundStatusNotes[data.protection.refund.status]}
                </p>
              )}

              {protectionStatus === "awaiting_confirmation" && !confirmStatus && !disputeFormOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs" style={{ opacity: 0.6 }}>
                    {p.awaitingConfirmationNote}
                  </p>
                  <p className="text-xs" style={{ opacity: 0.6 }}>
                    {p.confirmExplainer}
                  </p>
                  {data.protection.autoReleaseAt && (
                    <p className="text-xs font-medium" style={{ opacity: 0.75 }}>
                      {p.autoReleaseNote(new Date(data.protection.autoReleaseAt).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short" }))}
                    </p>
                  )}
                  {confirmError && (
                    <p role="alert" className="text-xs" style={{ color: "#DC2626" }}>
                      {(p.errors as Record<string, string>)[confirmError] ?? p.errors.internal_error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void confirmReceipt()}
                    disabled={confirming}
                    aria-busy={confirming}
                    className="mt-1 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: "#059669" }}
                  >
                    {confirming && <Loader2 size={14} className="animate-spin" />}
                    {confirming ? p.confirming : p.confirmButton}
                  </button>
                </div>
              )}

              {disputeEligible && !disputeFormOpen && (
                <button
                  type="button"
                  onClick={() => setDisputeFormOpen(true)}
                  className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-full px-4 text-xs font-semibold"
                  style={{ border: "1px solid #DC2626", color: "#DC2626" }}
                >
                  {p.disputeButton}
                </button>
              )}

              {disputeEligible && disputeFormOpen && (
                <div className="mt-3 flex flex-col gap-2 rounded-2xl p-3" style={{ backgroundColor: "#FEF2F2" }}>
                  <p className="text-xs font-semibold" style={{ color: "#991B1B" }}>
                    {p.disputeTitle}
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium" style={{ opacity: 0.7 }}>
                      {p.disputeReasonLabel}
                    </span>
                    <input
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      placeholder={p.disputeReasonPlaceholder}
                      maxLength={100}
                      disabled={disputing}
                      className="rounded-xl border px-3 py-2 text-sm"
                      style={{ borderColor: "#E5E7EB" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium" style={{ opacity: 0.7 }}>
                      {p.disputeMessageLabel}
                    </span>
                    <textarea
                      value={disputeMessage}
                      onChange={(e) => setDisputeMessage(e.target.value)}
                      placeholder={p.disputeMessagePlaceholder}
                      maxLength={2000}
                      rows={3}
                      disabled={disputing}
                      className="resize-none rounded-xl border px-3 py-2 text-sm"
                      style={{ borderColor: "#E5E7EB" }}
                    />
                  </label>
                  <p className="text-[11px]" style={{ opacity: 0.6 }}>
                    {p.disputeConfirmPrompt}
                  </p>
                  {disputeError && (
                    <p role="alert" className="text-xs" style={{ color: "#DC2626" }}>
                      {(p.errors as Record<string, string>)[disputeError] ?? p.errors.internal_error}
                    </p>
                  )}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void submitDispute()}
                      disabled={disputing}
                      aria-busy={disputing}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: "#DC2626" }}
                    >
                      {disputing && <Loader2 size={14} className="animate-spin" />}
                      {disputing ? p.disputeSubmitting : p.disputeSubmit}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeFormOpen(false)}
                      disabled={disputing}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-full px-4 text-sm font-semibold"
                      style={{ border: "1px solid #E5E7EB" }}
                    >
                      {p.disputeCancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs" style={{ opacity: 0.4 }}>
          {r.receiptLabel(data.receiptNumber)}
        </p>
      </div>
    </div>
  );
}
