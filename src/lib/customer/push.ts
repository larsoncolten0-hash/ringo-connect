import { createAdminClient } from "@/lib/supabase/server";
import { deliverToSubscription, type PushPayload } from "@/lib/push/webpush";

// FOUNDATION for customer notifications: fan a payload out to every device a
// Ringo customer has enabled notifications on (customer_push_subscriptions),
// reusing the existing web-push transport (deliverToSubscription) and
// pruning subscriptions the push service reports as permanently gone.
//
// Deliberately separate from src/lib/push/send.ts — the legacy creator/admin/
// fan senders and the push_subscriptions table are untouched. No product
// event calls this yet (see the phase notes): it exists so each future
// producer (music/order/booking/ticket updates, messages) is a one-line call
// rather than new push plumbing. Never throws; returns whether any device
// accepted the message.
export async function sendPushToCustomer(customerId: string, payload: PushPayload): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("customer_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("customer_id", customerId);
    if (!subs || subs.length === 0) return false;

    const results = await Promise.all(subs.map((s: any) => deliverToSubscription(s, payload)));
    const goneIds = subs.filter((_: any, i: number) => results[i].gone).map((s: any) => s.id);
    if (goneIds.length > 0) await admin.from("customer_push_subscriptions").delete().in("id", goneIds);
    return results.some((r) => r.ok);
  } catch (err) {
    console.error("sendPushToCustomer failed:", err);
    return false;
  }
}
