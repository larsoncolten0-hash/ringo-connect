import { createHmac, timingSafeEqual } from "crypto";

// Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, appSecret).
// The signature must be checked against the RAW body, before any JSON parsing.

/** App secret from the environment. WHATSAPP_APP_SECRET wins; META_APP_SECRET is the accepted alias. */
export function getWhatsAppAppSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.WHATSAPP_APP_SECRET || env.META_APP_SECRET || "").trim();
  return v || null;
}

export function verifyWhatsAppSignature(rawBody: string, header: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!appSecret || !header) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
