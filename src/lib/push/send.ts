import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";

// Server-side Web Push sending — the other half of src/lib/push/client.ts
// and public/pwa-sw.js's `push` handler. Every call site (payment
// webhooks, signup confirmation, payout requests — see the callers of
// notifyAdmins below) treats this as fire-and-forget: a push failing must
// never break the real action it's reporting on, so every exported
// function swallows its own errors instead of throwing.

let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  // A valid contact URI is required by the Web Push protocol (it's how a
  // push service can reach the sender about a misbehaving app) — not used
  // for anything else here.
  const subject = process.env.VAPID_SUBJECT || "mailto:support@ringoconnectltd.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

// Whether push is set up at all — checked so every caller can skip the
// work (and the DB round-trip) entirely on a deployment that hasn't
// generated/configured VAPID keys yet, the same "safe to leave blank
// until then" pattern SETTINGS_ENCRYPTION_KEY and the email provider use
// (see .env.example).
export function isPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export type PushPayload = {
  title: string;
  body: string;
  // Path to focus/open when the notification is tapped — see
  // notificationclick in public/pwa-sw.js. Defaults to "/" there.
  url?: string;
};

async function sendToRow(
  admin: ReturnType<typeof createAdminClient>,
  row: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload)
    );
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      // The push service itself says this endpoint is gone (browser
      // uninstalled, permission revoked, storage cleared, etc.) — clean
      // it up so future sends don't keep paying for a dead endpoint.
      await admin.from("push_subscriptions").delete().eq("id", row.id);
    } else {
      console.error("Push send failed:", err?.message || err);
    }
  }
}

// Sends to every subscribed device of every listed user. Never throws —
// see the module comment above.
export async function sendPushToUserIds(userIds: string[], payload: PushPayload): Promise<void> {
  if (!isPushConfigured() || userIds.length === 0) return;

  try {
    ensureVapidConfigured();
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    await Promise.all((subs || []).map((row) => sendToRow(admin, row, payload)));
  } catch (err: any) {
    console.error("sendPushToUserIds failed:", err?.message || err);
  }
}

// Notifies every admin (users.role = 'admin') — the recipient for every
// operational event this app currently pushes: new signups, subscription
// payments, and payout requests. A given deployment may have more than
// one admin account; all of them, on all of their subscribed devices,
// get the notification.
export async function notifyAdmins(payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;

  try {
    const admin = createAdminClient();
    const { data: admins } = await admin.from("users").select("id").eq("role", "admin");
    const ids = (admins || []).map((a) => a.id);
    await sendPushToUserIds(ids, payload);
  } catch (err: any) {
    console.error("notifyAdmins failed:", err?.message || err);
  }
}
