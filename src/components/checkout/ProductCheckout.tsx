"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Clock, Loader2, Lock, Minus, Plus, ShoppingBag, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import { onAccent, readableAccent } from "@/lib/productCheckout/contrast";
import type { CheckoutErrorCode } from "@/lib/productCheckout/errors";
import {
  CheckoutController,
  createFetchApi,
  friendlyCode,
  secondsLeft,
  type CheckoutApi,
  type FieldName,
} from "@/lib/productCheckout/clientFlow";

// The customer checkout for ONE product (V1: single product, no cart, no shipping). A thin view over
// CheckoutController (src/lib/productCheckout/clientFlow.ts), which owns the flow. The server is the
// only authority for product, price, total, currency, stock, eligibility and payment status — the
// totals shown before the order exists are indicative only, and success is shown only when the backend
// says `succeeded`. Themed with the seller's own colors, the same way the product page is.

export interface CheckoutProductView {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  unitPrice: number;
  currency: string;
  maxQuantity: number; // display bound; the server enforces its own limits
  lowStock: number | null; // remaining units when only a few are left
}

export interface CheckoutProps {
  product: CheckoutProductView;
  seller: { name: string; username: string };
  theme: { accent: string; bg: string; fg: string };
  productHref: string;
  sellerHref: string;
  prefill?: { name?: string | null; phone?: string | null; email?: string | null };
  initialOrderId?: string | null;
  unavailableCode?: CheckoutErrorCode | null;
  /** Injectable transport (previews/tests). Defaults to the real product-order routes. */
  api?: CheckoutApi;
  /** Injectable controller (tests render each phase by driving one). Created from the props when absent. */
  controller?: CheckoutController;
  /** Preview mode never touches the URL. */
  preview?: boolean;
}

// Stable top-level components (defined outside the view so inputs keep focus while typing).
function FieldShell({ label, hint, optional, error, children }: { label: string; hint?: string; optional?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ opacity: 0.75 }}>
        {label}
        {optional && <span style={{ opacity: 0.6 }}> · {optional}</span>}
      </span>
      {children}
      {hint && !error && <span className="text-[11px]" style={{ opacity: 0.55 }}>{hint}</span>}
      {error && (
        <span role="alert" className="text-xs" style={{ color: "#F87171" }}>
          {error}
        </span>
      )}
    </label>
  );
}

function StatusIcon({ tone, accent, children }: { tone: "ok" | "warn" | "bad" | "wait"; accent: string; children: React.ReactNode }) {
  const color = tone === "ok" ? "#10B981" : tone === "bad" ? "#EF4444" : tone === "warn" ? "#F59E0B" : accent;
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(color, 0.16), color }}>
      {children}
    </span>
  );
}

