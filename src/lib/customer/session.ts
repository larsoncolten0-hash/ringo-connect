import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Ringo CUSTOMER sessions — entirely separate from the creator/admin
// Supabase Auth session. A customer is a `ringo_customers` row (see
// supabase/migrations/2026-10-17_ringo_customers_core.sql), never a
// `users`/`profiles` row, and this cookie grants no dashboard access.
//
// The cookie holds a random 32-byte token; only its SHA-256 is stored
// (customer_sessions.token_hash), so a database leak yields no usable
// session. Every lookup goes through the service-role client — there is
// deliberately no anon/authenticated RLS policy on these tables.

const SESSION_DAYS = 90;
const MAX_SESSIONS_PER_CUSTOMER = 20;
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";
// `__Host-` requires Secure + Path=/ + no Domain, all of which hold below.
// Skipped outside production so plain-http localhost still works.
export const CUSTOMER_COOKIE_NAME = isProd ? "__Host-ringo_customer" : "ringo_customer";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type CustomerIdentity = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  preferred_language: "en" | "fr" | null;
  // null = the customer typed this email but has not confirmed it (optional).
  email_verified_at: string | null;
};

export async function createCustomerSession(admin: any, customerId: string, userAgent: string | null) {
  const now = new Date();

  // Housekeeping for this customer only (no cron in Phase 2): drop expired
  // rows, then keep the newest MAX-1 so the insert below lands at the cap.
  await admin.from("customer_sessions").delete().eq("customer_id", customerId).lt("expires_at", now.toISOString());
  const { data: existing } = await admin
    .from("customer_sessions")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const overflow = (existing || []).slice(MAX_SESSIONS_PER_CUSTOMER - 1).map((s: any) => s.id);
  if (overflow.length > 0) await admin.from("customer_sessions").delete().in("id", overflow);

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await admin.from("customer_sessions").insert({
    customer_id: customerId,
    token_hash: hashToken(token),
    user_agent: userAgent ? userAgent.slice(0, 300) : null,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`customer session insert failed: ${error.message}`);

  return { token, expiresAt };
}

export function setCustomerSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set({
    name: CUSTOMER_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearCustomerSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: CUSTOMER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Resolves the signed-in customer from the request cookie, or null. The
 *  customer id ALWAYS comes from here — never from a request body. */
export async function getCustomerFromCookie(): Promise<{ customer: CustomerIdentity; sessionId: string } | null> {
  const token = cookies().get(CUSTOMER_COOKIE_NAME)?.value;
  if (!token || token.length > 200) return null;

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("customer_sessions")
    .select("id, customer_id, expires_at, last_seen_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await admin.from("customer_sessions").delete().eq("id", session.id);
    return null;
  }

  const { data: customer } = await admin
    .from("ringo_customers")
    .select("id, name, email, phone, avatar_url, preferred_language, email_verified_at")
    .eq("id", session.customer_id)
    .maybeSingle();
  if (!customer) return null;

  if (Date.now() - new Date(session.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    await admin.from("customer_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  }

  return { customer: customer as CustomerIdentity, sessionId: session.id };
}

/** Revokes one session (logout) or every session of the customer
 *  ("sign out everywhere"). */
export async function revokeCustomerSessions(admin: any, opts: { sessionId: string } | { customerId: string }) {
  if ("sessionId" in opts) {
    await admin.from("customer_sessions").delete().eq("id", opts.sessionId);
  } else {
    await admin.from("customer_sessions").delete().eq("customer_id", opts.customerId);
  }
}

/** CSRF defence for cookie-authenticated (and code-issuing) POSTs, on top
 *  of SameSite=Lax: the browser-supplied Origin must match this site's own
 *  host. A missing Origin is rejected — browsers always send it on a
 *  cross-origin or same-origin fetch POST. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
