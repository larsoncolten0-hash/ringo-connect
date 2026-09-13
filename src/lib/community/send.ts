import { sendEmail } from "@/lib/email/provider";
import { renderAnnouncementEmail } from "@/lib/email/renderAnnouncementEmail";
import { sendPushToSubscriber } from "@/lib/push/send";

// Shared by both send paths — the owner's manual "Send Announcement" and
// the one-shot /api/community/notify product action — so there is exactly
// one place that resolves "who's eligible," sends, and logs. Both callers
// already own the announcement row (verified before this is called) and
// pass the admin client, since this reads across the community_* tables,
// not just the caller's own already-scoped rows.
//
// v1 only ever sends email — WhatsApp is stored in the schema
// (community_subscription_preferences.whatsapp_updates,
// community_announcements.audience 'whatsapp') for a real future
// integration, but is never surfaced as a sendable audience today (see the
// Announcement composer, which only offers "All subscribers"/"Email
// subscribers"). If this is ever called with an announcement whose
// audience somehow resolves to whatsapp-only, it sends to nobody rather
// than pretending to.
const NOTIFY_COLUMN: Record<string, string> = {
  announcement: "notify_announcements",
  product: "notify_products",
  music: "notify_music",
  event: "notify_events",
  offer: "notify_offers",
};

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
}

export async function sendAnnouncementToSubscribers(
  admin: any,
  announcement: any,
  profile: any
): Promise<{ recipientCount: number; sentCount: number; failedCount: number }> {
  const notifyColumn = NOTIFY_COLUMN[announcement.notification_category] || "notify_announcements";

  if (announcement.audience === "whatsapp") {
    // No real WhatsApp send infra — never silently "succeed" here.
    return { recipientCount: 0, sentCount: 0, failedCount: 0 };
  }

  const { data: subscribers } = await admin
    .from("community_subscribers")
    .select("id, email, unsubscribe_token, community_subscription_preferences!inner(*)")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .eq("community_subscription_preferences.email_updates", true)
    .eq(`community_subscription_preferences.${notifyColumn}`, true)
    .not("email", "is", null);

  const recipients = subscribers || [];
  if (recipients.length === 0) {
    return { recipientCount: 0, sentCount: 0, failedCount: 0 };
  }

  // Idempotency: the unique (announcement_id, subscriber_id, channel)
  // constraint means a second attempt at this announcement never
  // double-emails anyone who already got a logged 'sent' row.
  const { data: existingLogs } = await admin
    .from("community_delivery_logs")
    .select("subscriber_id, status")
    .eq("announcement_id", announcement.id)
    .eq("channel", "email");
  const alreadySent = new Set((existingLogs || []).filter((l: any) => l.status === "sent").map((l: any) => l.subscriber_id));
  const toSend = recipients.filter((r: any) => !alreadySent.has(r.id));

  const ctaUrl =
    announcement.link_type === "custom"
      ? announcement.link_url
      : announcement.link_type === "product" && announcement.link_ref_id
      ? `${siteUrl()}/${profile.username}#merch`
      : announcement.link_type === "booking"
      ? `${siteUrl()}/${profile.username}/book`
      : announcement.link_type === "music" || announcement.link_type === "event"
      ? `${siteUrl()}/${profile.username}`
      : null;

  let sentCount = alreadySent.size;
  let failedCount = 0;

  for (const subscriber of toSend) {
    const manageUrl = `${siteUrl()}/community/manage/${subscriber.unsubscribe_token}`;
    const html = renderAnnouncementEmail({
      creatorName: profile.name || profile.username,
      creatorAvatarUrl: profile.avatar_url,
      category: profile.category,
      aboutLocation: profile.about_location,
      title: announcement.title,
      message: announcement.message,
      imageUrl: announcement.image_url,
      ctaUrl,
      ctaLabel: "View",
      manageUrl,
      unsubscribeUrl: manageUrl,
    });

    const result = await sendEmail({
      to: subscriber.email,
      subject: announcement.title,
      html,
      replyTo: profile.about_email || null,
    });

    const logPatch = result.ok
      ? { status: "sent", provider_message_id: result.providerMessageId || null, sent_at: new Date().toISOString(), error: null }
      : { status: "failed", error: result.error || "unknown_error" };

    await admin.from("community_delivery_logs").upsert(
      { announcement_id: announcement.id, subscriber_id: subscriber.id, channel: "email", ...logPatch },
      { onConflict: "announcement_id,subscriber_id,channel" }
    );

    if (result.ok) sentCount++;
    else failedCount++;
  }

  // --- Push channel — independent consent from email/whatsapp above:
  // having a push_subscriptions row IS the opt-in (the browser permission
  // grant already required it), so eligibility here is just "active" +
  // the content-type preference, not `email_updates`. Doesn't affect the
  // recipientCount/sentCount/failedCount returned above — those describe
  // the email send this function's callers already surface in their own
  // UI; push is a bonus channel layered on top, not a replacement.
  const { data: pushCandidates } = await admin
    .from("community_subscribers")
    .select("id, community_subscription_preferences!inner(*)")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .eq(`community_subscription_preferences.${notifyColumn}`, true);

  if (pushCandidates && pushCandidates.length > 0) {
    const { data: existingPushLogs } = await admin
      .from("community_delivery_logs")
      .select("subscriber_id, status")
      .eq("announcement_id", announcement.id)
      .eq("channel", "push");
    const alreadyPushed = new Set(
      (existingPushLogs || []).filter((l: any) => l.status === "sent").map((l: any) => l.subscriber_id)
    );

    const pushBody = String(announcement.message || "").slice(0, 160);
    for (const subscriber of pushCandidates as any[]) {
      if (alreadyPushed.has(subscriber.id)) continue;
      const delivered = await sendPushToSubscriber(admin, subscriber.id, {
        category: `community_${announcement.notification_category}`,
        title: announcement.title,
        body: pushBody,
        url: ctaUrl || `${siteUrl()}/${profile.username}`,
      });
      if (delivered) {
        await admin.from("community_delivery_logs").upsert(
          { announcement_id: announcement.id, subscriber_id: subscriber.id, channel: "push", status: "sent", sent_at: new Date().toISOString() },
          { onConflict: "announcement_id,subscriber_id,channel" }
        );
      }
      // Not delivered just means this subscriber has no push subscription
      // (the overwhelmingly common case) — not logged as 'failed', since
      // that column is for a real send attempt going wrong, not "nothing
      // to attempt."
    }
  }

  return { recipientCount: recipients.length, sentCount, failedCount };
}
