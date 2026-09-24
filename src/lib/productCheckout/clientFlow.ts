// Customer-facing checkout flow, as a framework-free controller. The React component is a thin view
// over this; keeping the logic here makes it testable without a browser or a network.
//
// The UI is NEVER authoritative. It only sends what the API whitelists (product id, quantity, contact
// details; payer phone + medium) and displays what the backend answers. It never computes a price,
// currency, creator or payment status, and it never claims success until the backend says
// `succeeded`. Validation reuses the SAME pure parsers the server runs, so the rules exist once.
// Browser-safe: relative imports only, no Supabase, no Next.

import { MAX_QUANTITY } from "./constants";
import type { CheckoutErrorCode } from "./errors";
import { isCheckoutErrorCode } from "./errors";
import type { PaymentStatusView } from "./checkPayment";
import type { OrderView } from "./createOrder";
import type { PayStartView } from "./initiatePayment";
import type { PaymentMedium } from "./types";
import { isUuid, normalizePayerPhone, parseCreateOrderInput, parsePayInput } from "./validation";

// ---------------------------------------------------------------- API boundary

export type ClientErrorCode = CheckoutErrorCode | "network_error";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ClientErrorCode };

export interface CreateOrderBody {
  product_id: string;
  quantity: number;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  note?: string;
}
export interface PayBody {
  phone: string;
  medium: PaymentMedium;
}

export interface CheckoutApi {
  createOrder(body: CreateOrderBody): Promise<ApiResult<OrderView>>;
  pay(orderId: string, body: PayBody): Promise<ApiResult<PayStartView>>;
  status(orderId: string): Promise<ApiResult<PaymentStatusView>>;
}

/** Real transport: the three product-order routes. Errors become stable codes, never server text. */
export function createFetchApi(fetchImpl?: typeof fetch): CheckoutApi {
  const call = async <T>(url: string, init?: RequestInit): Promise<ApiResult<T>> => {
    try {
      const f = fetchImpl ?? fetch;
      const res = await f(url, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok) return { ok: true, data: data as T };
      return { ok: false, code: isCheckoutErrorCode(data?.error) ? data.error : "internal_error" };
    } catch {
      return { ok: false, code: "network_error" };
    }
  };
  return {
    createOrder: (body) => call<OrderView>("/api/products/orders", { method: "POST", body: JSON.stringify(body) }),
    pay: (orderId, body) => call<PayStartView>(`/api/products/orders/${orderId}/pay`, { method: "POST", body: JSON.stringify(body) }),
    status: (orderId) => call<PaymentStatusView>(`/api/products/orders/${orderId}/pay-status`),
  };
}

// ---------------------------------------------------------------- state

export type Phase =
  | "form" // entering details (or, with an order already created, just re-entering payment details)
  | "submitting" // creating the order / starting the payment
  | "waiting" // the phone prompt is out; polling the backend
  | "resuming" // returning to an existing order (refresh / shared link)
  | "success" // backend confirmed payment
  | "failed" // payment failed — may retry
  | "expired" // this payment attempt expired — order still open, may retry
  | "order_expired" // the reservation ran out — start again
  | "review" // paid but needs a human check
  | "unavailable"; // checkout not possible for this product

export interface FormValues {
  quantity: number;
  name: string;
  phone: string;
  email: string;
  note: string;
  payPhone: string;
  medium: PaymentMedium;
}
export type FieldName = keyof FormValues;

export interface CheckoutState {
  phase: Phase;
  form: FormValues;
  fieldErrors: Partial<Record<FieldName, ClientErrorCode>>;
  error: ClientErrorCode | null;
  order: OrderView | null;
  receipt: PaymentStatusView | null;
  expiresAt: string | null;
  pollFailures: number;
}

