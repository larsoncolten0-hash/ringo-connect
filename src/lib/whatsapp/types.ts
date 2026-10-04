// Internal, normalized shapes for inbound WhatsApp Cloud API webhook events.
// Pure types: nothing here touches the database or the network.

export type WhatsAppMessageType =
  | "text" | "image" | "audio" | "video" | "document" | "sticker"
  | "location" | "contacts" | "interactive" | "button" | "reaction"
  | "order" | "system" | "unsupported";

export type WhatsAppMediaKind = "image" | "audio" | "video" | "document" | "sticker";

export interface WhatsAppMediaRef {
  kind: WhatsAppMediaKind;
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
  filename: string | null;
}

export interface InboundMessageEvent {
  kind: "message";
  /** Stable key for idempotent processing (see idempotency.ts). */
  idempotencyKey: string;
  wabaId: string | null;
  phoneNumberId: string;
  messageId: string;
  /** Sender WhatsApp id (digits). Customer PII: never log it. */
  from: string;
  /** ISO-8601, or null when Meta sent no/invalid timestamp. */
  timestamp: string | null;
  type: WhatsAppMessageType;
  text: string | null;
  media: WhatsAppMediaRef | null;
  /** Profile name from the contacts block, when present. PII. */
  contactName: string | null;
  replyToMessageId: string | null;
}

export type WhatsAppStatus = "sent" | "delivered" | "read" | "failed" | "deleted" | "unknown";

export interface StatusEvent {
  kind: "status";
  idempotencyKey: string;
  wabaId: string | null;
  phoneNumberId: string;
  /** id of the outbound message this status refers to. */
  messageId: string;
  status: WhatsAppStatus;
  timestamp: string | null;
  /** Recipient WhatsApp id. PII: never log it. */
  recipientId: string | null;
  errorCodes: number[];
}

export type WhatsAppEvent = InboundMessageEvent | StatusEvent;

export interface ParsedWebhook {
  events: WhatsAppEvent[];
  /** Entries/changes/items skipped because they were malformed or of an unhandled field. */
  skipped: number;
}
