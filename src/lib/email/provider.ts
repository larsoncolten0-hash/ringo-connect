import { createAdminClient } from "@/lib/supabase/server";

// The one, single email adapter for the whole app — every transactional
// and marketing sender (order/ticket/booking receipts, admin/payment
// notices, community announcements) calls `sendEmail()` here, never a
// provider SDK directly. Previously there were two of these
// (src/lib/email.ts, now retired) with two different from-address
// conventions; this is the survivor. See supabase/migrations/
// 2026-09-30_email_delivery_logs.sql for the delivery-log/suppression
// tables this file writes to.
//
// Reference implementation: Resend (https://resend.com), called with a
// plain `fetch` rather than their SDK, so adding this capability doesn't
// pull in a new npm dependency. Nothing sends until BOTH of these are set
// in the environment (never hardcoded, never sent to the browser):
//
//   RESEND_API_KEY      — from your Resend dashboard (API Keys)
//   RESEND_FROM_EMAIL    — a sender address on a domain verified with
//                          Resend, e.g. "notifications@yourdomain.com"
//                          (COMMUNITY_EMAIL_FROM is accepted as a legacy
//                          alias — see resolveFromAddress below)
//
// Until both are set, every call below resolves with
// `{ ok: false, error: "provider_not_configured" }` and sends nothing —
// this deliberately never falls back to a Resend sandbox sender
// (onboarding@resend.dev). A sandbox sender gets none of a verified
// domain's SPF/DKIM, and Resend restricts it to test recipients on a live
// account anyway — silently using it for a real signup/payment email
// would look like success while quietly not reaching the customer.
// Callers must treat `{ ok: false }` as a real failure, never report a
// message as sent when it wasn't.
//
// Server-only — never import this from a "use client" component. The API
// key must never reach the browser.

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  // Lets a reply land in the relevant business/creator's own inbox
  // instead of a Ringo-operated address, without exposing their real
  // address as the visible "From" (which stays the verified Ringo
  // domain). Omit when no appropriate contact address exists — never
  // invented.
  replyTo?: string | null;
  // Opt-in structured delivery logging (PHASE 3) — when provided, this
  // send is recorded in email_delivery_logs, one row per recipient. Omit
  // for a caller that already logs itself elsewhere (community/send.ts
  // uses community_delivery_logs, with its own richer subscriber/
  // announcement relations) — passing both would double-log the same
  // send, which is exactly the duplicate infrastructure this was told
  // not to create.
  log?: {
    emailType: string; // e.g. "restaurant_order_receipt", "signup_approved"
    resourceType?: string | null; // e.g. "order", "booking", "signup_request"
    resourceId?: string | null;
  };
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

// Accepts COMMUNITY_EMAIL_FROM as a legacy alias for RESEND_FROM_EMAIL —
// this adapter now sends every kind of Ringo email, not just Community's,
// so RESEND_FROM_EMAIL is the canonical name going forward; the older
// name is only still read here so an existing deployment that has it set
// keeps working unchanged after this migration, with nothing to
// reconfigure. New setups should only ever need RESEND_FROM_EMAIL — see
// .env.example.
function resolveFromAddress(): string | undefined {
  return process.env.RESEND_FROM_EMAIL || process.env.COMMUNITY_EMAIL_FROM;
}

export function isEmailProviderConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!resolveFromAddress();
}

async function getSuppressedAddresses(admin: ReturnType<typeof createAdminClient>, addresses: string[]): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  try {
    const { data } = await admin.from("email_suppressions").select("email").in("email", addresses);
    return new Set((data || []).map((r: any) => String(r.email).toLowerCase()));
  } catch {
    // A failed suppression check must never block a real send — treat as
    // "nothing known to be suppressed" and let the provider be the final
    // word, same fail-open posture the rest of this function uses for
    // logging.
    return new Set();
  }
}

