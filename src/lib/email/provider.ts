// A small, deliberately swappable email adapter — see supabase/migrations/
// 2026-09-19_community_system.sql's header and the Community feature's
// implementation plan for why. Every caller (the announcement-send route,
// the product-notify route) only ever talks to `sendEmail()` below, never
// to a provider's SDK directly — replacing the vendor later means editing
// only this one file.
//
// Reference implementation: Resend (https://resend.com), called with a
// plain `fetch` rather than their SDK, so adding this capability doesn't
// pull in a new npm dependency. Nothing sends until BOTH of these are set
// in the environment (never hardcoded, never sent to the browser):
//
//   RESEND_API_KEY       — from your Resend dashboard (API Keys)
//   COMMUNITY_EMAIL_FROM — a sender address on a domain verified with
//                          Resend, e.g. "updates@yourdomain.com"
//
// Until both are set, every call below resolves with
// `{ ok: false, error: "provider_not_configured" }` — callers must record
// that as a real failure (see community_delivery_logs), never report a
// message as sent when it wasn't.
//
// Server-only — never import this from a "use client" component. The API
// key must never reach the browser.

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  // Lets a subscriber's reply land in the creator's own inbox instead of
  // a Ringo-operated address, without exposing the creator's real address
  // as the visible "From" (which stays a Ringo-controlled, deliverability-
  // safe domain).
  replyTo?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export function isEmailProviderConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.COMMUNITY_EMAIL_FROM;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.COMMUNITY_EMAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, error: "provider_not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, error: body?.message || `provider_error_${res.status}` };
    }

    const data = await res.json().catch(() => null);
    return { ok: true, providerMessageId: data?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || "provider_request_failed" };
  }
}
