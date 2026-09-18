import { NextResponse } from "next/server";
import { requireAssociationAccessJson, countActiveAssociationMembers } from "@/lib/association/access";
import { generateToken, buildMemberViewUrl } from "@/lib/association/tokens";

// GET /api/association/members?associationProfileId=... — every Member,
// newest first. Owner only — see the migration's own note on why Partners
// never get a blanket read policy on this table.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("association_members")
    .select("id, name, phone, linked_profile_id, points_balance, status, created_at, profiles!association_members_linked_profile_id_fkey(username, name, avatar_url)")
    .eq("association_profile_id", associationProfileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ code: "server_error", error: "Could not load Members." }, { status: 500 });
  return NextResponse.json({ members: data });
}

// POST /api/association/members — body: { associationProfileId, name,
// phone?, linkedProfileId? }. linkedProfileId is entirely OPTIONAL and
// never required — most Members will have it null (see the migration's own
// note: this is a new, lightweight identity, never a copy of an existing
// profiles/users row). A physical card is bound separately, via
// /api/association/members/[id]/card, once this row exists.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : null;
  const linkedProfileId = typeof body?.linkedProfileId === "string" ? body.linkedProfileId : null;

  if (!associationProfileId || !name) {
    return NextResponse.json({ error: "associationProfileId and a name are required." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Soft-block only, per the product decision — never a hard/silent
  // failure. `member_limit_reached` is the code the UI must map to a
  // message offering BOTH resolutions from that decision (upgrade to the
  // next tier, or contact support about extra slots) — never framed as
  // "remove someone first," which isn't one of the agreed options.
  const maxMembers = auth.access.caps.maxMembers;
  if (maxMembers != null) {
    const activeCount = await countActiveAssociationMembers(associationProfileId);
    if (activeCount >= maxMembers) {
      return NextResponse.json(
        { code: "member_limit_reached", error: `You've reached your plan's Member limit (${maxMembers}).` },
        { status: 403 }
      );
    }
  }

  if (linkedProfileId) {
    const { data: targetProfile } = await supabase.from("profiles").select("id").eq("id", linkedProfileId).maybeSingle();
    if (!targetProfile) return NextResponse.json({ code: "profile_not_found", error: "That Ringo profile couldn't be found." }, { status: 404 });
  }

  const { token, hash } = generateToken();

  const { data: member, error } = await supabase
    .from("association_members")
    .insert({
      association_profile_id: associationProfileId,
      name,
      phone,
      linked_profile_id: linkedProfileId,
      access_token_hash: hash,
    })
    .select("*")
    .single();

  if (error || !member) {
    if ((error as any)?.code === "23505") {
      return NextResponse.json({ code: "already_linked", error: "That Ringo profile is already linked to a Member here." }, { status: 409 });
    }
    console.error("association_members insert failed:", error?.message);
    return NextResponse.json({ code: "server_error", error: "Could not create this Member." }, { status: 500 });
  }

  // The raw token is returned here and ONLY here — like an invitation link,
  // it is never stored (only its hash is), so this response is the one and
  // only moment the Owner can copy/share this Member's personal view link.
  return NextResponse.json({ member, memberViewUrl: buildMemberViewUrl(token) });
}
