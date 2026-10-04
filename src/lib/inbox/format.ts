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
  mimeType?: string | null;
}

export type MessageDisplay =
  | { kind: "text"; text: string }
  | { kind: "media"; media: MediaKind; caption: string | null; filename: string | null; mimeType: string | null }
  | { kind: "unsupported" };

const isMediaKind = (v: string): v is MediaKind => (MEDIA_KINDS as readonly string[]).includes(v);

/** What to show for a stored message. Anything the UI cannot render yet (interactive, location, reaction, ...) is "unsupported", never a crash. */
export function messageDisplay(msg: MessageLike, media?: MediaLike | null): MessageDisplay {
  if (msg.type === "text") {
    return msg.body && msg.body.trim() ? { kind: "text", text: msg.body } : { kind: "unsupported" };
  }
  if (isMediaKind(msg.type)) {
    return { kind: "media", media: msg.type, caption: media?.caption ?? null, filename: media?.filename ?? null, mimeType: media?.mimeType ?? null };
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

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;
export type InboxStatusFilter = "open" | "closed" | "all";
export const isStatusFilter = (v: unknown): v is InboxStatusFilter => v === "open" || v === "closed" || v === "all";

/**
 * Turns what a person typed into a SAFE conversation search term, or null when it is too short to search.
 * The term is later placed in a PostgREST or() filter and an ilike pattern, so it is reduced to letters, digits, spaces, apostrophes and hyphens:
 * no comma, parenthesis, dot, colon, quote, backslash or wildcard (% _ *) can survive. `digits` is the digits-only form (for matching a number such
 * as "+237 6 83 ..."), only when at least 3 digits were typed.
 */
export function normalizeSearch(raw: unknown): { text: string; digits: string | null } | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} '-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX)
    .trim();
  if (Array.from(text).length < SEARCH_MIN) return null;
  const digits = raw.replace(/\D/g, "");
  return { text, digits: digits.length >= 3 && digits.length <= 20 ? digits : null };
}

// Saved replies: shared limits (the database enforces the same numbers).
export const SAVED_REPLY_LIMIT = 50;
export const TITLE_MAX = 60;
export const BODY_MAX = 4096;

/** The `q` URL parameter as typed: first value only, control characters removed, trimmed, capped. (normalizeSearch makes it safe for a query.) */
export function cleanQueryParam(v: unknown): string {
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, SEARCH_MAX);
}
