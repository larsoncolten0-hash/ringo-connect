import { NextResponse } from "next/server";
import { requireOrgAccessJson, ensureDefaultRoles } from "@/lib/team/access";
import { sanitizePermissions } from "@/lib/team/permissions";
import { logOrgActivity } from "@/lib/team/activity";

// GET /api/team/roles?profileId=... — every role defined for this
// organization (seeding the category's default templates first if this
// organization has none yet). Any active member can read (needed so
// someone can see their own role's permissions), not just staff.manage
// holders — see "organization_roles read" in the migration.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId);
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data: profile } = await supabase.from("profiles").select("category").eq("id", profileId).maybeSingle();
  await ensureDefaultRoles(profileId, profile?.category, user.id);

  const { data, error } = await supabase
    .from("organization_roles")
    .select("id, key, name, permissions, is_system, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Could not load roles." }, { status: 500 });
  return NextResponse.json({ roles: data });
}

// POST /api/team/roles — creates a custom role. staff.manage (or
// owner/admin) only. A non-owner/admin actor can never create a role with
// a permission they don't hold themselves.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const permissions = sanitizePermissions(body?.permissions);

  if (!profileId || !name) return NextResponse.json({ error: "profileId and a name are required." }, { status: 400 });

  const auth = await requireOrgAccessJson(profileId, "staff.manage");
  if (!auth.ok) return auth.response;
  const { supabase, user, access } = auth;

  if (!access.isOwner && !access.isAdmin) {
    const disallowed = permissions.filter((p) => !access.hasPermission(p));
    if (disallowed.length > 0) {
      return NextResponse.json({ error: `You can't grant permissions you don't have: ${disallowed.join(", ")}` }, { status: 403 });
    }
  }

  const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${Date.now().toString(36)}`.slice(0, 60);

  const { data, error } = await supabase
    .from("organization_roles")
    .insert({ profile_id: profileId, key, name, permissions, is_system: false, created_by: user.id })
    .select("id, key, name, permissions")
    .single();

  if (error) return NextResponse.json({ error: "Could not create the role." }, { status: 500 });

  await logOrgActivity({ profileId, actorUserId: user.id, action: "role_created", details: { roleId: data.id, name, permissions } });

  return NextResponse.json({ role: data });
}
