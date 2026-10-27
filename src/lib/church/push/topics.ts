import { translations } from "@/lib/i18n/translations";
import { PLAN_DAYS, dayOnDate, readingForDay, referenceOf } from "../bibleYear/plan";

// Churches & Ministries expansion, Phase 5B: what a church notification is made of. Pure: no I/O. The sender (send.ts) and the screens share these rules.
//
// A notification is built from PUBLIC text only: the church's name as the title, and a body made from the public title of the item (an announcement, an event, a care need, a product) or a fixed sentence.
// It never carries a person's name, a phone number, a roster entry or the words of a testimony. The deep link is a path on this platform under the church's own address, checked before it is used.

export const PUSH_TOPICS = ["announcements", "events", "testimonies", "daily_word", "bible_day", "care", "store", "groups"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];
export const isPushTopic = (v: unknown): v is PushTopic => typeof v === "string" && (PUSH_TOPICS as readonly string[]).includes(v);

export const PUSH_KINDS = ["announcement", "group_announcement", "event", "testimony", "daily_word", "bible_day", "care", "product"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const isPushKind = (v: unknown): v is PushKind => typeof v === "string" && (PUSH_KINDS as readonly string[]).includes(v);

export const TOPIC_OF_KIND: Record<PushKind, PushTopic> = {
  announcement: "announcements",
  group_announcement: "groups",
  event: "events",
  testimony: "testimonies",
  daily_word: "daily_word",
  bible_day: "bible_day",
  care: "care",
  product: "store",
};

/** A visitor receives at most this many church messages in 24 hours (the database enforces it too). */
export const DAILY_CAP = 5;

/** The page a notification opens, as a path on this platform under the church's own address. */
export function deepLink(username: string, kind: PushKind, extra?: { groupKind?: string; productId?: string }): string {
  const base = `/${encodeURIComponent(username)}`;
  switch (kind) {
    case "announcement":
      return `${base}/church/announcements`;
    case "group_announcement":
      return extra?.groupKind ? `${base}/church/groups/${encodeURIComponent(extra.groupKind)}` : `${base}/church/groups`;
    case "event":
      return `${base}/church/events`;
    case "testimony":
      return `${base}/church/testimonies`;
    case "daily_word":
      return `${base}#church-word`;
    case "bible_day":
      return `${base}/church/bible-year`;
    case "care":
      return `${base}/church/care`;
    case "product":
      return extra?.productId ? `${base}/item/${encodeURIComponent(extra.productId)}` : `${base}/shop`;
  }
}

/** A path is accepted only when it stays under the church's own address (never an outside link, never another church). */
export function safeDeepLink(path: unknown, username: string): string | null {
  if (typeof path !== "string" || path.length > 300 || /[\s\u0000-\u001f\\]/.test(path) || path.startsWith("//")) return null;
  const base = `/${encodeURIComponent(username)}`;
  return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}#`) ? path : null;
}

export interface PushPayload {
  title_en?: string | null;
  title_fr?: string | null;
  path?: string | null;
  group_id?: string | null;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

/** The small payload stored with a queued notification: public titles and a path. Anything else is dropped. */
export function buildPayload(input: { title_en?: unknown; title_fr?: unknown; path: string; group_id?: string | null }): Record<string, string> {
  const out: Record<string, string> = { path: input.path.slice(0, 300) };
  const en = text(input.title_en, 140);
  const fr = text(input.title_fr, 140);
  if (en) out.title_en = en;
  if (fr) out.title_fr = fr;
  if (input.group_id) out.group_id = input.group_id;
  return out;
}

export interface BuiltMessage {
  title: string;
  body: string;
  url: string;
}

/**
 * The message for ONE recipient, in their language. `start` is the start date of the reader's plan (only for the daily Bible reading, where each reader is on their own day). Returns null when the
 * deep link is not acceptable: such a notification is not sent.
 */
export function buildMessage(args: { kind: PushKind; lang: "en" | "fr"; church: { name: string; username: string }; payload: PushPayload; start?: string | null; today?: string }): BuiltMessage | null {
  const url = safeDeepLink(args.payload.path, args.church.username);
  if (!url) return null;
  const m = translations[args.lang].churchExpansion.push.messages;
  const other = args.lang === "en" ? "fr" : "en";
  const title = text(args.payload[`title_${args.lang}`], 140) ?? text(args.payload[`title_${other}`], 140);
  let body: string;
  if (args.kind === "bible_day") {
    if (!args.start || !args.today) return null;
    const pos = dayOnDate(args.start, args.today);
    const reading = readingForDay(pos.day);
    body = reading && !pos.finished ? m.bibleDay(pos.day, referenceOf(reading, args.lang)) : m.bible_day.plain;
  } else {
    const t = m[args.kind];
    body = args.kind === "testimony" || !title ? t.plain : t.withTitle(title);
  }
  const name = text(args.church.name, 80) ?? args.church.username;
  return { title: name, body: body.slice(0, 180), url };
}

export { PLAN_DAYS };
