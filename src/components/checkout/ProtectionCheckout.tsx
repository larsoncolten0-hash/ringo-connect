"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Clock, Loader2, Lock, Minus, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import { PAYMENT_STATUS_FIRST_POLL_MS, PAYMENT_STATUS_POLL_INTERVAL_MS } from "@/lib/protection/checkoutConstants";
import { onAccent, readableAccent } from "@/lib/productCheckout/contrast";
import {
  ProtectionCheckoutController,
  createProtectionFetchApi,
  indicativeTotal,
  type ProtectionCheckoutApi,
} from "@/lib/protection/checkoutClientFlow";

// Ringo Protection checkout for ONE product — a thin view over ProtectionCheckoutController
// (src/lib/protection/checkoutClientFlow.ts). Deliberately minimal (per the Phase 4 scope): no
// fulfillment/dispute UI here — this component only covers checkout through "your payment is
// protected." Never renders anything Normal Payment's own ProductCheckout.tsx does not already
// establish is safe: same theme props, same server-is-authoritative discipline.

export interface ProtectionCheckoutProps {
  product: { id: string; name: string; unitPrice: number; currency: string; maxQuantity: number };
  seller: { name: string; username: string };
  theme: { accent: string; bg: string; fg: string };
  feeRate: number; // current admin-configured Protection fee rate, indicative display only
  prefill?: { name?: string | null; phone?: string | null; email?: string | null };
  sellerHref: string;
  api?: ProtectionCheckoutApi;
  controller?: ProtectionCheckoutController;
  preview?: boolean;
}

