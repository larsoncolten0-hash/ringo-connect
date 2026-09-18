import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// PATCH /api/association/rewards/[id] — body: { associationProfileId, name?,
// description?, pointsCost?, active?, sortOrder? }. Owner only.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const associationProfileId = body?.associationProfileId as string | undefined;
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (typeof body?.description === "string") patch.description = body.description.trim().slice(0, 500) || null;
  if (Number.isFinite(Number(body?.pointsCost)) && Number(body.pointsCost) > 0) patch.points_cost = Number(body.pointsCost);
  if (typeof body?.active === "boolean") patch.active = body.active;
  if (Number.isFinite(Number(body?.sortOrder))) patch.sort_order = Number(body.sortOrder);

  const { data: updated, error } = await supabase
    .from("association_rewards")
    .update(patch)
    .eq("id", params.id)
    .eq("association_profile_id", associationProfileId)
    .select("*")
    .single();

  if (error || !updated) return NextResponse.json({ code: "server_error", error: "Could not update this reward." }, { status: 500 });
  return NextResponse.json({ reward: updated });
}

// DELETE /api/association/rewards/[id]?associationProfileId=... — Owner
// only. A reward already redeemed keeps its row in
// association_point_transactions regardless (reward_id there has no ON
// DELETE CASCADE from this table's perspective — it's a plain FK, so this
// only removes the catalog entry, never rewrites history)... except a plain
// FK with no explicit ON DELETE action defaults to RESTRICT, meaning a
// reward that's ever been redeemed can't be deleted at all. That's treated
// as correct here, not a bug: deactivating (active: false, via PATCH above)
// is the intended way to retire a reward that has real redemption history;
// DELETE is only ever expected to succeed for a reward nobody has redeemed
// yet.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { error } = await supabase.from("association_rewards").delete().eq("id", params.id).eq("association_profile_id", associationProfileId);
  if (error) {
    return NextResponse.json(
      { code: "reward_has_history", error: "Could not delete this reward — it may already have redemptions on record. Deactivate it instead." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
