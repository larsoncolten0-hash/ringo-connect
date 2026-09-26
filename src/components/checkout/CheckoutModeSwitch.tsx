"use client";

import { useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import ProductCheckout, { type CheckoutProps } from "./ProductCheckout";
import ProtectionCheckout from "./ProtectionCheckout";

// Lets the customer choose Normal Payment or Ringo Protection before either flow starts. Renders
// the EXISTING <ProductCheckout> completely unmodified (default, pre-selected) for Normal Payment —
// this component never changes its behavior, props or state. Ringo Protection is a sibling
// component with its own controller/API; picking it never touches ProductCheckout's own
// CheckoutController. Protection is offered only when the server says it's available
// (protectionAvailable) — never assumed, never enabled client-side.

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
      <ProductCheckout {...productProps} />
      <div className="fixed inset-x-0 bottom-[92px] z-20 mx-auto flex max-w-lg justify-center px-4">
        <button
          type="button"
          onClick={() => setMode("protection")}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-xl transition active:scale-95"
          style={{ backgroundColor: hexToRgba(theme.bg, 0.9), border: `1px solid ${hairline}`, color: theme.fg }}
        >
          <ShieldCheck size={14} style={{ color: theme.accent }} />
          {c.modeProtection}
        </button>
      </div>
    </div>
  );
}