export default function ProtectionCheckout(props: ProtectionCheckoutProps) {
  const { product, seller, theme, feeRate, sellerHref } = props;
  const { t, locale } = useLanguage();
  const c = t.protectionCheckout;
  const { accent, bg, fg } = theme;
  const hairline = hexToRgba(fg, 0.14);
  const btnText = onAccent(accent);
  const accentFg = readableAccent(accent, bg, fg);

  const controllerRef = useRef<ProtectionCheckoutController | undefined>(props.controller);
  if (!controllerRef.current) {
    controllerRef.current = new ProtectionCheckoutController({
      productId: product.id,
      maxQuantity: product.maxQuantity,
      feeRate,
      api: props.api ?? createProtectionFetchApi(),
      prefill: props.prefill,
      minPollGapMs: PAYMENT_STATUS_POLL_INTERVAL_MS - 1000,
    });
  }
  const ctl = controllerRef.current;
  const state = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  const { phase, form, transaction } = state;

  useEffect(() => {
    if (phase !== "waiting" && phase !== "resuming") return;
    const first = window.setTimeout(() => void ctl.poll(), PAYMENT_STATUS_FIRST_POLL_MS);
    const poll = window.setInterval(() => void ctl.poll(), PAYMENT_STATUS_POLL_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && void ctl.poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, ctl]);

  const money = (amount: number) => formatPrice(amount, product.currency, locale);
  const errorText = (code: string | null | undefined) => (c.errors as Record<string, string>)[code && code in c.errors ? code : "generic"] ?? c.errors.generic;
  const busy = phase === "submitting";

  const indicative = transaction
    ? { productAmount: transaction.productAmount, feeAmount: transaction.protectionFeeAmount, total: transaction.customerTotal }
    : indicativeTotal(product.unitPrice, form.quantity, feeRate);

  const inputStyle = { borderColor: hairline, color: fg, ["--tw-ring-color" as string]: hexToRgba(accent, 0.5) } as React.CSSProperties;
  const inputCls = "w-full rounded-2xl border bg-transparent px-4 py-3 text-[15px] outline-none transition focus:ring-2 min-h-[48px]";
  const primaryBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold shadow-lg transition active:scale-[0.98] disabled:opacity-60";
  const ghostBtn = "flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition active:scale-[0.98]";

  const centered = (icon: React.ReactNode, title: string, body?: string, extra?: React.ReactNode) => (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 px-2 text-center" aria-live="polite">
      {icon}
      <div>
        <p className="font-display text-xl font-semibold">{title}</p>
        {body && <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed" style={{ opacity: 0.7 }}>{body}</p>}
      </div>
      {extra}
    </div>
  );
  const statusIcon = (tone: "ok" | "warn" | "bad" | "wait", children: React.ReactNode) => {
    const color = tone === "ok" ? "#10B981" : tone === "bad" ? "#EF4444" : tone === "warn" ? "#F59E0B" : accentFg;
    return (
      <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(color, 0.16), color }}>
        {children}
      </span>
    );
  };

  const totalsBlock = (
    <div className="rounded-3xl px-4 py-3" style={{ border: `1px solid ${hairline}`, backgroundColor: hexToRgba(fg, 0.03) }}>
      <div className="flex items-baseline justify-between py-1.5 text-sm">
        <span style={{ opacity: 0.65 }}>{c.productAmount}</span>
        <span suppressHydrationWarning>{money(indicative.productAmount)}</span>
      </div>
      <div className="flex items-baseline justify-between py-1.5 text-sm">
        <span style={{ opacity: 0.65 }}>{c.protectionFee}</span>
        <span suppressHydrationWarning>{money(indicative.feeAmount)}</span>
      </div>
      <div className="flex items-baseline justify-between py-1.5 text-sm font-semibold" style={{ borderTop: `1px solid ${hairline}` }}>
        <span>{c.total}</span>
        <span style={{ color: accentFg }} suppressHydrationWarning>{money(indicative.total)}</span>
      </div>
    </div>
  );

  let body: React.ReactNode;

  if (phase === "resuming") {
    body = centered(<Loader2 size={28} className="animate-spin" style={{ color: accentFg }} />, c.submitting);
  } else if (phase === "unavailable") {
    body = centered(statusIcon("warn", <AlertTriangle size={26} />), c.unavailableTitle, c.unavailableBody);
  } else if (phase === "order_expired") {
    body = centered(
      statusIcon("warn", <Clock size={26} />),
      c.orderExpiredTitle,
      c.orderExpiredBody,
      <button onClick={() => ctl.startOver()} className={`${primaryBtn} max-w-xs`} style={{ backgroundColor: accent, color: btnText }}>{c.startAgain}</button>
    );
  } else if (phase === "waiting") {
    body = centered(
      statusIcon("wait", <Smartphone size={26} />),
      c.waitingTitle,
      c.waitingBody,
      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        <p className="text-xs" style={{ opacity: 0.65 }}>{form.medium === "orange money" ? t.music.orangeDialHint : t.music.mtnDialHint}</p>
        <Loader2 size={20} className="animate-spin" style={{ color: accentFg }} />
        <button onClick={() => void ctl.poll()} className={ghostBtn} style={{ border: `1px solid ${hairline}` }}>{c.checkNow}</button>
        <p className="text-[11px]" style={{ opacity: 0.55 }}>{c.waitingNote}</p>
      </div>
    );
  } else if (phase === "success") {
    body = (
      <div className="flex flex-col items-center gap-5 pt-4 text-center" aria-live="polite">
        {statusIcon("ok", <Check size={30} strokeWidth={2.6} />)}
        <div>
          <p className="font-display text-2xl font-semibold">{c.successTitle}</p>
          <p className="mt-1.5 text-sm" style={{ opacity: 0.7 }}>{c.successBody}</p>
        </div>
        <div className="w-full max-w-xs">{totalsBlock}</div>
        <p className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: hexToRgba("#10B981", 0.16), color: "#10B981" }}>
          <ShieldCheck size={13} /> {c.badge}
        </p>
        <p className="max-w-xs text-[11px]" style={{ opacity: 0.6 }}>{c.protectedExplainer}</p>
        <Link href={sellerHref} className={`${primaryBtn} max-w-xs`} style={{ backgroundColor: accent, color: btnText }}>{t.productCheckout.backToSeller(seller.name)}</Link>
      </div>
    );
  } else {
    const banner =
      phase === "failed" ? { title: c.failedTitle, text: c.failedBody } : null;
    body = (
      <div className="flex flex-col gap-6">
        {banner && (
          <div role="alert" className="rounded-2xl px-4 py-3" style={{ backgroundColor: hexToRgba("#EF4444", 0.14) }}>
            <p className="text-sm font-semibold">{banner.title}</p>
            <p className="mt-0.5 text-xs" style={{ opacity: 0.8 }}>{state.error && state.error !== "payment_failed" ? errorText(state.error) : banner.text}</p>
          </div>
        )}
        {!banner && state.error && phase === "form" && (
          <p role="alert" className="rounded-2xl px-4 py-3 text-sm" style={{ backgroundColor: hexToRgba("#EF4444", 0.14) }}>{errorText(state.error)}</p>
        )}

        <div className="flex items-start gap-2 rounded-2xl px-4 py-3" style={{ backgroundColor: hexToRgba(accent, 0.08) }}>
          <ShieldCheck size={18} style={{ color: accentFg }} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed" style={{ opacity: 0.8 }}>{c.protectedExplainer}</p>
        </div>

        {!transaction && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t.productCheckout.quantity}</span>
            <div className="flex items-center gap-1 rounded-full p-1" style={{ border: `1px solid ${hairline}` }}>
              <button type="button" aria-label="−" disabled={busy || form.quantity <= 1} onClick={() => ctl.edit({ quantity: form.quantity - 1 })} className="flex h-10 w-10 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"><Minus size={16} /></button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{form.quantity}</span>
              <button type="button" aria-label="+" disabled={busy || form.quantity >= product.maxQuantity} onClick={() => ctl.edit({ quantity: form.quantity + 1 })} className="flex h-10 w-10 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"><Plus size={16} /></button>
            </div>
          </div>
        )}

        {totalsBlock}

        {!transaction && (
          <div className="flex flex-col gap-3">
            <input value={form.name} onChange={(e) => ctl.edit({ name: e.target.value })} placeholder={t.productCheckout.namePlaceholder} autoComplete="name" disabled={busy} className={inputCls} style={inputStyle} />
            <input value={form.phone} onChange={(e) => ctl.edit({ phone: e.target.value })} placeholder={t.productCheckout.phonePlaceholder} inputMode="tel" autoComplete="tel" disabled={busy} className={inputCls} style={inputStyle} />
            <input value={form.email} onChange={(e) => ctl.edit({ email: e.target.value })} placeholder={t.productCheckout.emailPlaceholder} inputMode="email" autoComplete="email" disabled={busy} className={inputCls} style={inputStyle} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex gap-2" role="radiogroup" aria-label={t.productCheckout.paymentMethodLabel}>
            {([["mobile money", t.productCheckout.mtn], ["orange money", t.productCheckout.orange]] as const).map(([id, label]) => (
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
          <input value={form.payPhone} onChange={(e) => ctl.edit({ payPhone: e.target.value })} placeholder="6XX XX XX XX" inputMode="tel" autoComplete="tel" disabled={busy} className={inputCls} style={inputStyle} />
          <p className="flex items-center gap-1.5 text-[11px]" style={{ opacity: 0.55 }}><Lock size={12} />{t.productCheckout.securePayNote}</p>
        </div>
      </div>
    );
  }

  const showBar = phase === "form" || phase === "submitting" || phase === "failed";

  return (
    <div className="flex flex-col gap-4" style={{ paddingBottom: showBar ? 100 : 20 }}>
      {body}
      {showBar && (
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => void ctl.submit()}
            disabled={busy}
            aria-busy={busy}
            className={primaryBtn}
            style={{ backgroundColor: accent, color: btnText }}
          >
            {busy ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                {c.submitting}
              </>
            ) : phase === "failed" ? (
              c.retry
            ) : (
              c.payButton(money(indicative.total))
            )}
          </button>
        </div>
      )}
    </div>
  );
}
