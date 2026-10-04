// Pure helpers for the Inbox UI (no database, no React): how a stored message is displayed, previewed and timestamped.
// Message bodies are customer-supplied text. They are only ever returned as plain strings and rendered through React's escaping;
// nothing here builds HTML.

export const MEDIA_KINDS = ["image", "audio", "video", "document", "sticker"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MessageLike {
  type: string;
  body: string | null;
}
export interface MediaLike {
  kind: string;
  caption: string | null;
  filename: string | null;
}

export type MessageDisplay =
  | { kind: "text"; text: string }
  | { kind: "media"; media: MediaKind; caption: string | null; filename: string | null }
  | { kind: "unsupported" };

const isMediaKind = (v: string): v is MediaKind => (MEDIA_KINDS as readonly string[]).includes(v);

/** What to show for a stored message. Anything the UI cannot render yet (interactive, location, reaction, ...) is "unsupported", never a crash. */
export function messageDisplay(msg: MessageLike, media?: MediaLike | null): MessageDisplay {
  if (msg.type === "text") {
    return msg.body && msg.body.trim() ? { kind: "text", text: msg.body } : { kind: "unsupported" };
  }
  if (isMediaKind(msg.type)) {
    return { kind: "media", media: msg.type, caption: media?.caption ?? null, filename: media?.filename ?? null };
  }
  return { kind: "unsupported" };
}

/** One-line preview for the conversation list: collapsed whitespace, capped length. Media shows its caption when there is one. */
export function previewText(display: MessageDisplay, labels: { unsupported: string; mediaKinds: Record<MediaKind, string> }, max = 90): string {
  const clip = (s: string) => {
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
  };
  if (display.kind === "text") return clip(display.text);
  if (display.kind === "media") {
    const label = labels.mediaKinds[display.media];
    return display.caption && display.caption.trim() ? clip(`${label} · ${display.caption}`) : label;
  }
  return labels.unsupported;
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Display time of a message: the provider's timestamp when Meta sent one, otherwise when Ringo received it. */
export function messageTime(m: { provider_timestamp: string | null; received_at: string }): string {
  return m.provider_timestamp || m.received_at;
}

/** Chronological order (oldest first), with the row id as a stable tie-break. */
export function sortThread<T extends { id: string; provider_timestamp: string | null; received_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = Date.parse(messageTime(a)) - Date.parse(messageTime(b));
    return d !== 0 && !Number.isNaN(d) ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Ringo's customers are in Douala: both server and browser format in that zone so the two renders agree.
const TZ = "Africa/Douala";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** List timestamp: time today, short date this year, full date before that. "" when the value is missing or invalid. */
export function formatListTime(iso: string | null | undefined, locale: "en" | "fr", now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (dayKey(d) === dayKey(now)) return new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const sameYear = dayKey(d).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat(locale, sameYear ? { timeZone: TZ, day: "numeric", month: "short" } : { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** Bubble timestamp: always includes the time, and the date when it is not today. */
export function formatBubbleTime(iso: string | null | undefined, locale: "en" | "fr", now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  if (dayKey(d) === dayKey(now)) return time;
  return `${new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short" }).format(d)}, ${time}`;
}

/** "+237683163546" from the stored WhatsApp id (digits only). Anything unexpected is shown as stored. */
export function formatWaId(id: string): string {
  return /^[0-9]{6,20}$/.test(id) ? `+${id}` : id;
}
