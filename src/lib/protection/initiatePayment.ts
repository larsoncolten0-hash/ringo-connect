// Start a Fapshi payment for an existing, awaiting_payment Ringo Protection transaction. The browser
// supplies only the payer's phone and mobile-money medium; the amount (customer_total, product + fee)
// comes from the protection_transactions snapshot, never the client. One live attempt per
// transaction (enforced by the same one-live-attempt discipline productCheckout uses, backed by a
// partial unique index), a bounded number of attempts, and the provider is only called after our own
// payment row exists.

import { checkProtectionEligibility } from "./checkoutEligibility";
import { fail, ok, type Result } from "./checkoutErrors";
import { MAX_PAYMENT_ATTEMPTS, PAYMENT_WINDOW_MINUTES, PROVIDER } from "./checkoutConstants";
import { withinProtectionLimit } from "./checkoutRateLimit";
import type { PaymentMedium, ProtectionCheckoutDeps, ProtectionPaymentRow } from "./checkoutTypes";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Same normalisation as fapshi.ts's normalizeCameroonPhone / productCheckout's own copy. */
function normalizePayerPhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

function parsePayInput(raw: unknown): { ok: true; value: { phone: string; medium: PaymentMedium } } | { ok: false; code: "invalid_request" | "invalid_payment_medium" | "invalid_phone" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_request" };
  const r = raw as Record<string, unknown>;
  if (r.medium !== "mobile money" && r.medium !== "orange money") return { ok: false, code: "invalid_payment_medium" };
  if (typeof r.phone !== "string") return { ok: false, code: "invalid_phone" };
  const phone = normalizePayerPhone(r.phone);
  if (!/^6\d{8}$/.test(phone)) return { ok: false, code: "invalid_phone" };
  return { ok: true, value: { phone, medium: r.medium } };
}

export interface ProtectionPayStartView {
  status: "pending";
  expires_at: string;
  transactionId: string;
}

const isLive = (p: ProtectionPaymentRow) => p.status === "initiated" || p.status === "pending";

export async function initiateProtectionPayment(
  deps: ProtectionCheckoutDeps,
  transactionId: string,
  raw: unknown,
  ctx: { clientKey?: string | null } = {}
): Promise<Result<ProtectionPayStartView>> {
  if (!isUuid(transactionId)) return fail("transaction_not_found");
  const parsed = parsePayInput(raw);
  if (!parsed.ok) return fail(parsed.code);
  const { phone, medium } = parsed.value;

  const txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return fail("transaction_not_found");
  if (txn.status !== "awaiting_payment") return fail("transaction_not_payable");

  const order = await deps.store.getOrder(txn.target_id);
  if (!order) return fail("order_not_found");

  const now = deps.now();

  const payments = await deps.store.listProtectionPayments(txn.id);
  if (payments.some((p) => p.status === "succeeded")) return fail("transaction_not_payable"); // settlement is catching up

  const live = payments.find(isLive);
  if (live && new Date(live.expires_at).getTime() > now.getTime()) return fail("payment_already_pending");

  // Lazy expiry, mirroring initiateProductPayment: past the reservation clock with nothing live ->
  // move the Protection transaction to `expired` (legal: awaiting_payment -> expired, system actor)
  // and release the order's stock through the SAME existing release_product_order_stock() RPC.
  if (order.status === "awaiting_payment" && new Date(order.expires_at).getTime() <= now.getTime()) {
    if (live) await deps.store.updateProtectionPayment(live.id, { status: "expired" }, ["initiated", "pending"]);
    await deps.transition(txn.id, "expired", { type: "system" });
    await deps.store.releaseOrder(order.id, "expired");
    return fail("order_expired");
  }
  if (order.status !== "awaiting_payment") return fail("order_not_payable");

  const [protection, commerce, profile] = await Promise.all([deps.store.getProtectionSettings(), deps.store.getCommerceSettings(), deps.store.getProfile(order.profile_id)]);
  const blocked = checkProtectionEligibility({ protection, commerce, profile, order });
  if (blocked) return fail(blocked);

  if (payments.length >= MAX_PAYMENT_ATTEMPTS) return fail("too_many_payment_attempts");

  if (!(await withinProtectionLimit(deps.limiter, deps.log, "protection_pay_ip", ctx.clientKey))) return fail("rate_limited");
  if (!(await withinProtectionLimit(deps.limiter, deps.log, "protection_pay_phone", phone))) return fail("rate_limited");
  if (!(await withinProtectionLimit(deps.limiter, deps.log, "protection_pay_phone_day", phone))) return fail("rate_limited");

  if (live) await deps.store.updateProtectionPayment(live.id, { status: "expired" }, ["initiated", "pending"]);

  const paymentId = deps.newId();
  const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
  const row: ProtectionPaymentRow = {
    id: paymentId,
    protection_transaction_id: txn.id,
    provider: PROVIDER,
    provider_transaction_id: null,
    external_id: `pt-${paymentId}`,
    profile_id: txn.profile_id,
    customer_id: txn.customer_id,
    amount: Number(txn.customer_total), // from the snapshot, never the client
    currency: txn.currency,
    payer_medium: medium,
    status: "initiated",
    provider_status: null,
    failure_reason: null,
    expires_at: expiresAt.toISOString(),
    confirmed_at: null,
    created_at: now.toISOString(),
  };
  const inserted = await deps.store.insertProtectionPayment(row);
  if (!inserted.ok) return fail("payment_already_pending"); // lost the one-live-attempt race

  let transId: string;
  try {
    const res = await deps.provider.directPay({
      amount: Number(txn.customer_total),
      phone,
      medium,
      userId: txn.id,
      externalId: row.external_id,
      message: profile?.username ? `Ringo Protection — ${profile.username}` : "Ringo Protection",
    });
    if (!res?.transId) throw new Error("no transaction id returned");
    transId = res.transId;
  } catch (err) {
    deps.log("protection_provider_direct_pay_failed", { transactionId: txn.id, paymentId, error: String((err as Error)?.message || err).slice(0, 160) });
    await deps.store.updateProtectionPayment(paymentId, { status: "failed", failure_reason: "provider_error" }, ["initiated"]);
    return fail("payment_failed");
  }

  await deps.store.updateProtectionPayment(paymentId, { status: "pending", provider_transaction_id: transId, provider_status: "CREATED" }, ["initiated"]);

  if (expiresAt.getTime() > new Date(order.expires_at).getTime()) {
    await deps.store.updateOrder(order.id, { expires_at: expiresAt.toISOString() }, "awaiting_payment");
  }

  return ok({ status: "pending", expires_at: expiresAt.toISOString(), transactionId: txn.id });
}
