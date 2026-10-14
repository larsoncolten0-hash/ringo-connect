// Ringo Smart Card (QR) tokens. The token printed in the QR code is the capability: 20 random bytes (160 bits) from the platform CSPRNG, base64url, 27 characters.
// Only its SHA-256 hash is ever stored or compared. The serial (RINGO-0001 ...) is a human label for matching a card to its QR image, never a credential.
// The URL carries nothing but the token: no serial, no username, no profile id.
import { createHash, createHmac, randomBytes } from "crypto";

export const CARD_TOKEN_BYTES = 20;
export const CARD_TOKEN_LENGTH = 27; // base64url of 20 bytes, no padding
export const CARD_BATCH_SIZE = 500;

export function generateCardToken(): string {
  return randomBytes(CARD_TOKEN_BYTES).toString("base64url");
}

export function isWellFormedCardToken(value: unknown): value is string {
  return typeof value === "string" && value.length === CARD_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

export function hashCardToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function cardSerial(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error("serial out of range");
  return `RINGO-${String(n).padStart(4, "0")}`;
}

export function cardPath(token: string): string {
  return `/c/${token}`;
}

export function cardUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${cardPath(token)}`;
}

/** Keyed hash of a caller (address or user id) for the rate-limit table, so nothing identifying is stored. */
export function hashRateSubject(kind: string, subject: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || "ringo-smart-cards";
  return createHmac("sha256", key).update(`${kind}:${subject}`, "utf8").digest("hex");
}
