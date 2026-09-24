// Supabase implementation of RateLimiter (service-role client; server only). Calls the database
// function commerce_rate_limit_hit(), which counts and records atomically. Only a keyed HMAC of the
// subject (a client IP or a payer phone number) ever leaves this process: the database never sees or
// stores a raw IP or phone number, and the hash cannot be reversed without the server secret.
// The key is derived from SETTINGS_ENCRYPTION_KEY with its own label (same pattern as
// src/lib/customer/codes.ts), so no new environment variable is needed.

import crypto from "crypto";
import { RATE_RULES } from "./constants";
import type { RateLimiter } from "./types";

type Admin = any;

export function hashRateSubject(kind: string, subject: string): string {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) throw new Error("SETTINGS_ENCRYPTION_KEY is not set");
  const key = crypto.createHash("sha256").update(`ringo-commerce-rate-v1:${secret}`).digest();
  return crypto.createHmac("sha256", key).update(`${kind}:${subject.trim().toLowerCase()}`).digest("hex"); // 64 hex chars
}

export function createSupabaseRateLimiter(admin: Admin): RateLimiter {
  return {
    async hit(kind, subject) {
      const rule = RATE_RULES[kind];
      const { data, error } = await admin.rpc("commerce_rate_limit_hit", {
        p_kind: kind,
        p_subject_hash: hashRateSubject(kind, subject),
        p_window_seconds: rule.windowSeconds,
        p_max: rule.max,
      });
      if (error) throw new Error(`commerce_rate_limit_hit failed (${error.code || "error"})`); // caller fails open + logs
      return data === true;
    },
  };
}
