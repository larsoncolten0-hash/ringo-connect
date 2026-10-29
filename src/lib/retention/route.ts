import { NextResponse } from "next/server";
import { requireLoyaltyAccess, type LoyaltyPermission } from "@/lib/loyalty/access";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { createAdminClient } from "@/lib/supabase/server";
import type { Db, PromoCtx, Result } from "./promotions";

// The two entry points of the Phase 3 retention routes.
//   * the BUSINESS side goes through the same gate as every Loyalty route (requireLoyaltyAccess): the signed-in user, the organization they act for, and a loyalty.* permission, checked on the
//     server. Nothing identifies the business in the request.
//   * the CUSTOMER side goes through the My Ringo cookie only (never a customer id from the request) and a same-origin check for writes.
// Responses are never cached; an unexpected failure is never echoed.

const MAX_BODY_CHARS = 4_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return { ok: false, res: json({ ok: false, error: "invalid_body" }, 413) };
    return { ok: true, body: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, res: json({ ok: false, error: "invalid_body" }, 400) };
  }
}

export async function loyaltyRoute(request: Request, permission: LoyaltyPermission, opts: { body: boolean }, fn: (ctx: PromoCtx, body: unknown) => Promise<Result>): Promise<NextResponse> {
  const access = await requireLoyaltyAccess(request, permission);
  if (!access.ok) return access.response;
  let body: unknown = null;
  if (opts.body) {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.res;
    body = parsed.body;
  }
  try {
    const r = await fn({ admin: access.admin as unknown as Db, userId: access.userId, profile: access.profile }, body);
    return json(r.body, r.status);
  } catch {
    console.error(JSON.stringify({ scope: "retention", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}

export interface CustomerCtx {
  customer: { id: string; name: string; email: string; phone: string | null; email_verified_at: string | null };
  db: Db;
}

export async function customerRoute(request: Request, opts: { write: boolean; body?: boolean }, fn: (ctx: CustomerCtx, body: unknown) => Promise<Result>): Promise<NextResponse> {
  if (opts.write && !isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  const session = await getCustomerFromCookie();
  if (!session) return json({ ok: false, error: "not_signed_in" }, 401);
  let body: unknown = null;
  if (opts.body) {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.res;
    body = parsed.body;
  }
  try {
    const r = await fn({ customer: session.customer, db: createAdminClient() as unknown as Db }, body);
    return json(r.body, r.status);
  } catch {
    console.error(JSON.stringify({ scope: "retention", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
