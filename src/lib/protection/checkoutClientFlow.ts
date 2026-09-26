// Ringo Protection — customer-facing checkout flow, as a framework-free controller. Mirrors
// productCheckout/clientFlow.ts's own discipline exactly: the UI is never authoritative, the server
// is the only source of truth for the fee/total/status, and success is shown only when the backend
// says `succeeded`. Browser-safe: relative/type-only imports only, no Supabase, no Next.
//
// Unlike Normal Payment's two-call flow (create order, then pay), Protection is three calls: create
// the order through the SAME EXISTING /api/products/orders endpoint (imported here only as a TYPE,
// never modified), then create the Protection transaction, then pay it. All three are idempotent, so
// a retried submit (double tap, a resumed tab) never creates a second order, transaction or payment.

import { computeProtectionFee } from "./fee";
import type { ProtectionCheckoutErrorCode } from "./checkoutErrors";
import type { ProtectionPaymentStatusView } from "./checkPayment";
import type { ProtectionPayStartView } from "./initiatePayment";
import type { CreateOrderBody } from "@/lib/productCheckout/clientFlow";
import type { OrderView } from "@/lib/productCheckout/createOrder";
import type { PaymentMedium, ProtectionTransactionView } from "./checkoutTypes";

export type ClientErrorCode = ProtectionCheckoutErrorCode | "network_error";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ClientErrorCode };

export interface PayBody {
  phone: string;
  medium: PaymentMedium;
}

export interface ProtectionCheckoutApi {
  createOrder(body: CreateOrderBody): Promise<ApiResult<OrderView>>;
  createTransaction(orderId: string): Promise<ApiResult<ProtectionTransactionView>>;
  pay(transactionId: string, body: PayBody): Promise<ApiResult<ProtectionPayStartView>>;
  status(transactionId: string): Promise<ApiResult<ProtectionPaymentStatusView>>;
}

function isProtectionErrorCode(value: unknown): value is ProtectionCheckoutErrorCode {
  return typeof value === "string";
}

/** Real transport: the product-order create route (reused, unmodified) + the three Protection routes. */
export function createProtectionFetchApi(fetchImpl?: typeof fetch): ProtectionCheckoutApi {
  const call = async <T>(url: string, init?: RequestInit): Promise<ApiResult<T>> => {
    try {
      const f = fetchImpl ?? fetch;
      const res = await f(url, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok) return { ok: true, data: data as T };
      return { ok: false, code: isProtectionErrorCode(data?.error) ? (data.error as ProtectionCheckoutErrorCode) : "internal_error" };
    } catch {
      return { ok: false, code: "network_error" };
    }
  };
  return {
    createOrder: (body) => call<OrderView>("/api/products/orders", { method: "POST", body: JSON.stringify(body) }),
    createTransaction: (orderId) => call<ProtectionTransactionView>("/api/protection/checkout", { method: "POST", body: JSON.stringify({ order_id: orderId }) }),
    pay: (transactionId, body) => call<ProtectionPayStartView>(`/api/protection/transactions/${transactionId}/pay`, { method: "POST", body: JSON.stringify(body) }),
    status: (transactionId) => call<ProtectionPaymentStatusView>(`/api/protection/transactions/${transactionId}/pay-status`),
  };
}

// ---------------------------------------------------------------- state

export type ProtectionPhase =
  | "form"
  | "submitting"
  | "waiting"
  | "resuming"
  | "success"
  | "failed"
  | "expired"
  | "order_expired"
  | "unavailable";

export interface ProtectionFormValues {
  quantity: number;
  name: string;
  phone: string;
  email: string;
  note: string;
  payPhone: string;
  medium: PaymentMedium;
}

export interface ProtectionCheckoutState {
  phase: ProtectionPhase;
  form: ProtectionFormValues;
  error: ClientErrorCode | null;
  order: OrderView | null;
  transaction: ProtectionTransactionView | null;
  receipt: ProtectionPaymentStatusView | null;
  expiresAt: string | null;
  pollFailures: number;
}