export interface CheckoutConfig {
  productId: string;
  maxQuantity: number; // display bound only; the server enforces its own
  api: CheckoutApi;
  prefill?: { name?: string | null; phone?: string | null; email?: string | null };
  /** set when the server already knows checkout is blocked for this product */
  unavailableCode?: CheckoutErrorCode | null;
  /** called whenever the current order id changes, so the view can keep ?order= in the URL */
  onOrderChange?: (orderId: string | null) => void;
  /** Minimum ms between backend status checks (Fapshi rate limit). Omitted/0 = unthrottled (tests). */
  minPollGapMs?: number;
  /** Clock in ms, injectable for tests. */
  nowMs?: () => number;
}

// ---------------------------------------------------------------- pure helpers

/** Codes meaning "this product cannot be bought right now" (as opposed to "fix your input"). */
export const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "commerce_disabled",
  "payment_provider_unavailable",
  "profile_unavailable",
  "music_profile_not_supported",
  "commerce_currency_unsupported",
  "product_unavailable",
  "product_price_unsupported",
]);

export const clampQuantity = (n: number, maxQuantity: number): number => {
  const cap = Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(maxQuantity) || 1));
  return Math.max(1, Math.min(cap, Math.trunc(Number.isFinite(n) ? n : 1)));
};

export function buildCreateBody(productId: string, f: FormValues): CreateOrderBody {
  const body: CreateOrderBody = {
    product_id: productId,
    quantity: f.quantity,
    customer_name: f.name,
    customer_phone: f.phone,
  };
  if (f.email.trim()) body.customer_email = f.email.trim();
  if (f.note.trim()) body.note = f.note.trim();
  return body;
}

export const buildPayBody = (f: FormValues): PayBody => ({ phone: normalizePayerPhone(f.payPhone), medium: f.medium });

const PLACEHOLDER = { name: "Aa", phone: "600000000", quantity: 1 };

/** Field-by-field validation with the SERVER's parsers (all errors at once). Returns {} when valid. */
export function validatePayFields(f: FormValues): Partial<Record<FieldName, ClientErrorCode>> {
  const errors: Partial<Record<FieldName, ClientErrorCode>> = {};
  const p = parsePayInput({ phone: f.payPhone, medium: f.medium });
  if (!p.ok) errors[p.code === "invalid_payment_medium" ? "medium" : "payPhone"] = p.code;
  return errors;
}

export function validateForm(productId: string, f: FormValues, maxQuantity: number): Partial<Record<FieldName, ClientErrorCode>> {
  const errors: Partial<Record<FieldName, ClientErrorCode>> = {};
  const base = { product_id: productId, quantity: PLACEHOLDER.quantity, customer_name: PLACEHOLDER.name, customer_phone: PLACEHOLDER.phone };
  const check = (field: FieldName, override: Record<string, unknown>) => {
    const r = parseCreateOrderInput({ ...base, ...override });
    if (!r.ok) errors[field] = r.code;
  };
  check("quantity", { quantity: f.quantity });
  if (!errors.quantity && f.quantity > clampQuantity(f.quantity, maxQuantity) && f.quantity > 0) errors.quantity = "quantity_exceeds_max";
  check("name", { customer_name: f.name });
  check("phone", { customer_phone: f.phone });
  if (f.email.trim()) check("email", { customer_email: f.email });
  if (f.note.trim()) check("note", { note: f.note });
  Object.assign(errors, validatePayFields(f));
  return errors;
}

export const secondsLeft = (expiresAt: string | null, now: Date): number =>
  expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000)) : 0;

/** Anything the translations don't know becomes the generic message. */
export const friendlyCode = (code: string | null | undefined): ClientErrorCode | "generic" =>
  code === "network_error" || isCheckoutErrorCode(code) ? (code as ClientErrorCode) : "generic";

// ---------------------------------------------------------------- controller

const MAX_POLL_FAILURES = 5;

export class CheckoutController {
  private state: CheckoutState;
  private listeners = new Set<() => void>();
  private inFlight = false; // synchronous guard: a second submit while one is running is ignored
  private polling = false;
  private lastPollAt: number | null = null;
  private payPhoneEdited = false;

