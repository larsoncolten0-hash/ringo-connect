// The one place that decides "did this signup request's online payment go through?"
//
// Before this module the ONLY thing that ever flipped signup_requests.customer_paid was the
// customer's own browser polling /pay-status. If the browser stopped (the phone backgrounded
// the tab while the customer approved in the MoMo app, the tab was discarded, the connection
// dropped, or the 2-minute polling window ran out before a slow approval) the customer was
// charged and the system never found out — an admin then had to record it as "paid cash".
//
// Now every way of noticing the payment funnels through here, so they all behave identically
// and every side effect (admin/referrer notification, emails, the Ambassador sale lock)
// happens EXACTLY ONCE no matter which path notices first:
//   * the customer's poll        (/api/signup-requests/[id]/pay-status)
//   * Fapshi's webhook           (/api/billing/fapshi/webhook, matched by userId/externalId)
//   * the safety-net cron        (/api/cron/reconcile-signup-payments)
//   * the admin's own screens    (the requests list and a request's page confirm before rendering)
//
// Never trusts anything a client or webhook body claims: status is always re-read from
// Fapshi's own API with our credentials.
import { fapshiGetStatus, type FapshiStatus, type FapshiTransaction } from "@/lib/fapshi";
import { notifyAdmins, notifyUser, getSignupRequestReviewers } from "@/lib/notifications";
import { emailShell } from "@/lib/email/emailShell";
import { sendEmail } from "@/lib/email/provider";
import { notifySaleConfirmed } from "@/lib/ambassador/notifications";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const EXTERNAL_ID_RE = new RegExp(`^signup-(${UUID})(?:-|$)`, "i");

// ---------------------------------------------------------------------------- what is owed

/** What this request owes, from its OWN stored selections — never from the client. */
export async function computeSignupAmount(
  admin: any,
  request: { requested_plan_id?: string | null; requested_interval?: string | null; requested_addon_ids?: string[] | null }
): Promise<{ ok: true; amount: number; planName: string | null } | { ok: false; code: "plan_not_found" | "nothing_to_pay" }> {
  let plan: { price_xaf: number; price_xaf_yearly: number; name: string } | null = null;
  if (request.requested_plan_id) {
    const { data } = await admin.from("plans").select("price_xaf, price_xaf_yearly, name").eq("id", request.requested_plan_id).single();
    if (!data) return { ok: false, code: "plan_not_found" };
    plan = data;
  }
  let amount = plan ? (request.requested_interval === "yearly" ? Number(plan.price_xaf_yearly) : Number(plan.price_xaf)) : 0;
  const addonIds: string[] = request.requested_addon_ids || [];
  if (addonIds.length > 0) {
    const { data: addons } = await admin.from("addons").select("price_xaf").in("id", addonIds);
    amount += (addons || []).reduce((sum: number, a: any) => sum + Number(a.price_xaf), 0);
  }
  // Fapshi charges whole XAF. Prices are whole numbers; rounding only protects against a
  // stray decimal turning into a rejected payment.
  amount = Math.round(amount);
  if (!(amount > 0)) return { ok: false, code: "nothing_to_pay" };
  return { ok: true, amount, planName: plan?.name ?? null };
}

// ---------------------------------------------------------------------------- side effects (once)

