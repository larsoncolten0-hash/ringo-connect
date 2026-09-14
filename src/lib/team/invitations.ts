import { randomBytes, createHash } from "crypto";

// Default invitation lifetime — no existing expiration convention to match
// in this codebase (verification requests and signup requests don't
// expire), so this uses the 7 days the product spec suggested.
export const DEFAULT_INVITATION_TTL_DAYS = 7;

/**
 * Generates a cryptographically secure invitation token and its SHA-256
 * hash. The raw token is what goes in the public URL
 * (/team/invite/<token>) and is returned to the caller exactly once — it
 * is never stored, logged, or returned again. Only `tokenHash` is
 * persisted (organization_invitations.token_hash), so a leaked database
 * row can never be turned back into a working invitation link. 32 random
 * bytes, base64url-encoded — carries no database id, organization id, role
 * id, or other internal information, and isn't sequential or guessable.
 */
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiryDate(days: number = DEFAULT_INVITATION_TTL_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function buildInvitationUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";
  return `${base.replace(/\/$/, "")}/team/invite/${token}`;
}
