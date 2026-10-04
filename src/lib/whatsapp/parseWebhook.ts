import { messageIdempotencyKey, statusIdempotencyKey } from "./idempotency";
import type {
  InboundMessageEvent, ParsedWebhook, StatusEvent, WhatsAppEvent, WhatsAppMediaKind, WhatsAppMessageType, WhatsAppStatus,
} from "./types";

// Defensive normalizer for the WhatsApp Cloud API webhook body. Never throws: anything it does not
// understand is counted in `skipped`. It trusts nothing about the payload (the caller has already
// verified the signature and still validates the account separately).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const MEDIA_KINDS: WhatsAppMediaKind[] = ["image", "audio", "video", "document", "sticker"];
const KNOWN_TYPES: WhatsAppMessageType[] = [
  "text", "image", "audio", "video", "document", "sticker", "location", "contacts",
  "interactive", "button", "reaction", "order", "system",
];
const STATUSES: WhatsAppStatus[] = ["sent", "delivered", "read", "failed", "deleted"];

function isoFromUnix(v: unknown): string | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseMessage(raw: unknown, wabaId: string | null, phoneNumberId: string, names: Map<string, string>): InboundMessageEvent | null {
  if (!isObj(raw)) return null;
  const messageId = str(raw.id);
  const from = str(raw.from);
  if (!messageId || !from) return null;

  const rawType = str(raw.type);
  const type: WhatsAppMessageType = rawType && (KNOWN_TYPES as string[]).includes(rawType) ? (rawType as WhatsAppMessageType) : "unsupported";

  let text: string | null = null;
  let media: InboundMessageEvent["media"] = null;
  if (type === "text" && isObj(raw.text)) text = str(raw.text.body);
  if ((MEDIA_KINDS as string[]).includes(type) && isObj(raw[type])) {
    const m = raw[type] as Obj;
    const mediaId = str(m.id);
    if (mediaId) {
      media = {
        kind: type as WhatsAppMediaKind,
        mediaId,
        mimeType: str(m.mime_type),
        sha256: str(m.sha256),
        caption: str(m.caption),
        filename: str(m.filename),
      };
    }
  }

  return {
    kind: "message",
    idempotencyKey: messageIdempotencyKey(messageId),
    wabaId,
    phoneNumberId,
    messageId,
    from,
    timestamp: isoFromUnix(raw.timestamp),
    type,
    text,
    media,
    contactName: names.get(from) ?? null,
    replyToMessageId: isObj(raw.context) ? str(raw.context.id) : null,
  };
}

function parseStatus(raw: unknown, wabaId: string | null, phoneNumberId: string): StatusEvent | null {
  if (!isObj(raw)) return null;
  const messageId = str(raw.id);
  if (!messageId) return null;
  const s = str(raw.status);
  const status: WhatsAppStatus = s && (STATUSES as string[]).includes(s) ? (s as WhatsAppStatus) : "unknown";
  return {
    kind: "status",
    idempotencyKey: statusIdempotencyKey(messageId, status),
    wabaId,
    phoneNumberId,
    messageId,
    status,
    timestamp: isoFromUnix(raw.timestamp),
    recipientId: str(raw.recipient_id),
    errorCodes: arr(raw.errors).flatMap((e) => (isObj(e) && typeof e.code === "number" ? [e.code] : [])),
  };
}

export function parseWhatsAppWebhook(body: unknown): ParsedWebhook {
  const events: WhatsAppEvent[] = [];
  let skipped = 0;
  if (!isObj(body) || body.object !== "whatsapp_business_account") return { events, skipped: 1 };

  const entries = arr(body.entry);
  if (entries.length === 0) return { events, skipped: 1 };

  for (const entry of entries) {
    if (!isObj(entry)) { skipped++; continue; }
    const wabaId = str(entry.id);
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) { skipped++; continue; }
      const value = change.value;
      const phoneNumberId = isObj(value.metadata) ? str(value.metadata.phone_number_id) : null;
      if (!phoneNumberId) { skipped++; continue; }

      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        if (!isObj(c)) continue;
        const id = str(c.wa_id);
        const n = isObj(c.profile) ? str(c.profile.name) : null;
        if (id && n) names.set(id, n);
      }
      for (const m of arr(value.messages)) {
        const ev = parseMessage(m, wabaId, phoneNumberId, names);
        if (ev) events.push(ev); else skipped++;
      }
      for (const s of arr(value.statuses)) {
        const ev = parseStatus(s, wabaId, phoneNumberId);
        if (ev) events.push(ev); else skipped++;
      }
    }
  }
  return { events, skipped };
}
