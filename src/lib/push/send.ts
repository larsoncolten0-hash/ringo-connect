import { deliverToSubscription, type PushPayload, type PushSubscriptionRow } from "./webpush";

// The public push API — one function per audience, mirroring
// src/lib/email/send*.ts's "one small function per notification, called
// directly from the write site" pattern, just fanned out over however
// many devices/browsers that recipient has subscribed from.
//
// Every exported function here is fire-and-forget safe: it never throws,
// so every call site below can just `await sendPushToX(...)` with no
// try/catch of its own — a small improvement over the email pattern,
// where remembering the try/catch is left to each caller. This also
// means a call site keeps working exactly as before even before the
// 2026-09-26_push_notifications.sql migration has been applied (the
// underlying select/insert calls just come back empty/no-op instead of
// throwing).
//
// `admin` is always the service-role client (src/lib/supabase/server.ts's
// createAdminClient()) — every owner kind here (user_id, subscriber_id,
// order_id) is looked up server-side, same reasoning every other
// cross-cutting sender in this app already uses the admin client for.

export type { PushPayload };

// Attempts delivery to every given subscription, deletes any the push
// service reports as permanently gone (404/410 — no separate cleanup job
// needed), and writes exactly one push_delivery_logs row per (owner) —
// not per device — so the log reads as "did this person get notified,"
// not "how many of their devices got a copy." Named push_delivery_logs,
// not the generic "notifications" — see the migration's own header for
// why (a differently-shaped table by that name already existed
// elsewhere in the live schema).
async function deliverAndLog(
  admin: any,
  subs: PushSubscriptionRow[],
  payload: PushPayload,
  owner: { user_id?: string; subscriber_id?: string; order_id?: string }
): Promise<boolean> {
  if (subs.length === 0) return false;

  const results = await Promise.all(subs.map((sub) => deliverToSubscription(sub, payload)));

  const goneIds = subs.filter((_, i) => results[i].gone).map((s) => s.id);
  if (goneIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", goneIds);
  }

  const delivered = results.some((r) => r.ok);
  const error = delivered ? null : Array.from(new Set(results.map((r) => r.error).filter(Boolean))).join("; ") || null;

  await admin.from("push_delivery_logs").insert({
    user_id: owner.user_id ?? null,
    subscriber_id: owner.subscriber_id ?? null,
    order_id: owner.order_id ?? null,
    category: payload.category,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    data: payload.data ?? null,
    delivered,
    error,
  });

  return delivered;
}

// Groups a flat list of subscription rows (each carrying its own owner
// column) by that owner id, so a multi-recipient send still logs one
// push_delivery_logs row per recipient rather than per device.
function groupByOwner(subs: any[], ownerColumn: "user_id" | "subscriber_id" | "order_id"): Map<string, PushSubscriptionRow[]> {
  const map = new Map<string, PushSubscriptionRow[]>();
  for (const sub of subs) {
    const ownerId = sub[ownerColumn];
    const list = map.get(ownerId) || [];
    list.push(sub);
    map.set(ownerId, list);
  }
  return map;
}

// Creators and admins are both just `users` rows — this one function
// covers both single- and multi-recipient sends to that audience.
export async function sendPushToUsers(admin: any, userIds: (string | null | undefined)[], payload: PushPayload): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return;

  try {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .in("user_id", ids);

    const byUser = groupByOwner((subs as any[]) || [], "user_id");
    await Promise.all(Array.from(byUser.entries()).map(([userId, userSubs]) => deliverAndLog(admin, userSubs, payload, { user_id: userId })));
  } catch (err) {
    console.error("sendPushToUsers failed:", err);
  }
}

export async function sendPushToUser(admin: any, userId: string | null | undefined, payload: PushPayload): Promise<void> {
  await sendPushToUsers(admin, [userId], payload);
}

// Every admin (users.role = 'admin') — the super admin dashboard's
// notification audience.
export async function sendPushToAdmins(admin: any, payload: PushPayload): Promise<void> {
  try {
    const { data: admins } = await admin.from("users").select("id").eq("role", "admin");
    await sendPushToUsers(admin, (admins || []).map((a: any) => a.id), payload);
  } catch (err) {
    console.error("sendPushToAdmins failed:", err);
  }
}

// A fan — a community_subscribers row, identified server-side by its own
// id (routes resolve the subscriber's unsubscribe_token to this id first,
// same as every other community route). Returns whether it actually
// delivered (not just "no subscription to try") — sendAnnouncementToSubscribers
// uses this to decide whether to log a community_delivery_logs 'sent' row,
// same idempotency reasoning that table's unique constraint already
// exists for on the email channel.
export async function sendPushToSubscriber(admin: any, subscriberId: string | null | undefined, payload: PushPayload): Promise<boolean> {
  if (!subscriberId) return false;
  try {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("subscriber_id", subscriberId);
    return await deliverAndLog(admin, (subs as any[]) || [], payload, { subscriber_id: subscriberId });
  } catch (err) {
    console.error(`sendPushToSubscriber failed for subscriber ${subscriberId}:`, err);
    return false;
  }
}

// A guest restaurant customer tracking one specific order — no account,
// no community_subscribers row, just the order's own id as the identity
// (same "the UUID is the access control" reasoning as GET /api/orders/[id]).
export async function sendPushToOrderWatcher(admin: any, orderId: string | null | undefined, payload: PushPayload): Promise<void> {
  if (!orderId) return;
  try {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("order_id", orderId);
    await deliverAndLog(admin, (subs as any[]) || [], payload, { order_id: orderId });
  } catch (err) {
    console.error(`sendPushToOrderWatcher failed for order ${orderId}:`, err);
  }
}

// Platform-wide broadcasts — used once, by the admin broadcast tool (see
// /api/admin/broadcast). Every fan across every creator, or every
// creator/admin, respectively.
export async function sendPushToAllSubscribers(admin: any, payload: PushPayload): Promise<void> {
  try {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, subscriber_id")
      .not("subscriber_id", "is", null);
    const bySubscriber = groupByOwner((subs as any[]) || [], "subscriber_id");
    await Promise.all(
      Array.from(bySubscriber.entries()).map(([subscriberId, s]) => deliverAndLog(admin, s, payload, { subscriber_id: subscriberId }))
    );
  } catch (err) {
    console.error("sendPushToAllSubscribers failed:", err);
  }
}

export async function sendPushToAllUsers(admin: any, payload: PushPayload): Promise<void> {
  try {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .not("user_id", "is", null);
    const byUser = groupByOwner((subs as any[]) || [], "user_id");
    await Promise.all(Array.from(byUser.entries()).map(([userId, s]) => deliverAndLog(admin, s, payload, { user_id: userId })));
  } catch (err) {
    console.error("sendPushToAllUsers failed:", err);
  }
}