async function notifySignupPaid(admin: any, request: { id: string; full_name: string; email: string | null; referral_code: string | null }) {
  // Best-effort: a payment already succeeded, nothing here may turn that into an error.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const { adminEmails, superCreator } = await getSignupRequestReviewers(request.referral_code);

  await Promise.allSettled([
    // Ambassador Program — lock any attributed sale's team/ambassador snapshot the instant
    // payment is confirmed. A no-op when there is no attribution; ambassador_lock_sale() has
    // its own `WHERE status = 'attributed'` guard as a second layer of idempotency.
    (async () => {
      const { data: lockResult, error: lockError } = await admin.rpc("ambassador_lock_sale", { p_signup_request_id: request.id });
      if (lockError) console.error("ambassador_lock_sale failed:", lockError.message);
      else if (lockResult?.ok && lockResult.sale_id) await notifySaleConfirmed(admin, lockResult.sale_id);
    })(),
    notifyAdmins({ type: "signup_request_paid", title: `Payment received — ${request.full_name}`, body: "Ready to review and approve.", link: `/admin/requests/${request.id}` }),
    superCreator
      ? notifyUser(superCreator.id, { type: "signup_request_paid", title: `Payment received — ${request.full_name}`, body: "Ready to review and approve.", link: `/dashboard/requests/${request.id}` })
      : Promise.resolve(),
    adminEmails.length > 0
      ? sendEmail({
          to: adminEmails,
          subject: `Payment received — ${request.full_name}`,
          html: emailShell(`
                <p style="font-size:14px; margin:0 0 16px;"><strong>${request.full_name}</strong> just completed their purchase at signup — ready for you to review and approve.</p>
                <a href="${siteUrl}/admin/requests/${request.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
              `),
          log: { emailType: "signup_request_paid_admin", resourceType: "signup_request", resourceId: request.id },
        })
      : Promise.resolve(),
    superCreator?.email
      ? sendEmail({
          to: superCreator.email,
          subject: `Payment received — ${request.full_name}`,
          html: emailShell(`
                <p style="font-size:14px; margin:0 0 16px;"><strong>${request.full_name}</strong> (from your affiliate link) just completed their purchase — ready for you to review and approve.</p>
                <a href="${siteUrl}/dashboard/requests/${request.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
              `),
          log: { emailType: "signup_request_paid_referrer", resourceType: "signup_request", resourceId: request.id },
        })
      : Promise.resolve(),
    request.email
      ? sendEmail({
          to: request.email,
          subject: "Payment received — Ringo Connect",
          html: emailShell(`
                <p style="font-size:14px; margin:0 0 12px;">Hi ${request.full_name},</p>
                <p style="font-size:14px; margin:0;">We've received your payment. Your page is now waiting on final approval — we'll email you again as soon as it's live.</p>
              `),
          log: { emailType: "signup_request_payment_received", resourceType: "signup_request", resourceId: request.id },
        })
      : Promise.resolve(),
  ]);
}

/** Atomically marks the request paid and records WHICH transaction paid it (that id is what
 *  the approve route re-verifies with Fapshi). Returns true only for the single caller that
 *  actually made the change — so the notifications fire once. */
async function markSignupPaid(admin: any, request: { id: string; full_name: string; email: string | null; referral_code: string | null }, transId: string): Promise<boolean> {
  const { data: updated } = await admin
    .from("signup_requests")
    .update({ customer_paid: true, pending_fapshi_trans_id: transId })
    .eq("id", request.id)
    .eq("customer_paid", false)
    .select("id");
  const justPaid = (updated?.length ?? 0) > 0;
  if (justPaid) await notifySignupPaid(admin, request);
  return justPaid;
}

// ---------------------------------------------------------------------------- confirm by request

export interface SignupPaymentCheck {
  found: boolean;
  /** A payment has been started for this request (there is a transaction to look at). */
  started: boolean;
  paid: boolean;
  status: FapshiStatus | null;
  transId: string | null;
  reason: string | null;
  justPaid: boolean;
}

const NONE: SignupPaymentCheck = { found: false, started: false, paid: false, status: null, transId: null, reason: null, justPaid: false };

/** Looks at Fapshi and, if the payment succeeded, records it. Idempotent and safe to call from
 *  anywhere, any number of times. THROWS if Fapshi cannot be reached (after the client's own
 *  retries) — callers decide how to present that; nothing is changed in that case. */