export default function ProductCheckout(props: CheckoutProps) {
  const { product, seller, theme, productHref, sellerHref } = props;
  const { t, locale } = useLanguage();
  const c = t.productCheckout;
  const { accent, bg, fg } = theme;
  const hairline = hexToRgba(fg, 0.14);
  // Legible on ANY seller brand color: text ON the accent, and the accent used as text on the background.
  const btnText = onAccent(accent);
  const accentFg = readableAccent(accent, bg, fg);

  const controllerRef = useRef<CheckoutController | undefined>(props.controller);
  if (!controllerRef.current) {
    controllerRef.current = new CheckoutController({
      productId: product.id,
      maxQuantity: product.maxQuantity,
      api: props.api ?? createFetchApi(),
      prefill: props.prefill,
      unavailableCode: props.unavailableCode ?? null,
      onOrderChange: (orderId) => {
        if (props.preview || typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (orderId) url.searchParams.set("order", orderId);
        else url.searchParams.delete("order");
        window.history.replaceState(null, "", url.toString());
      },
    });
  }
  const ctl = controllerRef.current;
  const state = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  const { phase, form, fieldErrors, order } = state;

  // Coming back to an existing order (refresh / shared link): ask the backend where it stands.
  useEffect(() => {
    if (props.initialOrderId) void ctl.resume(props.initialOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while waiting (and when the tab becomes visible again); tick the countdown.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (phase !== "waiting" && phase !== "resuming") return;
    const first = window.setTimeout(() => void ctl.poll(), 1500);
    const poll = window.setInterval(() => void ctl.poll(), 4000);
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    const onVisible = () => document.visibilityState === "visible" && void ctl.poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, ctl]);

  const money = (amount: number) => formatPrice(amount, order?.currency || product.currency, locale);
  const errorText = (code: string | null | undefined) => (c.errors as Record<string, string>)[friendlyCode(code)] ?? c.errors.generic;
  const busy = phase === "submitting";
  // Indicative only until the server has created the order and returned the authoritative total.
  const displayTotal = order ? order.total : product.unitPrice * form.quantity;
  const canRetry = state.error !== "too_many_payment_attempts";

  const inputStyle = { borderColor: hairline, color: fg, ["--tw-ring-color" as string]: hexToRgba(accent, 0.5) } as React.CSSProperties;
  const inputCls = "w-full rounded-2xl border bg-transparent px-4 py-3 text-[15px] outline-none transition focus:ring-2 min-h-[48px]";

  const err = (name: FieldName) => (fieldErrors[name] ? errorText(fieldErrors[name]) : null);

  const shellHeader = (
    <div className="flex items-center gap-3 pb-5">
      <Link
        href={productHref}
        aria-label={c.back}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90"
        style={{ border: `1px solid ${hairline}` }}
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{c.pageTitle}</h1>
        <p className="truncate text-xs" style={{ opacity: 0.6 }}>
          {c.soldBy} {seller.name}
        </p>
      </div>
    </div>
  );

  const centered = (icon: React.ReactNode, title: string, body?: string, extra?: React.ReactNode) => (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 px-2 text-center" aria-live="polite">
      {icon}
      <div>
        <p className="font-display text-xl font-semibold">{title}</p>
        {body && <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed" style={{ opacity: 0.7 }}>{body}</p>}
      </div>
      {extra}
    </div>
  );

  const primaryBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold shadow-lg transition active:scale-[0.98] disabled:opacity-60";
  const ghostBtn = "flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition active:scale-[0.98]";

  let body: React.ReactNode;

  if (phase === "resuming") {
    body = centered(<Loader2 size={28} className="animate-spin" style={{ color: accentFg }} />, c.submitting);
  } else if (phase === "unavailable") {
    body = centered(
      <StatusIcon accent={accentFg} tone="warn"><AlertTriangle size={26} /></StatusIcon>,
      c.unavailableTitle,
      state.error ? errorText(state.error) : c.unavailableBody,
      <Link href={productHref} className={`${ghostBtn} max-w-xs`} style={{ border: `1px solid ${hairline}` }}>{c.backToProduct}</Link>
    );
  } else if (phase === "order_expired") {
    body = centered(
      <StatusIcon accent={accentFg} tone="warn"><Clock size={26} /></StatusIcon>,
      c.orderExpiredTitle,
      c.orderExpiredBody,
      <button onClick={() => ctl.startOver()} className={`${primaryBtn} max-w-xs`} style={{ backgroundColor: accent, color: btnText }}>{c.startAgain}</button>
    );
  } else if (phase === "review") {
    body = centered(
      <StatusIcon accent={accentFg} tone="warn"><Clock size={26} /></StatusIcon>,
      c.reviewTitle,
      c.reviewBody,
      <div className="flex w-full max-w-xs flex-col gap-3">
        {order && (
          <p className="rounded-2xl px-4 py-3 text-sm" style={{ backgroundColor: hexToRgba(fg, 0.06) }}>
            {c.orderNumber}: <strong>{order.order_number}</strong>
          </p>
        )}
        <Link href={sellerHref} className={ghostBtn} style={{ border: `1px solid ${hairline}` }}>{c.backToSeller(seller.name)}</Link>
      </div>
    );
  } else if (phase === "waiting") {
    const left = secondsLeft(state.expiresAt, now);
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    body = centered(
      <StatusIcon accent={accentFg} tone="wait"><Smartphone size={26} /></StatusIcon>,
      c.waitingTitle,
      c.waitingBody,
      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        <p className="text-xs" style={{ opacity: 0.65 }}>{form.medium === "orange money" ? t.music.orangeDialHint : t.music.mtnDialHint}</p>
        <Loader2 size={20} className="animate-spin" style={{ color: accentFg }} />
        {state.expiresAt && <p className="text-sm font-medium tabular-nums" style={{ opacity: 0.8 }}>{c.timeLeft(`${mm}:${ss}`)}</p>}
        {order && <p className="text-sm" style={{ opacity: 0.8 }} suppressHydrationWarning>{c.orderNumber} {order.order_number} · {money(order.total)}</p>}
        {state.error === "network_error" && <p role="alert" className="text-xs" style={{ color: "#F87171" }}>{errorText("network_error")}</p>}
        <button onClick={() => void ctl.poll()} className={ghostBtn} style={{ border: `1px solid ${hairline}` }}>{c.checkNow}</button>
        <p className="text-[11px]" style={{ opacity: 0.55 }}>{c.waitingNote}</p>
      </div>
    );
  } else if (phase === "success" && state.receipt) {
    const r = state.receipt;
    const o = r.order;
    const item = o.items[0];
    const paidAt = o.paid_at ? new Date(o.paid_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
    const row = (label: string, value: React.ReactNode, strong?: boolean) => (
      <div className="flex items-baseline justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${hairline}` }}>
        <span className="text-xs" style={{ opacity: 0.6 }}>{label}</span>
        <span className={`text-right text-sm ${strong ? "font-semibold" : ""}`} style={strong ? { color: accentFg } : undefined} suppressHydrationWarning>{value}</span>
      </div>
    );
    body = (
      <div className="flex flex-col items-center gap-5 pt-4 text-center" aria-live="polite">
        <StatusIcon accent={accentFg} tone="ok"><Check size={30} strokeWidth={2.6} /></StatusIcon>
        <div>
          <p className="font-display text-2xl font-semibold">{c.successTitle}</p>
          <p className="mt-1.5 text-sm" style={{ opacity: 0.7 }}>{c.successBody}</p>
        </div>
        <div className="w-full rounded-3xl px-5 py-2 text-left" style={{ border: `1px solid ${hairline}`, backgroundColor: hexToRgba(fg, 0.03) }}>
          <p className="pt-3 text-[11px] font-medium uppercase tracking-[0.16em]" style={{ opacity: 0.55 }}>{c.receiptHeading}</p>
          {row(c.receiptNumber, r.receipt_number)}
          {row(c.orderNumber, o.order_number)}
          {item && row(c.productLabel, `${item.name} × ${item.quantity}`)}
          {row(c.amountPaid, money(o.total), true)}
          {row(c.sellerLabel, seller.name)}
          {paidAt && row(c.dateLabel, paidAt)}
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="text-xs" style={{ opacity: 0.6 }}>{c.statusLabel}</span>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: hexToRgba("#10B981", 0.16), color: "#10B981" }}>{c.statusPaid}</span>
          </div>
        </div>
        <p className="text-[11px]" style={{ opacity: 0.55 }}>{c.keepReceipt}</p>
        <Link href={sellerHref} className={`${primaryBtn} max-w-xs`} style={{ backgroundColor: accent, color: btnText }}>{c.backToSeller(seller.name)}</Link>
      </div>
    );
  } else {
    // form / submitting / failed / expired — the details form (or, with an order, just the payment step)
    const banner =
      phase === "failed" || phase === "expired"
        ? { title: phase === "failed" ? c.failedTitle : c.expiredTitle, text: phase === "failed" ? c.failedBody : c.expiredBody }
        : null;
    body = (
      <div className="flex flex-col gap-6">
        {banner && (
          <div role="alert" className="rounded-2xl px-4 py-3" style={{ backgroundColor: hexToRgba(phase === "failed" ? "#EF4444" : "#F59E0B", 0.14) }}>
            <p className="text-sm font-semibold">{banner.title}</p>
            <p className="mt-0.5 text-xs" style={{ opacity: 0.8 }}>{state.error && state.error !== "payment_failed" && state.error !== "payment_expired" ? errorText(state.error) : banner.text}</p>
          </div>
        )}
        {!banner && state.error && phase === "form" && (
          <p role="alert" className="rounded-2xl px-4 py-3 text-sm" style={{ backgroundColor: hexToRgba("#EF4444", 0.14) }}>{errorText(state.error)}</p>
        )}

        {/* What am I buying, how much, from whom */}
        <section className="flex gap-4 rounded-3xl p-3" style={{ border: `1px solid ${hairline}`, backgroundColor: hexToRgba(fg, 0.03) }}>
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl" style={{ backgroundColor: hexToRgba(fg, 0.06) }}>
            {product.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: hexToRgba(accent, 0.14) }}>
                <ShoppingBag size={24} style={{ color: accentFg }} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{order?.items[0]?.name || product.name}</p>
            {product.description && !order && <p className="mt-0.5 line-clamp-2 text-xs" style={{ opacity: 0.6 }}>{product.description}</p>}
            <p className="mt-1 text-sm font-semibold" style={{ color: accentFg }} suppressHydrationWarning>{money(order?.items[0]?.unit_price ?? product.unitPrice)}</p>
            {product.lowStock !== null && !order && <p className="mt-0.5 text-[11px]" style={{ opacity: 0.6 }}>{c.onlyLeft(product.lowStock)}</p>}
          </div>
        </section>

        {/* Quantity (before the order exists) */}
        {!order ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{c.quantity}</span>
            <div className="flex items-center gap-1 rounded-full p-1" style={{ border: `1px solid ${hairline}` }}>
              <button type="button" aria-label="−" disabled={busy || form.quantity <= 1} onClick={() => ctl.edit({ quantity: ctl.getState().form.quantity - 1 })} className="flex h-10 w-10 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"><Minus size={16} /></button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{form.quantity}</span>
              <button type="button" aria-label="+" disabled={busy || form.quantity >= product.maxQuantity} onClick={() => ctl.edit({ quantity: ctl.getState().form.quantity + 1 })} className="flex h-10 w-10 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"><Plus size={16} /></button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span style={{ opacity: 0.7 }}>{c.quantity}</span>
            <span className="font-semibold tabular-nums">{order.items[0]?.quantity}</span>
          </div>
        )}
        {fieldErrors.quantity && <p role="alert" className="-mt-4 text-xs" style={{ color: "#F87171" }}>{errorText(fieldErrors.quantity)}</p>}

        {/* Customer details — only until the order exists */}
        {!order && (
          <section className="flex flex-col gap-4">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ opacity: 0.55 }}>{c.detailsHeading}</h2>
            <FieldShell error={err("name")} label={c.nameLabel}>
              <input value={form.name} onChange={(e) => ctl.edit({ name: e.target.value })} placeholder={c.namePlaceholder} autoComplete="name" disabled={busy} className={inputCls} style={inputStyle} />
            </FieldShell>
            <FieldShell error={err("phone")} label={c.phoneLabel} hint={c.phoneHint}>
              <input value={form.phone} onChange={(e) => ctl.edit({ phone: e.target.value })} placeholder={c.phonePlaceholder} inputMode="tel" autoComplete="tel" disabled={busy} className={inputCls} style={inputStyle} />
            </FieldShell>
            <FieldShell error={err("email")} label={c.emailLabel} optional={c.emailOptional}>
              <input value={form.email} onChange={(e) => ctl.edit({ email: e.target.value })} placeholder={c.emailPlaceholder} inputMode="email" autoComplete="email" disabled={busy} className={inputCls} style={inputStyle} />
            </FieldShell>
            <FieldShell error={err("note")} label={c.noteLabel} optional={c.emailOptional}>
              <textarea value={form.note} onChange={(e) => ctl.edit({ note: e.target.value })} placeholder={c.notePlaceholder} rows={2} maxLength={500} disabled={busy} className={`${inputCls} resize-none`} style={inputStyle} />
            </FieldShell>
          </section>
        )}

        {/* Payment */}
        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ opacity: 0.55 }}>{c.paymentHeading}</h2>
          <div>
            <p className="mb-2 text-xs font-medium" style={{ opacity: 0.75 }}>{c.paymentMethodLabel}</p>
            <div className="flex gap-2" role="radiogroup" aria-label={c.paymentMethodLabel}>
              {([["mobile money", c.mtn], ["orange money", c.orange]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={form.medium === id}
                  disabled={busy}
                  onClick={() => ctl.edit({ medium: id })}
                  className="min-h-[48px] flex-1 rounded-full text-sm font-semibold transition active:scale-[0.98]"
                  style={form.medium === id ? { backgroundColor: accent, color: btnText, border: "1.5px solid transparent" } : { border: `1.5px solid ${hairline}` }}
                >
                  {label}
                </button>
              ))}
            </div>
            {fieldErrors.medium && <p role="alert" className="mt-1 text-xs" style={{ color: "#F87171" }}>{errorText(fieldErrors.medium)}</p>}
          </div>
          <FieldShell error={err("payPhone")} label={c.payNumberLabel} hint={c.payNumberHint}>
            <input value={form.payPhone} onChange={(e) => ctl.edit({ payPhone: e.target.value })} placeholder="6XX XX XX XX" inputMode="tel" autoComplete="tel" disabled={busy} className={inputCls} style={inputStyle} />
          </FieldShell>
          <p className="flex items-center gap-1.5 text-[11px]" style={{ opacity: 0.55 }}><Lock size={12} />{c.securePayNote}</p>
        </section>
      </div>
    );
  }

  const showBar = phase === "form" || phase === "submitting" || phase === "failed" || phase === "expired";

  return (
    <div className="min-h-screen" style={{ backgroundColor: bg, color: fg }}>
      <div className="mx-auto max-w-lg px-4 pt-4" style={{ paddingBottom: showBar ? 132 : 40 }}>
        {shellHeader}
        {body}
      </div>

      {showBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl" style={{ backgroundColor: hexToRgba(bg, 0.86), borderTop: `1px solid ${hairline}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
          <div className="mx-auto flex max-w-lg flex-col gap-2 px-4 pt-3">
            <div className="flex items-baseline justify-between text-sm">
              <span style={{ opacity: 0.7 }}>{c.total}</span>
              <span className="text-lg font-semibold tabular-nums" suppressHydrationWarning>{money(displayTotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => void ctl.submit()}
              disabled={busy || !canRetry}
              aria-busy={busy}
              className={primaryBtn}
              style={{ backgroundColor: accent, color: btnText }}
            >
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  {c.submitting}
                </>
              ) : phase === "failed" || phase === "expired" ? (
                c.retry
              ) : (
                c.payButton(money(displayTotal))
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
