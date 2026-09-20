import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToCustomer } from "@/lib/customer/push";
import type { PushPayload } from "@/lib/push/webpush";

// The My Ringo notification inbox (customer_notifications) and the single entry point for
// notifying a customer: store it (so it is still in the bell if the push is swiped away) AND
// push it to their devices, with the current unread count as the app-icon badge number.
//
// `customerId` must always be an id the SERVER resolved. Never throws: a failure to store
// never blocks the push, and a failed push never removes the stored row.

export type InboxItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  url: string | null;
  readAt: string | null;
  createdAt: string;
  sender: { name: string; avatarUrl: string | null } | null;
};

export async function countUnread(customerId: string): Promise<number> {
  try {
    const { count, error } = await createAdminClient()
      .from("customer_notifications")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .is("read_at", null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Store the notification, then push it. Returns whether any device accepted the push. */
export async function notifyCustomer(customerId: string, payload: PushPayload, options: { profileId?: string | null } = {}): Promise<boolean> {
  let badgeCount: number | undefined;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("customer_notifications").insert({
      customer_id: customerId,
      profile_id: options.profileId ?? null,
      category: payload.category.slice(0, 60),
      title: payload.title.slice(0, 300),
      body: payload.body ? payload.body.slice(0, 1500) : null,
      url: payload.url ? payload.url.slice(0, 2000) : null,
    });
    if (error) console.error("customer_notifications insert failed:", error.message);
    else badgeCount = await countUnread(customerId);
  } catch (err) {
    console.error("customer_notifications insert failed:", err);
  }
  return sendPushToCustomer(customerId, badgeCount === undefined ? payload : { ...payload, badgeCount });
}

export async function listInbox(customerId: string, limit = 30): Promise<InboxItem[]> {
  const { data, error } = await createAdminClient()
    .from("customer_notifications")
    .select("id, category, title, body, url, read_at, created_at, profiles(name, username, avatar_url)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listInbox failed:", error.message);
    return [];
  }
  return (data || []).map((row: any) => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body ?? null,
      url: row.url ?? null,
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
      sender: p ? { name: p.name || p.username, avatarUrl: p.avatar_url ?? null } : null,
    };
  });
}
