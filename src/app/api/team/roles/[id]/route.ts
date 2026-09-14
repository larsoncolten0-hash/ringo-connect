import { NextResponse } from "next/server";
import { requireOrgAccessJson } from "@/lib/team/access";
import { sanitizePermissions } from "@/lib/team/permissions";
import { logOrgActivity } from "@/lib/team/activity";

// PATCH /api/team/roles/[id] — body: { profileId, name?, permissions? }.
// Renames and/or re-permissions a role (template-seeded or custom — both
// are editable). staff.manage (or owner/admin) only; a non-owner/admin
// actor can never add a permission they don't hold themselves (they CAN
// still remove permissions from a role, including ones they don't
// personally have, since that only ever narrows access).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : undefined;
  const permissions = body?.permissions !== undefined ? sanitizePermissions(body.permissions) : undefined;
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.manage");
  if (!auth.ok) return auth.response;
  const { supabase, user, access } = auth;

  const { data: role } = await supabase.from("organization_roles").select("id, permissions").eq("id", params.id).eq("profile_id", profileId).maybeSingle();
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });

  if (permissions && !access.isOwner && !access.isAdmin) {
    const added = permissions.filter((p) => !(role.permissions || []).includes(p));
    const disallowed = added.filter((p) => !access.hasPermission(p));
    if (disallowed.length > 0) {
      return NextResponse.json({ error: `You can't grant permissions you don't have: ${disallowed.join(", ")}` }, { status: 403 });
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name) update.name = name;
  if (permissions) update.permissions = permissions;

  const { error } = await supabase.from("organization_roles").update(update).eq("id", role.id);
  if (error) return NextResponse.json({ error: "Could not update the role." }, { status: 500 });

  await logOrgActivity({ profileId, actorUserId: user.id, action: "role_updated", details: { roleId: role.id, name, permissions } });

  return NextResponse.json({ ok: true });
}

// DELETE /api/team/roles/[id]?profileId=... — refuses to delete a role
// currently assigned to any member, so a deletion can never silently strip
// someone's access mid-session — the owner must reassign those members to
// a different role first.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data: role } = await supabase.from("organization_roles").select("id, name").eq("id", params.id).eq("profile_id", profileId).maybeSingle();
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });

  const { count } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("role_id", role.id)
    .neq("status", "removed");
  if ((count || 0) > 0) {
    return NextResponse.json({ error: "Reassign the members using this role before deleting it." }, { status: 400 });
  }

  const { error } = await supabase.from("organization_roles").delete().eq("id", role.id);
  if (error) return NextResponse.json({ error: "Could not delete the role." }, { status: 500 });

  await logOrgActivity({ profileId, actorUserId: user.id, action: "role_deleted", details: { roleId: role.id, name: role.name } });

  return NextResponse.json({ ok: true });
}