export async function confirmSignupPayment(admin: any, requestId: string): Promise<SignupPaymentCheck> {
  const { data: request } = await admin
    .from("signup_requests")
    .select("id, pending_fapshi_trans_id, customer_paid, full_name, email, referral_code")
    .eq("id", requestId)
    .single();
  if (!request) return NONE;

  // Already recorded (by any path): nothing to ask Fapshi, and nothing more to do.
  if (request.customer_paid) {
    return { found: true, started: true, paid: true, status: "SUCCESSFUL", transId: request.pending_fapshi_trans_id ?? null, reason: null, justPaid: false };
  }
  if (!request.pending_fapshi_trans_id) return { ...NONE, found: true };

  const tx = await fapshiGetStatus(request.pending_fapshi_trans_id);
  if (tx.status === "SUCCESSFUL") {
    const justPaid = await markSignupPaid(admin, request, request.pending_fapshi_trans_id);
    return { found: true, started: true, paid: true, status: "SUCCESSFUL", transId: request.pending_fapshi_trans_id, reason: null, justPaid };
  }
  return { found: true, started: true, paid: false, status: tx.status, transId: request.pending_fapshi_trans_id, reason: tx.reason || null, justPaid: false };
}

// ---------------------------------------------------------------------------- confirm by transaction (webhook)

/** The signup request a Fapshi transaction belongs to, from what WE put on it when creating
 *  it: userId = the request's id, externalId = "signup-<id>-<attempt>". Works even when the
 *  transaction id was never stored on the request or was overwritten by a retry. */
export function signupRequestIdFromTransaction(tx: Pick<FapshiTransaction, "userId" | "externalId">): string | null {
  if (tx.userId && UUID_RE.test(tx.userId)) return tx.userId.toLowerCase();
  const m = tx.externalId ? EXTERNAL_ID_RE.exec(tx.externalId) : null;
  return m ? m[1].toLowerCase() : null;
}

/** For a transaction Fapshi's OWN API just reported (never a webhook body): if it is a
 *  successful collection that belongs to a still-pending signup request, record it. */
export async function confirmSignupPaymentFromTransaction(admin: any, tx: FapshiTransaction): Promise<{ matched: boolean; justPaid: boolean }> {
  if (tx.status !== "SUCCESSFUL" || tx.transType === "Payout") return { matched: false, justPaid: false };
  const requestId = signupRequestIdFromTransaction(tx);
  if (!requestId) return { matched: false, justPaid: false };
  const { data: request } = await admin.from("signup_requests").select("id, status, customer_paid, full_name, email, referral_code").eq("id", requestId).maybeSingle();
  if (!request || request.status !== "pending") return { matched: false, justPaid: false };
  if (request.customer_paid) return { matched: true, justPaid: false };
  const justPaid = await markSignupPaid(admin, request, tx.transId);
  return { matched: true, justPaid };
}

// ---------------------------------------------------------------------------- sweep

export const SIGNUP_RECONCILE_DEFAULT_LIMIT = 40;
export const SIGNUP_RECONCILE_WINDOW_DAYS = 3;
const CONCURRENCY = 5;

/** Confirms every recent, still-pending, not-yet-paid request that has a payment in flight.
 *  Bounded, idempotent, one failing request never stops the rest. Pass `ids` to restrict it to
 *  specific requests (the admin list does this for the rows on screen). */
export async function reconcileSignupPayments(
  admin: any,
  { limit = SIGNUP_RECONCILE_DEFAULT_LIMIT, days = SIGNUP_RECONCILE_WINDOW_DAYS, now = new Date(), ids }: { limit?: number; days?: number; now?: Date; ids?: string[] } = {}
): Promise<{ checked: number; paid: number; errors: number }> {
  let query = admin
    .from("signup_requests")
    .select("id")
    .eq("status", "pending")
    .eq("customer_paid", false)
    .not("pending_fapshi_trans_id", "is", null)
    .gte("created_at", new Date(now.getTime() - days * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (ids) query = query.in("id", ids);
  const { data } = await query;
  const rows: { id: string }[] = data || [];

  const out = { checked: rows.length, paid: 0, errors: 0 };
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (row) => {
        try {
          const r = await confirmSignupPayment(admin, row.id);
          if (r.paid) out.paid++;
        } catch (err: any) {
          out.errors++;
          console.error("signup payment reconcile failed for", row.id, err?.message);
        }
      })
    );
  }
  return out;
}