async function logDelivery(
  admin: ReturnType<typeof createAdminClient>,
  log: NonNullable<SendEmailInput["log"]>,
  recipients: string[],
  result: SendEmailResult,
  suppressedRecipients: string[] = []
) {
  try {
    const rows = [
      ...recipients.map((r) => ({
        email_type: log.emailType,
        resource_type: log.resourceType ?? null,
        resource_id: log.resourceId ?? null,
        recipient_email: r,
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.providerMessageId ?? null,
        error: result.ok ? null : result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
      })),
      ...suppressedRecipients.map((r) => ({
        email_type: log.emailType,
        resource_type: log.resourceType ?? null,
        resource_id: log.resourceId ?? null,
        recipient_email: r,
        status: "failed" as const,
        provider_message_id: null,
        error: "suppressed",
        sent_at: null,
      })),
    ];
    if (rows.length > 0) await admin.from("email_delivery_logs").insert(rows);
  } catch (err) {
    // Logging is observability, not the transaction — a failure here must
    // never affect the send result already computed and returned to the
    // caller (see PHASE 3's own "a failed email must not corrupt or
    // reverse a successful order/payment/ticket" — the inverse holds too:
    // a failed LOG must never look like a failed SEND).
    console.error("email delivery logging failed:", err);
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = resolveFromAddress();

  const admin = createAdminClient();
  const requestedRecipients = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean);

  if (!apiKey || !from) {
    const result: SendEmailResult = { ok: false, error: "provider_not_configured" };
    if (input.log) await logDelivery(admin, input.log, requestedRecipients, result);
    return result;
  }

  // PHASE 4 groundwork made active: an address that has bounced or
  // complained is never re-attempted — see email_suppressions in
  // 2026-09-30_email_delivery_logs.sql, populated by the Resend webhook.
  // Checked here, in the one shared choke point, so every caller (this
  // includes community/send.ts's marketing sends, not just the newly-
  // logged transactional callers) gets this for free.
  const suppressed = await getSuppressedAddresses(admin, requestedRecipients);
  const to = requestedRecipients.filter((r) => !suppressed.has(r.toLowerCase()));
  const suppressedRecipients = requestedRecipients.filter((r) => suppressed.has(r.toLowerCase()));

  if (to.length === 0) {
    const result: SendEmailResult = { ok: false, error: "all_recipients_suppressed" };
    if (input.log) await logDelivery(admin, input.log, [], result, suppressedRecipients);
    return result;
  }

  // Resend's own Idempotency-Key (https://resend.com/docs/dashboard/emails/
  // idempotency-keys, kept 24h server-side) — when a resourceId is
  // available, this is what makes the retry loop below actually safe at
  // the provider level, not just "probably fine": a retried request with
  // the same key returns Resend's original response instead of sending a
  // second time, even for the network-error case where the first attempt
  // may have actually gone through and only the response was lost. Built
  // from emailType + resourceId + the exact recipient set (not just
  // resourceId alone) — the same order can legitimately generate several
  // different real emails to different recipients (a receipt to the
  // customer, a notice to the business), which must never share a key or
  // the second one would be silently swallowed as "the same request".
  const idempotencyKey =
    input.log?.resourceId != null ? `${input.log.emailType}:${input.log.resourceId}:${[...to].sort().join(",")}`.slice(0, 256) : null;

  let result: SendEmailResult = { ok: false, error: "provider_request_failed" };
  // Limited, bounded retries (PHASE 7) — only for outcomes an immediate
  // retry can plausibly fix (a network blip, Resend's own 5xx, or a 429
  // rate limit), never for a 4xx like an invalid address or bad API key,
  // where retrying just wastes time repeating the same failure. Short
  // exponential backoff since this runs synchronously inside a request
  // handler — every caller already treats sendEmail() as fire-and-forget
  // (Promise.allSettled), so a little added latency here is invisible to
  // whatever real transaction (an order, a payment) this email is
  // reporting on, which has already completed by the time this runs.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from,
          to,
          subject: input.subject,
          html: input.html,
          // A plain-text alternative alongside the HTML — every current
          // template is well-structured HTML with no text-only fallback
          // at all (PHASE 6), which hurts both accessibility (a text-only
          // client) and spam scoring (a multipart message with no text
          // part is itself a minor signal providers weigh). Stripping
          // tags rather than hand-authoring a second template per email
          // keeps this from becoming a second thing every caller has to
          // maintain.
          text: htmlToPlainText(input.html),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        result = { ok: true, providerMessageId: data?.id };
        break;
      }

      const body = await res.json().catch(() => null);
      result = { ok: false, error: body?.message || `provider_error_${res.status}` };
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    } catch (err: any) {
      result = { ok: false, error: err?.message || "provider_request_failed" };
      if (attempt === MAX_ATTEMPTS) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** (attempt - 1))); // 300ms, 900ms
  }

  if (input.log) await logDelivery(admin, input.log, to, result, suppressedRecipients);

  return result;
}

// A deliberately simple HTML→text reduction (not a full HTML parser) —
// every template this app sends is written by hand here in the codebase,
// not user-supplied, so this only ever has to handle the small set of
// tags those templates actually use.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
