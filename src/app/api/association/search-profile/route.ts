import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";
import { createAdminClient } from "@/lib/supabase/server";

// GET /api/association/search-profile?associationProfileId=...&q=...
//
// Owner-only lookup used by two separate flows: searching for an existing
// Ringo account to invite as a Partner, and OPTIONALLY searching for one to
// link to a new Member (never required — see association_members.
// linked_profile_id). Read-only, and deliberately returns only non-
// sensitive public fields (id, username, name, avatar_url) — never email,
// phone, or anything else about the matched account.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  const q = (searchParams.get("q") || "").trim();
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });
  if (q.length < 2) return NextResponse.json({ profiles: [] });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;

  // Cross-account lookup — an Owner searching for ANY Ringo user by
  // username/phone, not just their own data — so this uses the
  // service-role client rather than the request-scoped (RLS) one.
  // Justified specifically because requireAssociationAccessJson above
  // already confirmed the caller is a legitimate Association owner before
  // this runs, and only the narrow, non-sensitive fields below are ever
  // returned. Phone numbers in particular are not publicly readable via
  // normal RLS, which is exactly why the admin client is needed here.
  const admin = createAdminClient();

  // Matches by username (ilike, case-insensitive) or by an exact phone
  // number against profile_phone_numbers — a partial phone match isn't
  // useful here (numbers aren't a "search as you type" field the way a
  // username is), so phone only ever matches the full number typed in.
  const [{ data: byUsername }, { data: byPhone }] = await Promise.all([
    admin.from("profiles").select("id, username, name, avatar_url").ilike("username", `%${q}%`).limit(8),
    admin
      .from("profile_phone_numbers")
      .select("profile_id, profiles(id, username, name, avatar_url)")
      .eq("phone_number", q)
      .limit(8),
  ]);

  const results = new Map<string, { id: string; username: string; name: string | null; avatar_url: string | null }>();
  for (const p of byUsername || []) results.set(p.id, p);
  for (const row of byPhone || []) {
    const p = (row as any).profiles;
    if (p) results.set(p.id, p);
  }

  return NextResponse.json({ profiles: Array.from(results.values()).slice(0, 8) });
}