export interface ProtectionCheckoutConfig {
  productId: string;
  maxQuantity: number;
  feeRate: number; // current admin-configured rate, indicative only — the server always recomputes
  api: ProtectionCheckoutApi;
  prefill?: { name?: string | null; phone?: string | null; email?: string | null };
  unavailable?: boolean; // Protection not offered at all for this product/profile right now
  onTransactionChange?: (transactionId: string | null) => void;
  getLang?: () => string;
  minPollGapMs?: number;
  nowMs?: () => number;
}

/** Indicative product+fee+total for display before the order/transaction exist. Never authoritative. */
export function indicativeTotal(unitPrice: number, quantity: number, feeRate: number): { productAmount: number; feeAmount: number; total: number } {
  const calc = computeProtectionFee(unitPrice * quantity, feeRate);
  return calc ? { productAmount: calc.productAmount, feeAmount: calc.feeAmount, total: calc.customerTotal } : { productAmount: unitPrice * quantity, feeAmount: 0, total: unitPrice * quantity };
}

const MAX_POLL_FAILURES = 5;

export class ProtectionCheckoutController {
  private state: ProtectionCheckoutState;
  private listeners = new Set<() => void>();
  private inFlight = false;
  private polling = false;
  private lastPollAt: number | null = null;
  private payPhoneEdited = false;

  constructor(private cfg: ProtectionCheckoutConfig) {
    const prefillPhone = cfg.prefill?.phone ? cfg.prefill.phone.trim() : "";
    this.state = {
      phase: cfg.unavailable ? "unavailable" : "form",
      form: {
        quantity: 1,
        name: cfg.prefill?.name?.trim() || "",
        phone: prefillPhone,
        email: cfg.prefill?.email?.trim() || "",
        note: "",
        payPhone: /^6\d{8}$/.test(prefillPhone.replace(/[^0-9]/g, "")) ? prefillPhone.replace(/[^0-9]/g, "") : "",
        medium: "mobile money",
      },
      error: null,
      order: null,
      transaction: null,
      receipt: null,
      expiresAt: null,
      pollFailures: 0,
    };
  }

  getState = (): ProtectionCheckoutState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<ProtectionCheckoutState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  edit(patch: Partial<ProtectionFormValues>) {
    const form = { ...this.state.form, ...patch };
    if (patch.payPhone !== undefined) this.payPhoneEdited = true;
    if (patch.phone !== undefined && !this.payPhoneEdited) form.payPhone = patch.phone;
    this.set({ form, error: this.state.phase === "form" ? null : this.state.error });
  }

  /** Create the order (once), the Protection transaction (once) and start the payment. */
  async submit(): Promise<void> {
    if (this.inFlight) return;
    const s = this.state;
    if (s.phase !== "form" && s.phase !== "failed" && s.phase !== "expired") return;

    this.inFlight = true;
    this.set({ phase: "submitting", error: null });
    try {
      let order = s.order;
      if (!order) {
        const created = await this.cfg.api.createOrder({
          product_id: this.cfg.productId,
          quantity: s.form.quantity,
          customer_name: s.form.name,
          customer_phone: s.form.phone,
          ...(s.form.email.trim() ? { customer_email: s.form.email.trim() } : {}),
          ...(s.form.note.trim() ? { note: s.form.note.trim() } : {}),
          ...(this.cfg.getLang?.() === "en" || this.cfg.getLang?.() === "fr" ? { lang: this.cfg.getLang!() as "en" | "fr" } : {}),
        });
        if (!created.ok) return this.failCreate(created.code);
        order = created.data;
        this.set({ order });
      }

      let transaction = s.transaction;
      if (!transaction || transaction.orderId !== order.id) {
        const createdTxn = await this.cfg.api.createTransaction(order.id);
        if (!createdTxn.ok) return this.failGeneric(createdTxn.code);
        transaction = createdTxn.data;
        this.set({ transaction });
        this.cfg.onTransactionChange?.(transaction.id);
      }

      const started = await this.cfg.api.pay(transaction.id, { phone: this.normalizedPayPhone(), medium: this.state.form.medium });
      if (!started.ok) return await this.failPay(started.code);
      this.set({ phase: "waiting", expiresAt: started.data.expires_at, pollFailures: 0 });
    } finally {
      this.inFlight = false;
    }
  }

