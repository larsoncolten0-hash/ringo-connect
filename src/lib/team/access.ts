import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/team/permissions";
import { getRoleTemplatesForCategory } from "@/lib/team/permissions";

// Non-sensitive UX preference only — which organization's workspace to
// render when someone belongs to more than one. Never used as an
// authorization check by itself: every page/route that reads it still goes
// through requireOrgAccess/has_org_permission below, which re-derive access
// from auth.uid() + organization_members, never from this cookie's value.
const ACTIVE_ORG_COOKIE = "ringo_active_org";

export function getActiveOrgCookie(): string | null {
  return cookies().get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

export interface OrgMembership {
  profile: any;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: Permission[];
}

/**
 * Every organization the signed-in user can act inside: their own owned
 * profile (if any) plus every organization they have an active membership
 * in. Uses the request-scoped (RLS-protected) client — a member only ever
 * sees rows RLS already allows them to see, so this can never leak another
 * organization's data.
 */
export async function listUserOrganizations(userId: string): Promise<OrgMembership[]> {
  const supabase = createClient();
  const results: OrgMembership[] = [];

  const { data: ownProfile } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (ownProfile) {
    results.push({ profile: ownProfile, isOwner: true, roleId: null, roleName: "Owner", permissions: [] });
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("profile_id, role_id, profiles(*), organization_roles(id, name, permissions)")
    .eq("user_id", userId)
    .eq("status", "active");

  for (const m of memberships || []) {
    const profile = (m as any).profiles;
    const role = (m as any).organization_roles;
    if (!profile || !role) continue;
    results.push({
      profile,
      isOwner: false,
      roleId: role.id,
      roleName: role.name,
      permissions: (role.permissions || []) as Permission[],
    });
  }

  return results;
}

/**
 * Picks which organization to render as "active" — honors the cookie when
 * it points at an organization the user actually has access to, otherwise
 * falls back to their own owned profile, otherwise their first membership.
 * Returns null if the user has no organization at all (brand-new account,
 * no profile yet — shouldn't happen given the signup trigger, but never
 * assumed).
 */
export async function resolveActiveOrganization(userId: string): Promise<OrgMembership | null> {
  const orgs = await listUserOrganizations(userId);
  return pickActiveOrganization(orgs);
}

/**
 * Given a user's full organization list (see listUserOrganizations),
 * decides which one is "active" — split out from resolveActiveOrganization
 * so a caller that already fetched the list (e.g. dashboard/layout.tsx,
 * which also needs it for the organization switcher) doesn't have to
 * re-query just to apply the same selection rule.
 */
export function pickActiveOrganization(orgs: OrgMembership[]): OrgMembership | null {
  if (orgs.length === 0) return null;
  const preferred = getActiveOrgCookie();
  if (preferred) {
    const match = orgs.find((o) => o.profile.id === preferred);
    if (match) return match;
  }
  return orgs.find((o) => o.isOwner) ?? orgs[0];
}

/**
 * Creates the category's default role templates for an organization the
 * first time it needs one (opening Team for the first time, or generating
 * the first invitation) — a one-time, idempotent seed. Uses the
 * service-role client since this runs before any organization_members row
 * for this org's staff.manage holder necessarily exists yet, and because
 * seeding roles isn't itself a caller-permission-gated action (the calling
 * route/page has already verified the caller is the owner/admin/staff.manage
 * holder before reaching here).
 */
export async function ensureDefaultRoles(profileId: string, category: string | null | undefined, createdBy: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("organization_roles").select("id").eq("profile_id", profileId).limit(1);
  if (existing && existing.length > 0) return;

  const templates = getRoleTemplatesForCategory(category);
  if (templates.length === 0) return;

  await admin.from("organization_roles").insert(
    templates.map((t) => ({
      profile_id: profileId,
      key: t.key,
      name: t.name,
      permissions: t.permissions,
      is_system: true,
      created_by: createdBy,
    }))
  );
}

export interface OrgAccess {
  isOwner: boolean;
  isAdmin: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: Set<Permission>;
  hasPermission: (p: Permission) => boolean;
}

/**
 * Resolves the signed-in user's access to a specific organization
 * (`profileId`) — owner, platform admin, or an active member with their
 * role's permissions. Returns null when the user has no access at all
 * (no owned profile match, no active membership row). This mirrors exactly
 * what has_org_permission() checks in RLS — kept as a separate,
 * independent implementation deliberately (not a wrapper that trusts a
 * client-supplied role/permission list), so an API route can make its own
 * server-side decision (e.g. "which fields to return") without relying on
 * RLS alone.
 */
export async function getOrgAccess(profileId: string, userId: string): Promise<OrgAccess | null> {
  const supabase = createClient();

  const { data: userRow } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  const isAdmin = userRow?.role === "admin";

  const { data: profile } = await supabase.from("profiles").select("id, user_id").eq("id", profileId).maybeSingle();
  const isOwner = !!profile && profile.user_id === userId;

  if (isOwner || isAdmin) {
    const allPermissions = new Set<Permission>();
    return {
      isOwner,
      isAdmin,
      roleId: null,
      roleName: isOwner ? "Owner" : "Admin",
      permissions: allPermissions,
      hasPermission: () => true,
    };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role_id, organization_roles(id, name, permissions)")
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  const role = (membership as any)?.organization_roles;
  if (!membership || !role) return null;

  const permissions = new Set<Permission>((role.permissions || []) as Permission[]);
  return {
    isOwner: false,
    isAdmin: false,
    roleId: role.id,
    roleName: role.name,
    permissions,
    hasPermission: (p) => permissions.has(p),
  };
}

/**
 * The generic, category-agnostic guard every /dashboard/team page and API
 * route uses: resolves the caller and their access to `profileId`,
 * redirecting to /dashboard when there's no access at all or the specific
 * `permission` requested is missing. Category-specific guards (e.g.
 * requireRestaurantProfile) build on top of this rather than duplicating
 * the resolution logic — see src/lib/restaurantAuth.ts.
 */
export async function requireOrgAccess(profileId: string, permission?: Permission) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const access = await getOrgAccess(profileId, user.id);
  if (!access) redirect("/dashboard");
  if (permission && !access.isOwner && !access.isAdmin && !access.hasPermission(permission)) redirect("/dashboard");

  return { supabase, user, access };
}

export type OrgAccessJsonResult =
  | { ok: true; supabase: ReturnType<typeof createClient>; user: { id: string }; access: OrgAccess }
  | { ok: false; response: NextResponse };

/**
 * Same resolution as requireOrgAccess, but for JSON API routes: returns a
 * ready-to-return NextResponse (401/403) instead of redirecting, so every
 * /api/team/* route gets identical, correct status codes for "not signed
 * in" vs. "signed in but not authorized" without each route re-deriving
 * this logic (and without the risk of a shared mutable/module-level
 * variable across concurrent requests).
 */
export async function requireOrgAccessJson(profileId: string, permission?: Permission): Promise<OrgAccessJsonResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };

  const access = await getOrgAccess(profileId, user.id);
  if (!access) return { ok: false, response: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  if (permission && !access.isOwner && !access.isAdmin && !access.hasPermission(permission)) {
    return { ok: false, response: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }

  return { ok: true, supabase, user, access };
}
