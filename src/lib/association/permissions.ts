import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAssociationCaps } from "@/lib/association/access";

// Server-side authorization for the new /api/associations/[associationId]/** routes (Phase B1).
//
// Association-scoped only: it never consults global admin or Team roles. The caller's permission is
// resolved BY THE DATABASE for the SESSION user (auth.uid() inside has_association_permission /
// association_staff_role, called through the user-scoped client), never from anything in the request.
// The returned user id is the ONLY value routes may pass as p_actor.

export type AssociationPerm = "staff" | "settings.manage" | "plans.manage" | "memberships.view" | "memberships.manage" | "audit.view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

type Admin = ReturnType<typeof createAdminClient>;

export interface AssociationAuthOk {
  ok: true;
  user: { id: string };
  admin: Admin;
  association: { id: string; host_profile_id: string; legacy_profile_id: string | null; config: Record<string, unknown> };
}
export type AssociationAuthResult = AssociationAuthOk | { ok: false; response: NextResponse };

const fail = (code: string, status: number): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ code }, { status }),
});

export async function requireAssociationPermission(associationId: string, perm: AssociationPerm): Promise<AssociationAuthResult> {
  if (!isUuid(associationId)) return fail("association_not_found", 404);

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("not_authenticated", 401);

  const admin = createAdminClient();
  const { data: association } = await admin
    .from("associations")
    .select("id, host_profile_id, legacy_profile_id, config")
    .eq("id", associationId)
    .maybeSingle();
  if (!association) return fail("association_not_found", 404);

  let allowed = false;
  if (perm === "staff") {
    const { data } = await supabase.rpc("association_staff_role", { p_association_id: associationId });
    allowed = !!data;
  } else {
    const check = async (p: string) => (await supabase.rpc("has_association_permission", { p_association_id: associationId, p_permission: p })).data === true;
    allowed = (await check(perm)) || (perm === "memberships.view" && (await check("memberships.manage")));
  }
  if (!allowed) return fail("permission_denied", 403);

  // same plan gate the legacy routes use: a lapsed Association plan switches the module off
  const caps = await getAssociationCaps(association.host_profile_id);
  if (!caps.enabled) return fail("association_disabled", 403);

  return {
    ok: true,
    user: { id: user.id },
    admin,
    association: {
      id: association.id,
      host_profile_id: association.host_profile_id,
      legacy_profile_id: association.legacy_profile_id,
      config: (association.config as Record<string, unknown>) || {},
    },
  };
}
