import webpush from "web-push";

// The low-level Web Push transport — configures the `web-push` package
// once from VAPID_* env vars (see .env.local's own comment on these) and
// exposes a single `deliverToSubscription` used by every helper in
// send.ts. Same "swappable adapter, one file talks to the vendor"
// reasoning as src/lib/email/provider.ts, just for push instead of email.
//
// Server-only — never import this from a "use client" component. The
// VAPID private key must never reach the browser.

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  category: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

export interface DeliverResult {
  ok: boolean;
  error?: string;
  // A 404/410 from the push service means the browser has permanently
  // dropped this subscription (uninstalled, permission revoked, storage
  // cleared) — the caller should delete the row rather than keep retrying
  // it forever.
  gone?: boolean;
}

// Sends one payload to one subscription. Never throws — every failure
// mode (misconfigured VAPID keys, an expired subscription, a network
// error) comes back as a normal `{ ok: false }` result for the caller to
// log, same posture as sendEmail() in src/lib/email/provider.ts.
export async function deliverToSubscription(sub: PushSubscriptionRow, payload: PushPayload): Promise<DeliverResult> {
  if (!ensureConfigured()) {
    return { ok: false, error: "push_not_configured" };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err: any) {
    const statusCode = err?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { ok: false, error: `gone_${statusCode}`, gone: true };
    }
    return { ok: false, error: err?.message || "push_send_failed" };
  }
}