  retryPayment = () => this.submit();

  private normalizedPayPhone(): string {
    let digits = this.state.form.payPhone.replace(/[^0-9]/g, "");
    if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
    return digits;
  }

  private failCreate(code: ClientErrorCode) {
    this.set({ phase: "form", error: code });
  }
  private failGeneric(code: ClientErrorCode) {
    this.set({ phase: "form", error: code });
  }

  private async failPay(code: ClientErrorCode) {
    switch (code) {
      case "payment_already_pending":
        this.set({ phase: "waiting", error: null, pollFailures: 0 });
        return;
      case "order_expired":
        this.set({ phase: "order_expired", error: code });
        return;
      case "transaction_not_payable":
      case "order_not_payable":
        if (this.state.transaction) {
          this.set({ phase: "resuming", error: null });
          await this.refresh(this.state.transaction.id);
          return;
        }
        this.set({ phase: "form", error: code });
        return;
      case "payment_failed":
      case "too_many_payment_attempts":
        this.set({ phase: "failed", error: code });
        return;
      case "invalid_phone":
      case "invalid_payment_medium":
        this.set({ phase: "form", error: code });
        return;
      default:
        this.set({ phase: "form", error: code });
    }
  }

  async poll(): Promise<void> {
    const s = this.state;
    if (!s.transaction || (s.phase !== "waiting" && s.phase !== "resuming")) return;
    if (this.polling) return;
    const gap = this.cfg.minPollGapMs ?? 0;
    const nowMs = (this.cfg.nowMs ?? Date.now)();
    if (gap > 0 && this.lastPollAt !== null && nowMs - this.lastPollAt < gap) return;
    this.lastPollAt = nowMs;
    this.polling = true;
    try {
      await this.refresh(s.transaction.id);
    } finally {
      this.polling = false;
    }
  }

  async resume(transactionId: string): Promise<void> {
    this.set({ phase: "resuming", error: null });
    this.lastPollAt = (this.cfg.nowMs ?? Date.now)();
    await this.refresh(transactionId, true);
  }

  private async refresh(transactionId: string, isResume = false) {
    const r = await this.cfg.api.status(transactionId);
    if (!r.ok) {
      if (r.code === "transaction_not_found") {
        this.cfg.onTransactionChange?.(null);
        this.set({ transaction: null, phase: this.cfg.unavailable ? "unavailable" : "form", error: isResume ? null : r.code });
        return;
      }
      const pollFailures = this.state.pollFailures + 1;
      this.set({ pollFailures, error: pollFailures >= MAX_POLL_FAILURES ? "network_error" : this.state.error });
      return;
    }
    const v = r.data;
    this.set({ transaction: v.transaction });
    switch (v.status) {
      case "succeeded":
        this.set({ phase: "success", receipt: v, error: null, pollFailures: 0 });
        return;
      case "pending":
        this.set({ phase: "waiting", expiresAt: v.expires_at ?? this.state.expiresAt, error: null, pollFailures: 0 });
        return;
      case "failed":
        this.set({ phase: "failed", error: "payment_failed", pollFailures: 0 });
        return;
      case "expired":
        this.set({ phase: "order_expired", error: "order_expired" });
        return;
      default:
        this.set({ phase: "form", error: null });
    }
  }

  startOver() {
    this.cfg.onTransactionChange?.(null);
    this.payPhoneEdited = false;
    this.set({
      phase: this.cfg.unavailable ? "unavailable" : "form",
      order: null,
      transaction: null,
      receipt: null,
      expiresAt: null,
      error: null,
      pollFailures: 0,
    });
  }
}
