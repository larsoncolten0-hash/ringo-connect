"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { onAccent } from "@/lib/productCheckout/contrast";
import ProductCheckout, { type CheckoutProps } from "./ProductCheckout";
import ProtectionCheckout from "./ProtectionCheckout";

// Lets the customer choose Normal Payment or Ringo Protection before either flow starts. Renders
// the EXISTING <ProductCheckout> completely unmodified (default, pre-selected) for Normal Payment —
// this component never changes its behavior, props or state. Ringo Protection is a sibling
// component with its own controller/API; picking it never touches ProductCheckout's own
// CheckoutController. Protection is offered only when the server says it's available
// (protectionAvailable) — never assumed, never enabled client-side.
//
// The offer banner is a real, inline, accent-colored card at the very TOP of the page — not a small
// floating pill low in the viewport, which real customers were missing entirely (it competed for
// attention with ProductCheckout's own bold, sticky, accent-colored primary pay bar right below it,
// at a lower z-index, in neutral theme colors). This is the first thing a visitor sees, before the
// product details even render, using the copy (modeSwitchTitle/modeProtectionHint) that already
// existed in translations.ts but was never actually surfaced in the shipped UI.

export interface CheckoutModeSwitchProps extends CheckoutProps {
  protectionAvailable: boolean;
  protectionFeeRate: number | null;
}

export default function CheckoutModeSwitch({ protectionAvailable, protectionFeeRate, ...productProps }: CheckoutModeSwitchProps) {
  const [mode, setMode] = useState<"normal" | "protection">("normal");
  const { t } = useLanguage();
  const c = t.protectionCheckout;
  const { product, seller, theme, sellerHref } = productProps;
  const hairline = hexToRgba(theme.fg, 0.14);

  if (!protectionAvailable || protectionFeeRate === null) {
    return <ProductCheckout {...productProps} />;
  }

  if (mode === "protection") {
    return (
      <div className="min-h-screen" style={{ backgroundColor: theme.bg, color: theme.fg }}>
        <div className="mx-auto max-w-lg px-4 pt-4 pb-10">
          <div className="flex items-center gap-3 pb-5">
            <button
              type="button"
              aria-label={t.productCheckout.back}
              onClick={() => setMode("normal")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90"
              style={{ border: `1px solid ${hairline}` }}
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{c.pageTitle}</h1>
              <p className="truncate text-xs" style={{ opacity: 0.6 }}>{t.productCheckout.soldBy} {seller.name}</p>
            </div>
          </div>
          <ProtectionCheckout
            product={{ id: product.id, name: product.name, unitPrice: product.unitPrice, currency: product.currency, maxQuantity: product.maxQuantity }}
            seller={seller}
            theme={theme}
            feeRate={protectionFeeRate}
            prefill={productProps.prefill}
            sellerHref={sellerHref}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.bg, color: theme.fg }}>
      <div className="mx-auto max-w-lg px-4 pt-4">
        <button
          type="button"
          onClick={() => setMode("protection")}
          className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition active:scale-[0.98]"
          style={{ backgroundColor: hexToRgba(theme.accent, 0.12), border: `1px solid ${hexToRgba(theme.accent, 0.35)}` }}
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: theme.accent, color: onAccent(theme.accent) }}
          >
            <ShieldCheck size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: theme.accent }}>
              {c.modeSwitchTitle}
            </span>
            <span className="block text-sm font-bold">{c.modeProtection}</span>
            <span className="block text-xs leading-snug" style={{ opacity: 0.75 }}>
              {c.modeProtectionHint}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0" style={{ color: theme.accent }} />
        </button>
      </div>
      <ProductCheckout {...productProps} />
    </div>
  );
}
