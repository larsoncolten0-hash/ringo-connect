import { sha256Hex } from "./crypto";

// Sends one event to Meta's Conversions API (server-side). This is what
// actually moves Event Match Quality in Events Manager: the browser
// Pixel alone hands Meta whatever the browser lets through (nothing, if
// an ad blocker or Safari's ITP strips it), while this call carries the
// real request IP, user agent, and click/browser-id cookies straight
// from our server. Pairing both — same event_name + event_id — makes
// Meta merge them into one high-quality event instead of two weak ones.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api

const GRAPH_VERSION = "v21.0";

export async function sendMetaEvent(opts: {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  externalId: string | null;
  contentName?: string | null;
  contentId?: string | null;
  value?: number | null;
  currency?: string | null;
}): Promise<void> {
  const userData: Record<string, any> = {};
  if (opts.clientIp) userData.client_ip_address = opts.clientIp;
  if (opts.userAgent) userData.client_user_agent = opts.userAgent;
  if (opts.fbp) userData.fbp = opts.fbp;
  if (opts.fbc) userData.fbc = opts.fbc;
  // external_id is our own anonymous visitor id (a random UUID cookie,
  // never anything identifying) — Meta still asks for it pre-hashed.
  if (opts.externalId) userData.external_id = sha256Hex(opts.externalId);

  const customData: Record<string, any> = {};
  if (opts.contentName) customData.content_name = opts.contentName;
  if (opts.contentId) customData.content_ids = [opts.contentId];
  if (opts.contentId) customData.content_type = "product";
  if (typeof opts.value === "number") customData.value = opts.value;
  if (opts.currency) customData.currency = opts.currency;

  const payload = {
    data: [
      {
        event_name: opts.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        event_source_url: opts.eventSourceUrl,
        action_source: "website",
        user_data: userData,
        ...(Object.keys(customData).length ? { custom_data: customData } : {}),
      },
    ],
    ...(opts.testEventCode ? { test_event_code: opts.testEventCode } : {}),
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${opts.pixelId}/events?access_token=${encodeURIComponent(
    opts.accessToken
  )}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Meta Conversions API request failed:", res.status, body);
    }
  } catch (err) {
    // Best-effort — a failed CAPI send must never break the visitor-facing
    // request (page load or link click) that triggered it.
    console.error("Meta Conversions API request errored:", err);
  }
}
