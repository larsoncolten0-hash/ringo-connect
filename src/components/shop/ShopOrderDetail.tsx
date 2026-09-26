"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { FulfillmentChip, PaymentChip } from "@/components/shop/ShopStatus";
import { formatWhen } from "@/components/shop/ShopOrdersView";
import { telHref, whatsappHref } from "@/components/shop/contactLinks";
import { isSellerErrorCode, type SellerErrorCode } from "@/lib/productCheckout/sellerErrors";
import type { SellerOrderDetail } from "@/lib/productCheckout/sellerOrders";

const card = "rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const label = "text-xs font-medium text-ringo-muted";

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm border-b border-ringo-border/50 last:border-0">
      <dt className={label}>{name}</dt>
      <dd className="text-right text-ringo-text tabular-nums min-w-0 break-words">{children}</dd>
    </div>
  );
}

// One order: what was bought (price snapshots), the amounts (from the immutable earning record - nothing
// is recalculated), payment and fulfillment state, the customer, and the single seller action.
export default function ShopOrderDetail({ order }: { order: SellerOrderDetail }) {
  const { t, locale } = useLanguage();
  const s = t.shopOrders;
  const p = t.protectionCheckout;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SellerErrorCode | "network_error" | null>(null);
  const [done, setDone] = useState(false);
  // Synchronous guard: state updates are asynchronous, so rapid taps in the same tick would all pass a `saving` check.
  const inFlight = useRef(false);

  const fulfil = async () => {
    if (inFlight.current) return; // a second tap while the request is in flight does nothing
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/product-orders/${order.id}/fulfill`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(isSellerErrorCode(body?.error) ? body.error : "internal_error");
        setConfirming(false);
      } else {
        setDone(true);
        setConfirming(false);
        router.refresh();
      }
    } catch {
      setError("network_error");
      setConfirming(false);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const money = (n: number) => formatPrice(n, order.currency, locale);
  const stateNote =
    order.payment === "review" ? s.reviewNote : order.payment === "awaiting" ? s.awaitingNote : order.payment === "refunded" ? s.refundedNote : order.payment === "expired" || order.payment === "cancelled" ? s.closedNote : null;

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <Link href="/dashboard/shop" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-ringo-muted hover:text-ringo-text w-fit">
        <ArrowLeft size={15} />
        {s.back}
      </Link>

      <div>
        <p className={label}>{s.orderLabel}</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] tabular-nums">{order.reference}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PaymentChip state={order.payment} />
          <FulfillmentChip state={order.fulfillment} />
        </div>
        {stateNote && <p className="mt-3 text-sm text-ringo-muted max-w-lg">{stateNote}</p>}
      </div>

      {done && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-ringo-teal/10 px-3.5 py-2.5 text-sm font-medium text-ringo-teal">
          <Check size={15} />
          {s.fulfilledToast}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-500">
          {s.errors[error]}
        </p>
      )}

      {order.canFulfil && !done && (
        <div className={card}>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full sm:w-auto min-h-[44px] rounded-full bg-ringo-indigo px-5 py-3 text-sm font-medium text-white shadow-sm active:scale-[0.99] transition"
            >
              {s.fulfillButton}
            </button>
          ) : (
            <div role="alertdialog" aria-labelledby="fulfil-title" className="flex flex-col gap-3">
              <p id="fulfil-title" className="text-sm font-semibold text-ringo-text">
                {s.fulfillTitle}
              </p>
              <p className="text-sm text-ringo-muted">{s.fulfillBody}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={fulfil}
                  disabled={saving}
                  aria-busy={saving}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ringo-indigo px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? s.saving : s.fulfillConfirm}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="min-h-[44px] rounded-full border border-ringo-border/70 px-5 py-2.5 text-sm font-medium text-ringo-text disabled:opacity-60">
                  {s.cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-3">{s.itemsTitle}</h2>
        <ul className="flex flex-col gap-3">
          {order.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3">
              {l.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover bg-ringo-muted/10" />
              ) : (
                <span className="h-14 w-14 shrink-0 rounded-xl bg-ringo-muted/10" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ringo-text break-words">{l.name}</p>
                <p className="text-xs text-ringo-muted tabular-nums">
                  {s.quantity} {l.quantity} × {money(l.unitPrice)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-ringo-text tabular-nums">{money(l.lineTotal)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">{s.summaryTitle}</h2>
        <dl>
          <Row name={s.orderTotal}>{money(order.total)}</Row>
          {order.earning ? (
            <>
              <Row name={s.gross}>{money(order.earning.gross)}</Row>
              <Row name={s.commissionLabel(order.earning.commissionRatePct)}>− {money(order.earning.commission)}</Row>
              <Row name={s.net}>
                <strong className="text-ringo-text">{money(order.earning.net)}</strong>
              </Row>
            </>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-ringo-muted">{order.earning ? (order.earning.reversed ? s.reversedNote : s.earningNote) : s.noEarning}</p>
      </section>

      {order.protection && (
        <section className={card}>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ringo-text mb-3">
            <ShieldCheck size={15} className="text-ringo-teal" />
            {p.badge}
          </h2>
          <dl>
            <Row name={p.sellerProtectedAmountLabel}>{money(order.protection.protectedAmount)}</Row>
            <Row name={p.sellerFeeLabel}>{money(order.protection.feeAmount)}</Row>
            <Row name={p.sellerYouWillReceiveLabel}>
              <strong>{money(order.protection.protectedAmount)}</strong>
            </Row>
            <Row name={s.paymentStatus}>{p.statusLabels[order.protection.status as keyof typeof p.statusLabels] ?? order.protection.status}</Row>
          </dl>
          <p className="mt-3 text-xs text-ringo-muted">{p.sellerReleaseNote}</p>
          {order.protection.status === "awaiting_confirmation" && order.protection.autoReleaseAt && (
            <p className="mt-2 text-xs font-medium text-ringo-text" suppressHydrationWarning>
              {p.sellerAutoReleaseNote(new Date(order.protection.autoReleaseAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "medium", timeStyle: "short" }))}
            </p>
          )}
          {order.protection.dispute && (
            <div className="mt-3 rounded-xl bg-red-500/5 p-3">
              <p className="text-xs font-semibold text-red-600">{p.disputeTitle}</p>
              <p className="mt-1 text-xs text-ringo-text">{order.protection.dispute.reason}</p>
              {order.protection.dispute.message && <p className="mt-1 text-xs text-ringo-muted">{order.protection.dispute.message}</p>}
              <p className="mt-1 text-[11px] text-ringo-muted" suppressHydrationWarning>
                {formatWhen(order.protection.dispute.openedAt, locale)}
              </p>
              {order.protection.dispute.resolution && (
                <p className="mt-1 text-[11px] font-medium text-ringo-text">{p.statusLabels[order.protection.dispute.resolution as keyof typeof p.statusLabels] ?? order.protection.dispute.resolution}</p>
              )}
            </div>
          )}
        </section>
      )}

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">{s.paymentTitle}</h2>
        <dl>
          <Row name={s.paymentStatus}>
            <PaymentChip state={order.payment} />
          </Row>
          {order.fulfillment !== "none" && (
            <Row name={s.fulfillmentStatus}>
              <FulfillmentChip state={order.fulfillment} />
            </Row>
          )}
          {order.paymentInfo?.method && <Row name={s.method}>{s.methods[order.paymentInfo.method]}</Row>}
          {order.paymentInfo && <Row name={s.reference}>{order.paymentInfo.reference}</Row>}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">{s.timelineTitle}</h2>
        <dl>
          <Row name={s.placedAt}>
            <time suppressHydrationWarning>{formatWhen(order.timestamps.createdAt, locale)}</time>
          </Row>
          {order.timestamps.paidAt && (
            <Row name={s.paidAt}>
              <time suppressHydrationWarning>{formatWhen(order.timestamps.paidAt, locale)}</time>
            </Row>
          )}
          {order.timestamps.fulfilledAt && (
            <Row name={s.fulfilledAt}>
              <time suppressHydrationWarning>{formatWhen(order.timestamps.fulfilledAt, locale)}</time>
            </Row>
          )}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ringo-text mb-1">{s.customerTitle}</h2>
        <dl>
          <Row name={s.customerLabel}>{order.customer.name}</Row>
          <Row name={s.phone}>{order.customer.phone}</Row>
          {order.customer.email && <Row name={s.email}>{order.customer.email}</Row>}
          {order.customer.note && <Row name={s.note}>{order.customer.note}</Row>}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={telHref(order.customer.phone)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border/70 px-4 py-2 text-sm font-medium text-ringo-text">
            <Phone size={14} />
            {s.call}
          </a>
          <a href={whatsappHref(order.customer.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border/70 px-4 py-2 text-sm font-medium text-ringo-text">
            <MessageCircle size={14} />
            {s.whatsapp}
          </a>
        </div>
      </section>
    </div>
  );
}
