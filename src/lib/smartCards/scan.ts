// The public side of a Smart Card QR code (/c/<token>) and the claim step. The token is the only credential.
// Every failure — malformed, unknown, disabled, unreadable — is the SAME "unavailable" outcome, so a response never reveals whether a card exists.
// Rate limiting is the one distinguishable outcome ("limited", HTTP 429 on the API); it carries no information about any token. The limiter fails CLOSED.
import { hashCardToken, hashRateSubject, isWellFormedCardToken } from "./token";

export const SCAN_RATE_WINDOW_SECONDS = 600;
export const SCAN_RATE_MAX = 60;
export const CLAIM_RATE_WINDOW_SECONDS = 600;
export const CLAIM_RATE_MAX_IP = 20;
export const CLAIM_RATE_MAX_USER = 10;

export type ScanOutcome =
  | { kind: "unavailable" }
  | { kind: "limited" }
  | { kind: "unclaimed"; serial: string }
  | { kind: "claimed"; username: string };

export type ClaimOutcome = { kind: "claimed"; serial: string; already: boolean } | { kind: "already_claimed" } | { kind: "profile_not_allowed" } | { kind: "unavailable" } | { kind: "limited" };

async function allowed(admin: any, kind: "scan_ip" | "claim_ip" | "claim_user", subject: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const r = await admin.rpc("smartcard_rate_limit_hit", { p_kind: kind, p_subject_hash: hashRateSubject(kind, subject), p_window_seconds: windowSeconds, p_max: max });
    return !r.error && r.data === true;
  } catch {
    return false;
  }
}

export async function scanCard(admin: any, token: string, ip: string): Promise<ScanOutcome> {
  if (!(await allowed(admin, "scan_ip", ip, SCAN_RATE_WINDOW_SECONDS, SCAN_RATE_MAX))) return { kind: "limited" };
  if (!isWellFormedCardToken(token)) return { kind: "unavailable" };
  try {
    const r = await admin.rpc("smartcard_resolve", { p_token_hash: hashCardToken(token) });
    const d = r?.data as any;
    if (r?.error || !d || typeof d !== "object") return { kind: "unavailable" };
    if (d.status === "unclaimed" && typeof d.serial === "string") return { kind: "unclaimed", serial: d.serial };
    if (d.status === "claimed" && typeof d.username === "string" && d.username) return { kind: "claimed", username: d.username };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The caller (signed-in user) and their own profile id are decided by the route from the SESSION; only the token comes from the browser. */
export async function claimCard(admin: any, args: { token: string; userId: string; profileId: string; ip: string }): Promise<ClaimOutcome> {
  if (!(await allowed(admin, "claim_ip", args.ip, CLAIM_RATE_WINDOW_SECONDS, CLAIM_RATE_MAX_IP))) return { kind: "limited" };
  if (!(await allowed(admin, "claim_user", args.userId, CLAIM_RATE_WINDOW_SECONDS, CLAIM_RATE_MAX_USER))) return { kind: "limited" };
  if (!isWellFormedCardToken(args.token)) return { kind: "unavailable" };
  try {
    const r = await admin.rpc("smartcard_claim", { p_token_hash: hashCardToken(args.token), p_user_id: args.userId, p_profile_id: args.profileId });
    const d = r?.data as any;
    if (r?.error || !d || typeof d !== "object") return { kind: "unavailable" };
    if (d.result === "claimed") return { kind: "claimed", serial: String(d.serial || ""), already: d.already === true };
    if (d.result === "already_claimed") return { kind: "already_claimed" };
    if (d.result === "profile_not_allowed") return { kind: "profile_not_allowed" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
