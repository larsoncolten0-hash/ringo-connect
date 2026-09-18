import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/rewards?associationProfileId=... — Owner sees the
// full catalog (active + inactive); an active Partner sees active rewards
// only (all they need to run a redemption tap), matching the RLS split
// between "association_rewards owner write" and "...partner read".
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;
  const { supabase, access } = auth;

  let query = supabase.from("association_rewards").select("*").eq("association_profile_id", associationProfileId);
  if (!access.isOwner && !access.isAdmin) query = query.eq("active", true);

  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ code: "server_error", error: "Could not load rewards." }, { status: 500 });
  return NextResponse.json({ rewards: data });
}

// POST /api/association/rewards — body: { associationProfileId, name,
// description?, pointsCost, sortOrder? }. Owner only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : null;
  const pointsCost = Number(body?.pointsCost);
  const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0;

  if (!associationProfileId || !name || !Number.isFinite(pointsCost) || pointsCost <= 0) {
    return NextResponse.json({ code: "invalid_reward", error: "associationProfileId, a name, and a positive pointsCost are required." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data: reward, error } = await supabase
    .from("association_rewards")
    .insert({ association_profile_id: associationProfileId, name, description, points_cost: pointsCost, sort_order: sortOrder })
    .select("*")
    .single();

  if (error || !reward) return NextResponse.json({ code: "server_error", error: "Could not create this reward." }, { status: 500 });
  return NextResponse.json({ reward });
}
