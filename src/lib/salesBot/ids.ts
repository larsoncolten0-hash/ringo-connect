import crypto from "crypto";

/** The bot is switched on for ONE WhatsApp number (server environment variable, off by default). Every other Inbox account is untouched. */
export function salesBotEnabledFor(phoneNumberId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = (env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID || "").trim();
  return configured !== "" && configured === phoneNumberId;
}

/** A reply's idempotency key: the same inbound message (or payment) and reply slot always map to the same id, so a retry can never send twice. */
export function replyRequestId(phoneNumberId: string, messageId: string, slot = "reply"): string {
  const h = crypto.createHash("sha256").update(`salesbot:${slot}:${phoneNumberId}:${messageId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** True when the bot is switched on for ANY number on this deployment (used only to decide whether the Inbox shows the owner's "Resume sales bot" action). */
export function salesBotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID || "").trim() !== "";
}
