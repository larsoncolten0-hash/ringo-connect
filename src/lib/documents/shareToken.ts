// Share-link tokens. The token is the capability: 32 random bytes from the platform CSPRNG (256 bits), base64url, 43 characters.
// Only its SHA-256 hash is ever stored or compared; the raw token exists in the creating response and in the link the owner copies.
import { createHash, createHmac, randomBytes } from "crypto";

export { SHARE_DEFAULT_DAYS, SHARE_MAX_ACTIVE, SHARE_MAX_DAYS } from "./shareConstants";
export const SHARE_TOKEN_LENGTH = 43;

export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isWellFormedShareToken(value: unknown): value is string {
  return typeof value === "string" && value.length === SHARE_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The public path. It carries only the token: no document id, number, business id or sequence. */
export function sharePath(token: string): string {
  return `/d/${token}`;
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${sharePath(token)}`;
}

/** Keyed hash of the caller address for the rate-limit table, so a raw IP is never stored. Falls back to a fixed salt if no secret is set. */
export function hashClientIp(ip: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || "ringo-documents-share";
  return createHmac("sha256", key).update(`share_ip:${ip}`, "utf8").digest("hex");
}
