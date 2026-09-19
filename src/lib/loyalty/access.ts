import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getOrgAccess, resolveActiveOrganization } from "@/lib/team/access";
import { isSameOrigin } from "@/lib/customer/session";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// The ONE gate every business-side Loyalty API route goes through (mirrors what
// requireOrgAccessJson does for /api/team, with one deliberate difference: Loyalty is
// available on EVERY plan, so this does NOT require the Team plan).
//
// What it decides, entirely server-side:
//   1. who is calling            -> the Supabase session (never a body field)
//   2. which business they act as -> resolveActiveOrganization: the caller's OWN profile
//                                    or an organization they are an active member of.
//                                    The active-org cookie is only a preference between
//                                    those; access is re-derived below regardless of it.
//   3. whether they may do this   -> getOrgAccess + the loyalty.* permission. Owners and
//                                    platform admins hold every permission; staff hold only
//                                    what an owner explicitly granted to their role.
//
// A route must NEVER read a profile id or customer id from the request for authorization.
// It takes `profile` from the result below.

export type LoyaltyPermission = "loyalty.scan" | "loyalty.manage" | "loyalty.reverse";

export interface LoyaltyProfile {
  id: string;
  name: string | null;
  username: string;
  category: string | null;
  categories: string[] | null;
  currency: string | null;
}

export type LoyaltyAccess =
  | {
      ok: true;
      userId: string;
      profile: LoyaltyProfile;
      isOwner: boolean;
      isAdmin: boolean;
      admin: LoyaltyAdmin;
    }
  | { ok: false; response: NextResponse };

const fail = (error: string, status: number): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

export async function requireLoyaltyAccess(request: Request, permission: LoyaltyPermission): Promise<LoyaltyAccess> {
  // CSRF defence in depth for cookie-authenticated writes (on top of SameSite=Lax).
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return fail("invalid_request", 403);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("not_authenticated", 401);

  const active = await resolveActiveOrganization(user.id);
  if (!active) return fail("not_authorized", 403);

  const access = await getOrgAccess(active.profile.id, user.id);
  if (!access) return fail("not_authorized", 403);

  const allowed = access.isOwner || access.isAdmin || access.hasPermission(permission);
  if (!allowed) return fail("not_authorized", 403);

  const p = active.profile;
  return {
    ok: true,
    userId: user.id,
    profile: {
      id: p.id,
      name: p.name ?? null,
      username: p.username,
      category: p.category ?? null,
      categories: p.categories ?? null,
      currency: p.currency ?? null,
    },
    isOwner: access.isOwner,
    isAdmin: access.isAdmin,
    admin: createAdminClient(),
  };
}

export interface LoyaltyPageAccess {
  userId: string;
  profile: LoyaltyProfile;
  can: { scan: boolean; manage: boolean; reverse: boolean };
}

/**
 * Server-component guard for /dashboard/loyalty/** pages: the same identity rules as
 * requireLoyaltyAccess (the caller's active organization, any plan, loyalty.* permission),
 * but redirecting instead of returning JSON. `anyOf` = the page is allowed if the caller
 * holds AT LEAST ONE of these permissions. The page must still pass `can` down so the UI
 * hides what the caller may not do; the API routes enforce it independently.
 */
export async function requireLoyaltyPage(anyOf: LoyaltyPermission[]): Promise<LoyaltyPageAccess> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const active = await resolveActiveOrganization(user.id);
  if (!active) redirect("/dashboard");

  const access = await getOrgAccess(active.profile.id, user.id);
  if (!access) redirect("/dashboard");

  const holds = (p: LoyaltyPermission) => access.isOwner || access.isAdmin || access.hasPermission(p);
  const can = { scan: holds("loyalty.scan"), manage: holds("loyalty.manage"), reverse: holds("loyalty.reverse") };
  if (!anyOf.some((p) => holds(p))) redirect("/dashboard");

  const p = active.profile;
  return {
    userId: user.id,
    profile: {
      id: p.id,
      name: p.name ?? null,
      username: p.username,
      category: p.category ?? null,
      categories: p.categories ?? null,
      currency: p.currency ?? null,
    },
    can,
  };
}
