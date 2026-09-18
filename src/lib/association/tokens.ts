import { randomBytes, createHash } from "crypto";

// Deliberately a small, standalone duplicate of the same idea in
// src/lib/team/invitations.ts, not a shared import from it — this feature
// is meant to be genuinely isolated (see the migration's own header), and a
// few lines of identical crypto plumbing is cheaper than coupling
// Association's security-sensitive token handling to a file owned by an
// unrelated feature.

export const DEFAULT_INVITATION_TTL_DAYS = 7;

/**
 * Generates a cryptographically secure token and its SHA-256 hash. The raw
 * token is returned to the caller exactly once (it goes in a URL shown/sent
 * once) and is never stored — only `hash` is persisted, so a leaked
 * database row can never be turned back into a working link. Used for both
 * association_invitations.token_hash and association_members.access_token_hash.
 */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiryDate(days: number = DEFAULT_INVITATION_TTL_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function buildInvitationUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";
  return `${base.replace(/\/$/, "")}/association/invite/${token}`;
}

export function buildMemberViewUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";
  return `${base.replace(/\/$/, "")}/association/member/${token}`;
}
