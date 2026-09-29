import { createAdminClient } from "@/lib/supabase/server";
import type { AiWorkspace } from "@/lib/ai/types";
import { sendAnnouncementToSubscribers } from "@/lib/community/send";
import { getOwnItem } from "./store";

// Publishing a calendar item to the Ringo Community reuses the EXISTING
// mechanism end to end — the same community_announcements table and the
// same sendAnnouncementToSubscribers() fan-out function the owner's own
// manual "Send Announcement" composer already uses
// (src/app/api/community/announcements/[id]/send/route.ts) — never a
// second posting/fan-out path, per the product spec.

export type PublishResult = { ok: true; communityPostId: string } | { ok: false; reason: "not_found" | "already_published" | "not_publishable" | "send_failed" };

const NOTIFICATION_CATEGORY: Record<string, string> = {
  event: "event",
  product: "product",
  promotion: "product",
  music: "music",
};

export async function publishCalendarItem(workspace: AiWorkspace, itemId: string): Promise<PublishResult> {
  const item = await getOwnItem(workspace, itemId);
  if (!item) return { ok: false, reason: "not_found" };
  if (item.status === "published") return { ok: false, reason: "already_published" };
  if (item.status === "cancelled" || item.status === "skipped") return { ok: false, reason: "not_publishable" };

  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("*").eq("id", workspace.profileId).single();
  if (!profile) return { ok: false, reason: "not_found" };

  const { data: announcement, error: insertError } = await db
    .from("community_announcements")
    .insert({
      profile_id: workspace.profileId,
      title: item.title || item.content.slice(0, 80),
      message: item.content,
      image_url: item.image_url,
      link_type: item.link_type,
      link_ref_id: item.link_ref_id,
      notification_category: NOTIFICATION_CATEGORY[item.content_type] || "announcement",
      status: "sending",
    })
    .select("*")
    .single();
  if (insertError || !announcement) {
    console.error("publishCalendarItem: announcement insert failed:", insertError?.message);
    return { ok: false, reason: "send_failed" };
  }

  const { recipientCount, sentCount, failedCount, emailChannel } = await sendAnnouncementToSubscribers(db, announcement, profile);
  const finalStatus = emailChannel && recipientCount > 0 && sentCount === 0 ? "failed" : "sent";
  await db
    .from("community_announcements")
    .update({ status: finalStatus, recipient_count: recipientCount, sent_count: sentCount, failed_count: failedCount, sent_at: new Date().toISOString() })
    .eq("id", announcement.id);

  await db
    .from("content_calendar_items")
    .update({ status: "published", published_at: new Date().toISOString(), community_post_id: announcement.id, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  return { ok: true, communityPostId: announcement.id };
}