  constructor(private cfg: CheckoutConfig) {
    const prefillPhone = cfg.prefill?.phone ? cfg.prefill.phone.trim() : "";
    const payPhone = normalizePayerPhone(prefillPhone);
    this.state = {
      phase: cfg.unavailableCode ? "unavailable" : "form",
      form: {
        quantity: 1,
        name: cfg.prefill?.name?.trim() || "",
        phone: prefillPhone,
        email: cfg.prefill?.email?.trim() || "",
        note: "",
        payPhone: /^6\d{8}$/.test(payPhone) ? payPhone : "",
        medium: "mobile money",
      },
      fieldErrors: {},
      error: cfg.unavailableCode ?? null,
      order: null,
      receipt: null,
      expiresAt: null,
      pollFailures: 0,
    };
  }

  getState = (): CheckoutState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<CheckoutState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Edit a field. The payer number follows the contact number until the customer edits it themselves. */
  edit(patch: Partial<FormValues>) {
    const form = { ...this.state.form, ...patch };
    if (patch.payPhone !== undefined) this.payPhoneEdited = true;
    if (patch.phone !== undefined && !this.payPhoneEdited) form.payPhone = patch.phone;
    if (patch.quantity !== undefined) form.quantity = clampQuantity(patch.quantity, this.cfg.maxQuantity);
    const fieldErrors = { ...this.state.fieldErrors };
    for (const k of Object.keys(patch) as FieldName[]) delete fieldErrors[k];
    if (patch.phone !== undefined && !this.payPhoneEdited) delete fieldErrors.payPhone;
    this.set({ form, fieldErrors, error: this.state.phase === "form" ? null : this.state.error });
  }

  /** Create the order (once) and start the payment. Safe against double clicks and repeated calls. */
  async submit(): Promise<void> {
    if (this.inFlight) return;
    const s = this.state;
    if (s.phase !== "form" && s.phase !== "failed" && s.phase !== "expired") return;

    const errors = s.order ? validatePayFields(s.form) : validateForm(this.cfg.productId, s.form, this.cfg.maxQuantity);
    if (Object.keys(errors).length > 0) {
      this.set({ fieldErrors: errors });
      return;
    }

    this.inFlight = true;
    this.set({ phase: "submitting", fieldErrors: {}, error: null });
    try {
      let order = s.order;
      if (!order) {
        const created = await this.cfg.api.createOrder(buildCreateBody(this.cfg.productId, s.form));
        if (!created.ok) return this.failCreate(created.code);
        order = created.data;
        this.set({ order });
        this.cfg.onOrderChange?.(order.id);
      }
      const started = await this.cfg.api.pay(order.id, buildPayBody(this.state.form));
      if (!started.ok) return await this.failPay(started.code, order);
      this.set({ phase: "waiting", expiresAt: started.data.expires_at, order: started.data.order, pollFailures: 0 });
    } finally {
      this.inFlight = false;
    }
  }

  /** Retry a payment for the existing order (same as submit; it never creates a second order). */
  retryPayment = () => this.submit();

  private failCreate(code: ClientErrorCode) {
    if (UNAVAILABLE_CODES.has(code)) return this.set({ phase: "unavailable", error: code });
    const fieldErrors: CheckoutState["fieldErrors"] = {};
    if (code === "insufficient_stock" || code === "invalid_quantity" || code === "quantity_exceeds_max") fieldErrors.quantity = code;
    if (code === "invalid_name") fieldErrors.name = code;
    if (code === "invalid_phone") fieldErrors.phone = code;
    if (code === "invalid_email") fieldErrors.email = code;
    this.set({ phase: "form", error: code, fieldErrors });
  }

