import crypto from "crypto";

// Pure crypto for the customer's Ringo QR. The QR text is  ringo:c1:<secret>.
//
//   secret = base64url( HMAC-SHA256( LOYALTY_QR_SECRET, "c1:" + customerId + ":" + nonce ) )
//
// The secret is NEVER stored. The database keeps only sha256(secret) and the random
// nonce, so a database leak alone yields nothing scannable, while the server can
// still re-render the QR for the signed-in customer by recomputing the HMAC.
// The secret carries no name, email, phone or customer id. It resolves to a
// customer only inside a business's authenticated scan request (see qr.ts), and it
// can never be used to sign in — nothing in the customer-session code reads it.

export const QR_PREFIX = "ringo:c1:";
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** Extracts the secret from scanned text, or null for anything that is not a Ringo v1 code. */
export function parseQrPayload(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 200) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(QR_PREFIX)) return null;
  const secret = trimmed.slice(QR_PREFIX.length);
  return SECRET_RE.test(secret) ? secret : null;
}

/** The server-side HMAC key. Fails closed: no key (or a weak one) means no QR feature at all. */
export function getQrKey(value: string | undefined = process.env.LOYALTY_QR_SECRET): Buffer {
  if (!value || value.length < 32) {
    throw new Error("LOYALTY_QR_SECRET is missing or shorter than 32 characters");
  }
  return Buffer.from(value, "utf8");
}

export function newQrNonce(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function deriveQrSecret(key: Buffer, customerId: string, nonce: string): string {
  return crypto.createHmac("sha256", key).update(`c1:${customerId}:${nonce}`).digest("base64url");
}

export function hashQrSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function buildQrPayload(secret: string): string {
  return QR_PREFIX + secret;
}
