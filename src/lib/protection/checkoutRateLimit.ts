// Ringo Protection — Phase 4 abuse limits. Reuses the EXISTING commerce_rate_limit_hit() database
// function unmodified (it is generic over an arbitrary `kind` text — see
// 2026-11-03_commerce_abuse_protection.sql — Normal Payment's own RATE_RULES are just one caller of
// it), with Protection's own kinds/limits and its own keyed-hash derivation label so a subject's
// hash is never comparable between the two lanes. No schema change.

import crypto from "crypto";

type Admin = any;

export const PROTECTION_RATE_RULES = {
  protection_checkout_ip: { windowSeconds: 600, max: 10 }, // new protection transactions per client IP per 10 min
  protection_pay_ip: { windowSeconds: 600, max: 10 }, // payment prompts per client IP per 10 min
  protection_pay_phone: { windowSeconds: 600, max: 3 }, // prompts to ONE payer number per 10 min
  protection_pay_phone_day: { windowSeconds: 86_400, max: 10 }, // ...and per 24 hours
} as const;
export type ProtectionRateKind = keyof typeof PROTECTION_RATE_RULES;

export interface ProtectionRateLimiter {
  hit(kind: ProtectionRateKind, subject: string): Promise<boolean>;
}

function hashRateSubject(kind: string, subject: string): string {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) throw new Error("SETTINGS_ENCRYPTION_KEY is not set");
  const key = crypto.createHash("sha256").update(`ringo-protection-rate-v1:${secret}`).digest();
  return crypto.createHmac("sha256", key).update(`${kind}:${subject.trim().toLowerCase()}`).digest("hex");
}

export function createProtectionRateLimiter(admin: Admin): ProtectionRateLimiter {
  return {
    async hit(kind, subject) {
      const rule = PROTECTION_RATE_RULES[kind];
      const { data, error } = await admin.rpc("commerce_rate_limit_hit", {
        p_kind: kind,
        p_subject_hash: hashRateSubject(kind, subject),
        p_window_seconds: rule.windowSeconds,
        p_max: rule.max,
      });
      if (error) throw new Error(`commerce_rate_limit_hit failed (${error.code || "error"})`);
      return data === true;
    },
  };
}

/** true = the request may proceed. A missing limiter/subject or a limiter error fails OPEN (logged). */
export async function withinProtectionLimit(
  limiter: ProtectionRateLimiter | undefined,
  log: (event: string, data?: Record<string, unknown>) => void,
  kind: ProtectionRateKind,
  subject: string | null | undefined
): Promise<boolean> {
  if (!limiter || !subject) return true;
  try {
    return await limiter.hit(kind, subject);
  } catch (err) {
    log("protection_rate_limit_error", { kind, error: String((err as Error)?.message || err).slice(0, 120) });
    return true;
  }
}
