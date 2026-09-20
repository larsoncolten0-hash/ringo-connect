import { translations, type Locale } from "@/lib/i18n/translations";

// The WORDING of loyalty notifications (push + email), as pure functions with no I/O: a message
// description in, translated text out. Everything a customer reads comes from
// translations.<locale>.loyalty.notify (English + French); business-authored names (reward
// title, package name, business name) are only ever interpolated as data. Push text is plain;
// email HTML escapes every interpolated value.
//
// These are TRANSACTIONAL product notifications about a customer's own loyalty activity. Nothing
// here is, or can be turned into, marketing.

export type LoyaltyMessage =
  | { kind: "recorded"; business: string; actionKey: string; quantity: number; progress: number | null; target: number | null }
  | { kind: "near"; remaining: 1 | 2; business: string; actionKey: string }
  | { kind: "unlocked"; business: string; reward: string }
  | { kind: "redeemed"; business: string; reward: string }
  | { kind: "package_activated"; business: string; name: string; endsAt: string }
  | { kind: "package_used"; business: string; name: string; actionKey: string; remaining: number }
  | { kind: "package_expiring"; business: string; name: string; endsAt: string; remaining: number }
  | { kind: "reward_expiring"; business: string; reward: string; endsAt: string }
  | { kind: "reward_expired"; business: string; reward: string }
  | { kind: "package_expired"; business: string; name: string; remaining: number };

export type LoyaltyMessageKind = LoyaltyMessage["kind"];

// Distinct push categories: the service worker uses `category` as the OS notification tag, so
// different kinds must not share one or a later push would silently replace an earlier one.
export type LoyaltyPushCategory = "loyalty_progress" | "loyalty_reward" | "loyalty_package";

export const LOYALTY_PUSH_URL = "/my-ringo/rewards";

/** Only the moments that matter get an email: a reward unlocked, a reward or package about to expire. */
export const EMAIL_KINDS: ReadonlySet<LoyaltyMessageKind> = new Set<LoyaltyMessageKind>(["unlocked", "package_expiring", "reward_expiring"]);

// Calendar day shown in a notification. The stored timestamp is authoritative (timestamptz, UTC);
// only its DISPLAY is converted, and to the platform's home timezone: Cameroon (WAT, UTC+1, no
// daylight saving). Formatting in UTC would show the previous day for anything that ends between
// 00:00 and 01:00 local time.
export const DISPLAY_TIME_ZONE = "Africa/Douala";

export function fmtDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: DISPLAY_TIME_ZONE });
}

function words(locale: Locale, key: string) {
  const a = (translations[locale].loyalty.actions as Record<string, { one: string; many: string }>)[key];
  return a ?? { one: key, many: key };
}

export function buildPush(msg: LoyaltyMessage, locale: Locale): { category: LoyaltyPushCategory; title: string; body: string } {
  const n = translations[locale].loyalty.notify.push;
  switch (msg.kind) {
    case "recorded": {
      const w = words(locale, msg.actionKey);
      return {
        category: "loyalty_progress",
        title: n.recorded.title(msg.business),
        body: n.recorded.body(msg.quantity, msg.quantity === 1 ? w.one : w.many, msg.progress, msg.target),
      };
    }
    case "near":
      return msg.remaining === 2
        ? { category: "loyalty_progress", title: n.near2.title, body: n.near2.body(words(locale, msg.actionKey).many, msg.business) }
        : { category: "loyalty_progress", title: n.near1.title, body: n.near1.body(words(locale, msg.actionKey).one, msg.business) };
    case "unlocked":
      return { category: "loyalty_reward", title: n.unlocked.title, body: n.unlocked.body(msg.reward, msg.business) };
    case "redeemed":
      return { category: "loyalty_reward", title: n.redeemed.title, body: n.redeemed.body(msg.reward, msg.business) };
    case "package_activated":
      return { category: "loyalty_package", title: n.packageActivated.title, body: n.packageActivated.body(msg.name, msg.business, fmtDate(msg.endsAt, locale)) };
    case "package_used":
      return { category: "loyalty_package", title: n.packageUsed.title, body: n.packageUsed.body(msg.name, msg.business, msg.remaining, words(locale, msg.actionKey).many) };
    case "package_expiring":
      return { category: "loyalty_package", title: n.packageExpiring.title, body: n.packageExpiring.body(msg.name, msg.business, fmtDate(msg.endsAt, locale), msg.remaining) };
    case "reward_expiring":
      return { category: "loyalty_reward", title: n.rewardExpiring.title, body: n.rewardExpiring.body(msg.reward, msg.business, fmtDate(msg.endsAt, locale)) };
    case "reward_expired":
      return { category: "loyalty_reward", title: n.rewardExpired.title, body: n.rewardExpired.body(msg.reward, msg.business) };
    case "package_expired":
      return { category: "loyalty_package", title: n.packageExpired.title, body: n.packageExpired.body(msg.name, msg.business, msg.remaining) };
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
}

/** Subject + HTML body for the kinds that get an email, or null for kinds that never do. */
export function buildEmail(msg: LoyaltyMessage, locale: Locale): { subject: string; heading: string; body: string; cta: string; footer: string } | null {
  if (!EMAIL_KINDS.has(msg.kind)) return null;
  const e = translations[locale].loyalty.notify.email;
  if (msg.kind === "unlocked") {
    return { subject: e.unlockedSubject(msg.business), heading: e.unlockedHeading, body: e.unlockedBody(msg.reward, msg.business), cta: e.cta, footer: e.footer };
  }
  if (msg.kind === "package_expiring") {
    return {
      subject: e.packageExpiringSubject(msg.business),
      heading: e.packageExpiringHeading,
      body: e.packageExpiringBody(msg.name, msg.business, fmtDate(msg.endsAt, locale), msg.remaining),
      cta: e.cta,
      footer: e.footer,
    };
  }
  if (msg.kind === "reward_expiring") {
    return {
      subject: e.rewardExpiringSubject(msg.business),
      heading: e.rewardExpiringHeading,
      body: e.rewardExpiringBody(msg.reward, msg.business, fmtDate(msg.endsAt, locale)),
      cta: e.cta,
      footer: e.footer,
    };
  }
  return null;
}

/** The email's inner HTML (the caller wraps it in the existing emailShell). Every value is escaped. */
export function renderEmailHtml(email: NonNullable<ReturnType<typeof buildEmail>>): string {
  const link = `${siteUrl()}${LOYALTY_PUSH_URL}`;
  return `
      <p style="font-size:15px; font-weight:600; margin:0 0 8px;">${escapeHtml(email.heading)}</p>
      <p style="font-size:14px; margin:0 0 16px;">${escapeHtml(email.body)}</p>
      <p style="margin:0 0 20px;"><a href="${escapeHtml(link)}" style="display:inline-block; background:#4F46E5; color:#ffffff; text-decoration:none; font-size:14px; font-weight:600; padding:10px 18px; border-radius:10px;">${escapeHtml(email.cta)}</a></p>
      <p style="font-size:12px; color:#64748b; margin:0;">${escapeHtml(email.footer)}</p>
    `;
}
