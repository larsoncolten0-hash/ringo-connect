"use client";

import { useLanguage } from "@/components/LanguageProvider";
import type { FulfillmentState, PaymentState } from "@/lib/productCheckout/sellerOrders";

const PAYMENT_COLOR: Record<PaymentState, string> = {
  paid: "bg-ringo-teal/10 text-ringo-teal",
  awaiting: "bg-amber-500/10 text-amber-600",
  expired: "bg-ringo-muted/10 text-ringo-muted",
  cancelled: "bg-ringo-muted/10 text-ringo-muted",
  review: "bg-ringo-indigo/10 text-ringo-indigo",
  refunded: "bg-red-500/10 text-red-500",
};

const FULFILLMENT_COLOR: Record<Exclude<FulfillmentState, "none">, string> = {
  to_fulfill: "bg-amber-500/10 text-amber-600",
  fulfilled: "bg-ringo-teal/10 text-ringo-teal",
};

const chip = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap";

export function PaymentChip({ state }: { state: PaymentState }) {
  const { t } = useLanguage();
  return <span className={`${chip} ${PAYMENT_COLOR[state]}`}>{t.shopOrders.paymentStates[state]}</span>;
}

export function FulfillmentChip({ state }: { state: FulfillmentState }) {
  const { t } = useLanguage();
  if (state === "none") return null;
  return <span className={`${chip} ${FULFILLMENT_COLOR[state]}`}>{t.shopOrders.fulfillmentStates[state]}</span>;
}
