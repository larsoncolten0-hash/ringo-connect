import { createAdminClient } from "./supabase/server";
import { decryptSecret } from "./crypto";
import { sendMetaEvent } from "./metaConversions";
import { sendTikTokEvent } from "./tiktokEvents";
import {
  metaEventName,
  tiktokEventName,
  isValidFacebookPixelId,
  isValidTiktokPixelId,
  type PixelTargetType,
  type PixelContentData,
} from "./pixelEvents";

// Server-only orchestration for Meta Conversions API + TikTok Events API.
// Everything here runs after the visitor-facing work (the click_events
// insert / the page render) is already underway — a slow or failing ad
// network call must never hold up or break the actual page/click.

export type ProfilePixelConfig = {
  facebookPixelId: string | null;
  facebookToken: string | null;
  facebookTestEventCode: string | null;
  tiktokPixelId: string | null;
  tiktokToken: string | null;
};

/** Builds a config from a profiles row already fetched elsewhere (e.g. the
 *  public profile page's own query) — avoids a redundant DB round trip. */
export function buildPixelConfigFromRow(row: any): ProfilePixelConfig {
  return {
    facebookPixelId: row?.facebook_pixel_id || null,
    facebookToken: decryptSecret(row?.facebook_capi_token_encrypted),
    facebookTestEventCode: row?.facebook_test_event_code || null,
    tiktokPixelId: row?.tiktok_pixel_id || null,
    tiktokToken: decryptSecret(row?.tiktok_events_token_encrypted),
  };
}

/** Fetches + decrypts a profile's pixel config by id (for callers, like
 *  /api/track, that don't already have the row in hand). Uses the
 *  service-role client — anonymous requests should never read the
 *  encrypted token columns directly, even though they're useless without
 *  SETTINGS_ENCRYPTION_KEY. */
export async function getProfilePixelConfig(
  profileId: string
): Promise<{ userId: string; config: ProfilePixelConfig } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select(
      "user_id, facebook_pixel_id, tiktok_pixel_id, facebook_capi_token_encrypted, tiktok_events_token_encrypted, facebook_test_event_code"
    )
    .eq("id", profileId)
    .single();
  if (!data) return null;
  return { userId: data.user_id, config: buildPixelConfigFromRow(data) };
}

/** Whether the profile owner's CURRENT plan includes pixel tracking —
 *  checked independently of what's saved on the profile row, so a
 *  downgrade actually stops server-side sends rather than just hiding
 *  the editor fields. */
export async function isPixelsEnabledForUser(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("plans(pixels_enabled)").eq("id", userId).single();
  const plans = (data as any)?.plans;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  return !!plan?.pixels_enabled;
}

type RequestSignals = {
  eventId: string;
  eventSourceUrl: string;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  ttp: string | null;
  ttclid: string | null;
  externalId: string | null;
};

/** Sends the Meta PageView CAPI event for a profile whose config (and
 *  plan-enabled state) the caller has already resolved. Used by the
 *  public profile page on every load — TikTok has no server-side
 *  "PageView" standard event, so that side stays browser-only (ttq.page()). */
export async function sendMetaPageView(config: ProfilePixelConfig, signals: RequestSignals): Promise<void> {
  if (!config.facebookPixelId || !config.facebookToken || !isValidFacebookPixelId(config.facebookPixelId)) return;
  await sendMetaEvent({
    pixelId: config.facebookPixelId,
    accessToken: config.facebookToken,
    testEventCode: config.facebookTestEventCode,
    eventName: "PageView",
    eventId: signals.eventId,
    eventSourceUrl: signals.eventSourceUrl,
    clientIp: signals.clientIp,
    userAgent: signals.userAgent,
    fbp: signals.fbp,
    fbc: signals.fbc,
    externalId: signals.externalId,
  });
}

/** Sends the matching server-side event(s) for a link/product/whatsapp
 *  click, to whichever of Meta/TikTok the creator has fully configured
 *  (pixel ID + access token) and whose plan still includes pixels. */
export async function dispatchServerPixelEvents(
  profileId: string,
  targetType: PixelTargetType,
  signals: RequestSignals,
  content?: PixelContentData
): Promise<void> {
  const result = await getProfilePixelConfig(profileId);
  if (!result) return;
  if (!(await isPixelsEnabledForUser(result.userId))) return;

  const { config } = result;
  const sends: Promise<void>[] = [];

  if (config.facebookPixelId && config.facebookToken && isValidFacebookPixelId(config.facebookPixelId)) {
    sends.push(
      sendMetaEvent({
        pixelId: config.facebookPixelId,
        accessToken: config.facebookToken,
        testEventCode: config.facebookTestEventCode,
        eventName: metaEventName(targetType),
        eventId: signals.eventId,
        eventSourceUrl: signals.eventSourceUrl,
        clientIp: signals.clientIp,
        userAgent: signals.userAgent,
        fbp: signals.fbp,
        fbc: signals.fbc,
        externalId: signals.externalId,
        contentName: content?.contentName,
        contentId: content?.contentId,
        value: content?.value,
        currency: content?.currency,
      })
    );
  }

  if (config.tiktokPixelId && config.tiktokToken && isValidTiktokPixelId(config.tiktokPixelId)) {
    sends.push(
      sendTikTokEvent({
        pixelCode: config.tiktokPixelId,
        accessToken: config.tiktokToken,
        eventName: tiktokEventName(targetType),
        eventId: signals.eventId,
        eventSourceUrl: signals.eventSourceUrl,
        clientIp: signals.clientIp,
        userAgent: signals.userAgent,
        ttp: signals.ttp,
        ttclid: signals.ttclid,
        externalId: signals.externalId,
        contentName: content?.contentName,
        contentId: content?.contentId,
        value: content?.value,
        currency: content?.currency,
      })
    );
  }

  await Promise.allSettled(sends);
}

/** First IP in X-Forwarded-For (or X-Real-IP as a fallback) — Vercel
 *  populates these on every request; absent locally, which is fine. */
export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") || null;
}
