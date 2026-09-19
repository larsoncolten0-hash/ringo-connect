import crypto from "crypto";

// Passwordless email codes for Ringo customers. Verification itself is
// done atomically inside Postgres (customer_verify_login_code: row lock,
// attempt counting, single use) — this file only generates/hashes codes,
// applies the issuing-side rate limits, and calls that function.

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
const MAX_CODES_PER_IP_PER_HOUR = 20;

function secret(): string {
  const s = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!s) throw new Error("SETTINGS_ENCRYPTION_KEY is not set — required to hash customer login codes.");
  return s;
}

function hmac(label: string, value: string) {
  const key = crypto.createHash("sha256").update(`ringo-customer-v1:${label}:${secret()}`).digest();
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

/** Keyed hash so a leaked codes table can't be brute-forced offline (only
 *  1,000,000 possible codes). Bound to the email so a hash isn't reusable
 *  across accounts. */
export function hashLoginCode(email: string, code: string) {
  return hmac("code", `${email}:${code}`);
}

export function hashIp(ip: string) {
  return hmac("ip", ip);
}

export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return headers.get("x-real-ip") || null;
}

export function generateLoginCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export type StartLimit = "ok" | "cooldown" | "email_hourly" | "ip_hourly";

/** Issuing-side limits. Deliberately approximate (count-then-insert) — the
 *  security-critical, race-sensitive part (guess counting) lives in the
 *  database function, not here. */
export async function checkStartRateLimits(admin: any, email: string, ipHash: string | null): Promise<StartLimit> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: recent } = await admin
    .from("customer_login_codes")
    .select("created_at")
    .eq("email", email)
    .gte("created_at", hourAgo)
    .order("created_at", { ascending: false });

  const codes = recent || [];
  if (codes.length > 0 && Date.now() - new Date(codes[0].created_at).getTime() < RESEND_COOLDOWN_MS) return "cooldown";
  if (codes.length >= MAX_CODES_PER_EMAIL_PER_HOUR) return "email_hourly";

  if (ipHash) {
    const { count } = await admin
      .from("customer_login_codes")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", hourAgo);
    if ((count || 0) >= MAX_CODES_PER_IP_PER_HOUR) return "ip_hourly";
  }
  return "ok";
}

export async function issueLoginCode(
  admin: any,
  input: {
    email: string;
    ipHash: string | null;
    language: "en" | "fr";
    // null for a plain sign-in code (My Ringo sign-in has no profile/form).
    name: string | null;
    phone: string | null;
    profileId: string | null;
    marketingConsent: boolean;
    source: string;
  }
): Promise<{ ok: true; code: string } | { ok: false }> {
  // Only one live code per email (partial unique index) — retire any
  // previous one first, so an older code can never be replayed.
  await admin
    .from("customer_login_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("email", input.email)
    .is("consumed_at", null);

  const code = generateLoginCode();
  const { error } = await admin.from("customer_login_codes").insert({
    email: input.email,
    code_hash: hashLoginCode(input.email, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    ip_hash: input.ipHash,
    language: input.language,
    pending_name: input.name,
    pending_phone: input.phone,
    pending_profile_id: input.profileId,
    pending_marketing_consent: input.marketingConsent,
    pending_source: input.source,
  });
  if (error) {
    console.error("issueLoginCode insert failed:", error.message);
    return { ok: false };
  }

  // Opportunistic cleanup of long-dead codes (no cron in Phase 2).
  await admin
    .from("customer_login_codes")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not("consumed_at", "is", null);

  return { ok: true, code };
}

export type VerifiedCode = {
  pendingName: string | null;
  pendingPhone: string | null;
  pendingProfileId: string | null;
  pendingMarketingConsent: boolean;
  pendingSource: string | null;
  language: "en" | "fr" | null;
};

/** Atomic check + consume via the database function. Returns null for ANY
 *  failure (wrong, expired, used, locked out) — callers must not
 *  distinguish between them. */
export async function verifyLoginCode(admin: any, email: string, code: string): Promise<VerifiedCode | null> {
  const { data, error } = await admin.rpc("customer_verify_login_code", {
    p_email: email,
    p_code_hash: hashLoginCode(email, code),
  });
  if (error) {
    console.error("customer_verify_login_code failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    pendingName: row.out_pending_name ?? null,
    pendingPhone: row.out_pending_phone ?? null,
    pendingProfileId: row.out_pending_profile_id ?? null,
    pendingMarketingConsent: row.out_pending_marketing_consent === true,
    pendingSource: row.out_pending_source ?? null,
    language: row.out_language ?? null,
  };
}
