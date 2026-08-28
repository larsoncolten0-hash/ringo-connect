// Shared, secret-free event-name mapping — imported by BOTH the public
// profile page (browser Pixel calls) and /api/track (server-side
// Conversions API / Events API calls). Using one source of truth for
// these names is what makes the browser event and the server event line
// up as "the same event" in Meta/TikTok's eyes, which is required for
// deduplication (matched on event_name + event_id together) to work.
//
// Event choice: "Contact" is a real semantic fit for a WhatsApp tap (the
// visitor is literally initiating contact). "ViewContent" fits a product
// click since the visitor is viewing a specific priced item. A generic
// link in the "Links" list isn't a standard conversion action, so it
// stays a custom event on Meta (misusing a standard event like "Lead"
// for a plain click would poison ad-optimization signal), while TikTok's
// own "ClickButton" standard event is designed for exactly this.
export type PixelTargetType = "link" | "product" | "whatsapp";

export function metaEventName(targetType: PixelTargetType): string {
  if (targetType === "whatsapp") return "Contact";
  if (targetType === "product") return "ViewContent";
  return "ClickLink";
}

export function tiktokEventName(targetType: PixelTargetType): string {
  if (targetType === "whatsapp") return "Contact";
  if (targetType === "product") return "ViewContent";
  return "ClickButton";
}

export type PixelContentData = {
  contentName?: string | null;
  contentId?: string | null;
  value?: number | null;
  currency?: string | null;
};

// Meta Pixel IDs are always a plain numeric string; TikTok Pixel codes
// are alphanumeric. Validated at the point the id is about to be
// interpolated into an inline <script> on the public profile page (see
// ProfileView.tsx) — a creator's own saved pixel ID is otherwise
// attacker-controlled text reaching every anonymous visitor's browser,
// so anything that doesn't match gets treated as "not configured"
// rather than ever being trusted into a script string.
export function isValidFacebookPixelId(id: string): boolean {
  return /^\d{6,20}$/.test(id);
}

export function isValidTiktokPixelId(id: string): boolean {
  return /^[A-Za-z0-9]{6,40}$/.test(id);
}