  private async failPay(code: ClientErrorCode, order: OrderView) {
    switch (code) {
      case "payment_already_pending":
        // A live attempt already exists (double tap, another tab, a refresh): just follow it.
        this.set({ phase: "waiting", error: null, pollFailures: 0 });
        return;
      case "order_expired":
        this.set({ phase: "order_expired", error: code });
        return;
      case "payment_review":
        this.set({ phase: "review", error: code });
        return;
      case "order_not_payable":
        // Probably already paid (e.g. the response of an earlier attempt was lost): ask the backend.
        this.set({ phase: "resuming", error: null });
        await this.refresh(order.id);
        return;
      case "payment_failed":
      case "too_many_payment_attempts":
        this.set({ phase: "failed", error: code });
        return;
      case "invalid_phone":
      case "invalid_payment_medium":
        this.set({ phase: "form", error: code, fieldErrors: { [code === "invalid_phone" ? "payPhone" : "medium"]: code } });
        return;
      default:
        if (UNAVAILABLE_CODES.has(code)) this.set({ phase: "unavailable", error: code });
        else this.set({ phase: "form", error: code }); // e.g. network_error: the order is kept, only payment is retried
    }
  }

  /** One poll of the backend while waiting. Overlapping polls are ignored. */
  async poll(): Promise<void> {
    const s = this.state;
    if (!s.order || (s.phase !== "waiting" && s.phase !== "resuming")) return;
    if (this.polling) return;
    const gap = this.cfg.minPollGapMs ?? 0;
    const nowMs = (this.cfg.nowMs ?? Date.now)();
    // Too soon after the previous check (timer, tab-visible and "check now" can all fire): do nothing.
    if (gap > 0 && this.lastPollAt !== null && nowMs - this.lastPollAt < gap) return;
    this.lastPollAt = nowMs;
    this.polling = true;
    try {
      await this.refresh(s.order.id);
    } finally {
      this.polling = false;
    }
  }

  /** Come back to an existing order (page refresh or a shared ?order= link). */
  async resume(orderId: string): Promise<void> {
    if (!isUuid(orderId)) return;
    this.set({ phase: "resuming", error: null });
    this.lastPollAt = (this.cfg.nowMs ?? Date.now)();
    await this.refresh(orderId, true);
  }

  private async refresh(orderId: string, isResume = false) {
    const r = await this.cfg.api.status(orderId);
    if (!r.ok) {
      if (r.code === "order_not_found") {
        this.cfg.onOrderChange?.(null);
        this.set({ order: null, phase: this.cfg.unavailableCode ? "unavailable" : "form", error: isResume ? null : r.code });
        return;
      }
      // Transient trouble: keep waiting, and only say so after several failures in a row.
      const pollFailures = this.state.pollFailures + 1;
      this.set({ pollFailures, error: pollFailures >= MAX_POLL_FAILURES ? "network_error" : this.state.error, phase: this.state.phase === "resuming" && !this.state.order ? "form" : this.state.phase });
      return;
    }
    const v = r.data;
    const order = v.order as OrderView;
    switch (v.status) {
      case "succeeded":
        this.set({ phase: "success", receipt: v, order, error: null, pollFailures: 0 });
        return;
      case "pending":
        this.set({ phase: "waiting", order, expiresAt: v.expires_at ?? this.state.expiresAt, error: null, pollFailures: 0 });
        return;
      case "failed":
        this.set({ phase: "failed", order, error: "payment_failed", pollFailures: 0 });
        return;
      case "expired":
        this.set(v.code === "order_expired" ? { phase: "order_expired", order, error: "order_expired" } : { phase: "expired", order, error: "payment_expired" });
        return;
      case "review":
        this.set({ phase: "review", order, error: "payment_review" });
        return;
      default: // not_started — the order exists, payment hasn't been started (or was never confirmed)
        this.set({ phase: "form", order, error: null });
    }
  }

  /** Abandon the current order in the UI and begin again from the form. */
  startOver() {
    this.cfg.onOrderChange?.(null);
    this.payPhoneEdited = false;
    this.set({
      phase: this.cfg.unavailableCode ? "unavailable" : "form",
      order: null,
      receipt: null,
      expiresAt: null,
      error: this.cfg.unavailableCode ?? null,
      fieldErrors: {},
      pollFailures: 0,
    });
  }
}
