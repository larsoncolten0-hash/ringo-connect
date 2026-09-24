"use client";

import ProductCheckout from "@/components/checkout/ProductCheckout";
import type { PaymentStatusView } from "@/lib/productCheckout/checkPayment";
import type { OrderView } from "@/lib/productCheckout/createOrder";
import type { ApiResult, CheckoutApi } from "@/lib/productCheckout/clientFlow";

// Visual QA harness for the product checkout. NOT part of the real flow: it renders the real checkout
// component against a scripted MOCK backend (no network, no database, no Fapshi), so every state can be
// reviewed while commerce stays disabled. Reached only via /dev-preview-checkout, which 404s in production.

import type { PreviewScenario } from "./previewScenarios";

const ORDER_ID = "00000000-0000-4000-8000-000000000042";
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function mockOrder(status: OrderView["status"] = "awaiting_payment", paid = false): OrderView & { paid_at: string | null } {
  return {
    id: ORDER_ID,
    order_number: "PO-000042",
    status,
    currency: "XAF",
    subtotal: 12000,
    total: 12000,
    expires_at: inMinutes(30),
    items: [{ name: "Preview product", image: null, quantity: 2, unit_price: 6000, line_total: 12000 }],
    paid_at: paid ? new Date().toISOString() : null,
  };
}

function mockApi(scenario: PreviewScenario): CheckoutApi {
  const ok = <T,>(data: T): Promise<ApiResult<T>> => new Promise((r) => setTimeout(() => r({ ok: true, data }), 500));
  const fail = <T,>(code: any): Promise<ApiResult<T>> => new Promise((r) => setTimeout(() => r({ ok: false, code }), 500));
  const statusView = (): PaymentStatusView => {
    switch (scenario) {
      case "success":
        return { status: "succeeded", order: mockOrder("paid", true), receipt_number: "RCP-000042", seller_username: "preview" };
      case "failed":
        return { status: "failed", order: mockOrder(), code: "payment_failed" };
      case "expired":
        return { status: "expired", order: mockOrder(), code: "payment_expired" };
      case "order_expired":
        return { status: "expired", order: mockOrder("expired"), code: "order_expired" };
      case "review":
        return { status: "review", order: mockOrder("payment_review"), code: "payment_review" };
      default:
        return { status: "pending", order: mockOrder(), expires_at: inMinutes(14) };
    }
  };
  return {
    createOrder: () => ok(mockOrder()),
    pay: () => (scenario === "pay_error" ? fail("payment_failed") : ok({ status: "pending" as const, expires_at: inMinutes(15), order: mockOrder() })),
    status: () => ok(statusView()),
  };
}

export default function CheckoutPreview({ scenario, theme }: { scenario: PreviewScenario; theme: { accent: string; bg: string; fg: string } }) {
  // "waiting"/"success"/… start from a paid-for-attempt state by resuming the mock order.
  const resume = scenario !== "form" && scenario !== "unavailable" && scenario !== "pay_error";
  return (
    <ProductCheckout
      key={scenario}
      preview
      api={mockApi(scenario)}
      product={{ id: "00000000-0000-4000-8000-000000000011", name: "Preview product", description: "A short description so you can review the layout.", image: null, unitPrice: 6000, currency: "XAF", maxQuantity: 10, lowStock: 3 }}
      seller={{ name: "Preview Shop", username: "preview" }}
      theme={theme}
      productHref="/dev-preview-checkout"
      sellerHref="/dev-preview-checkout"
      initialOrderId={resume ? ORDER_ID : null}
      unavailableCode={scenario === "unavailable" ? "commerce_disabled" : null}
    />
  );
}
