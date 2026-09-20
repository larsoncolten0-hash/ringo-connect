import { sendEmail } from "@/lib/email/provider";
import { renderAnnouncementEmail } from "@/lib/email/renderAnnouncementEmail";
import { sendPushToSubscriber } from "@/lib/push/send";
import { sendPushToCustomer } from "@/lib/customer/push";

// Shared by both send paths — the owner's manual "Send Announcement" and
// the one-shot /api/community/notify product action — so there is exactly
// one place that resolves "who's eligible," sends, and logs. Both callers
// already own the announcement row (verified before this is called) and
// pass the admin client, since this reads across the community_* tables,
// not just the caller's own already-scoped rows.
//
// Email and push are sendable (the creator picks per announcement). WhatsApp is stored in the schema
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
): Promise<{ recipientCount: number; sentCount: number; failedCount: number; emailChannel: boolean }> {
  // Channels the creator picked for THIS announcement. NULL (announcements written before
  // the channel picker existed) keeps the old behaviour: email per `audience`, plus push.
  const picked: string[] | null = Array.isArray(announcement.channels) ? announcement.channels : null;
  const emailChannel = picked ? picked.includes("email") : true;
  const pushChannel = picked ? picked.includes("push") : true;

  const notifyColumn = NOTIFY_COLUMN[announcement.notification_category] || "notify_announcements";

  if (announcement.audience === "whatsapp") {
    // No real WhatsApp send infra — never silently "succeed" here.
    return { recipientCount: 0, sentCount: 0, failedCount: 0, emailChannel };
  }

  const { data: subscribers } = await admin
    .from("community_subscribers")
    .select("id, email, unsubscribe_token, community_subscription_preferences!inner(*)")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .eq("community_subscription_preferences.email_updates", true)
    .eq(`community_subscription_preferences.${notifyColumn}`, true)
    .not("email", "is", null);

  const recipients = emailChannel ? subscribers || [] : [];

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

  // --- Push channel — independent consent from email/whatsapp above: eligibility is
  // "active" + the subscriber's own push_updates opt-in + the content-type preference,
  // not `email_updates`. Two kinds of devices are reached: a fan's own browser
  // subscription (push_subscriptions, keyed by subscriber) and, for a subscriber who is a
  // connected My Ringo customer, that customer's My Ringo devices
  // (customer_push_subscriptions, via customer_connections.community_subscriber_id).
  let pushSent = 0;
  let pushCandidateCount = 0;
  if (pushChannel) {
    const pushQuery = (withOptIn: boolean) => {
      let q = admin
        .from("community_subscribers")
        .select("id, community_subscription_preferences!inner(*)")
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .eq(`community_subscription_preferences.${notifyColumn}`, true);
      if (withOptIn) q = q.eq("community_subscription_preferences.push_updates", true);
      return q;
    };
    let { data: pushCandidates, error: pushError } = await pushQuery(true);
    // push_updates not created yet (migration pending): behave as before it existed.
    if (pushError) ({ data: pushCandidates } = await pushQuery(false));

    const candidates = (pushCandidates || []) as any[];
    pushCandidateCount = candidates.length;

    if (candidates.length > 0) {
      const { data: existingPushLogs } = await admin
        .from("community_delivery_logs")
        .select("subscriber_id, status")
        .eq("announcement_id", announcement.id)
        .eq("channel", "push");
      const alreadyPushed = new Set(
        (existingPushLogs || []).filter((l: any) => l.status === "sent").map((l: any) => l.subscriber_id)
      );

      const { data: links } = await admin
        .from("customer_connections")
        .select("customer_id, community_subscriber_id")
        .in("community_subscriber_id", candidates.map((c) => c.id))
        .eq("profile_id", profile.id)
        .eq("status", "active");
      const customerBySubscriber = new Map<string, string>(
        (links || []).map((l: any) => [l.community_subscriber_id as string, l.customer_id as string])
      );

      const payload = {
        category: `community_${announcement.notification_category}`,
        title: announcement.title,
        body: String(announcement.message || "").slice(0, 160),
        url: ctaUrl || `${siteUrl()}/${profile.username}`,
      };
      for (const subscriber of candidates) {
        if (alreadyPushed.has(subscriber.id)) continue;
        const customerId = customerBySubscriber.get(subscriber.id);
        const [viaFan, viaCustomer] = await Promise.all([
          sendPushToSubscriber(admin, subscriber.id, payload),
          customerId ? sendPushToCustomer(customerId, payload) : Promise.resolve(false),
        ]);
        if (viaFan || viaCustomer) {
          pushSent++;
          await admin.from("community_delivery_logs").upsert(
            { announcement_id: announcement.id, subscriber_id: subscriber.id, channel: "push", status: "sent", sent_at: new Date().toISOString() },
            { onConflict: "announcement_id,subscriber_id,channel" }
          );
        }
        // Not delivered just means this subscriber has no push device enabled — not
        // logged as 'failed', since that is for a real send attempt going wrong.
      }
    }
  }

  // Email is the headline number when it was sent; a push-only announcement reports the
  // push audience instead so the creator sees who it actually reached.
  if (!emailChannel) return { recipientCount: pushCandidateCount, sentCount: pushSent, failedCount: 0, emailChannel };
  return { recipientCount: recipients.length, sentCount, failedCount, emailChannel };
}
