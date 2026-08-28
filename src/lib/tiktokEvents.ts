import { sha256Hex } from "./crypto";

// Sends one event to TikTok's Events API (server-side) — the TikTok
// counterpart to metaConversions.ts. Same idea: the browser Pixel
// (ttq.track) fires the same event_id, and TikTok merges the two into a
// single deduplicated event with the server call's IP/user-agent/click-id
// filled in.
//
// Docs: https://business-api.tiktok.com/portal/docs?id=1741601162187777

const API_VERSION = "v1.3";

export async function sendTikTokEvent(opts: {
  pixelCode: string;
  accessToken: string;
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  clientIp: string | null;
  userAgent: string | null;
  ttp: string | null;
  ttclid: string | null;
  externalId: string | null;
  contentName?: string | null;
  contentId?: string | null;
  value?: number | null;
  currency?: string | null;
}): Promise<void> {
  const user: Record<string, any> = {};
  if (opts.clientIp) user.ip = opts.clientIp;
  if (opts.userAgent) user.user_agent = opts.userAgent;
  if (opts.ttp) user.ttp = opts.ttp;
  if (opts.ttclid) user.ttclid = opts.ttclid;
  if (opts.externalId) user.external_id = [sha256Hex(opts.externalId)];

  const properties: Record<string, any> = {};
  if (opts.contentName || opts.contentId) {
    properties.contents = [
      {
        content_id: opts.contentId || undefined,
        content_name: opts.contentName || undefined,
      },
    ];
  }
  if (typeof opts.value === "number") properties.value = opts.value;
  if (opts.currency) properties.currency = opts.currency;

  const payload = {
    event_source: "web",
    event_source_id: opts.pixelCode,
    data: [
      {
        event: opts.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        user,
        page: { url: opts.eventSourceUrl },
        ...(Object.keys(properties).length ? { properties } : {}),
      },
    ],
  };

  try {
    const res = await fetch(`https://business-api.tiktok.com/open_api/${API_VERSION}/event/track/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": opts.accessToken,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("TikTok Events API request failed:", res.status, body);
    }
  } catch (err) {
    console.error("TikTok Events API request errored:", err);
  }
}
