// Ringo AI x Business Toolkit, Phase A (read tools): the ONE server-side gate every Business Toolkit AI tool passes before it touches any data.
// The model never participates: it supplies no profile id, no user id and no query. A tool is allowed to run only when ALL of these hold, each decided
// on the server from the caller's own session:
//   1. the actor is the profile OWNER (staff are not admitted yet);
//   2. the owner's PLAN has BOTH ai_enabled AND business_toolkit_enabled (read fresh, fails closed: a beta pass for Ringo AI does not stand in for the plan);
//   3. the Business Toolkit's own gate passes (resolveBookkeepingOwner): signed in, owns the profile, not a demo profile, category enabled for the
//      toolkit, plan flag. This is the same gate every Business Toolkit API route uses, so the AI cannot reach anything those routes would refuse;
//   4. that resolved owner IS the AI workspace (same user, same profile).
// The returned owner is the toolkit's own owner object (RLS-scoped client + service client); tools pass it to the EXISTING handlers, which scope every
// query to owner.profile.id themselves. Nothing here reads or writes business data.
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { createAdminClient } from "@/lib/supabase/server";
import type { DocOwner } from "@/lib/documents/handlers";
import type { AiToolContext } from "@/lib/ai/tools/types";

export type BusinessAiRefusal = {
  error: "business_toolkit_not_available";
  reason: "staff_not_supported" | "plan_required" | "not_available" | "workspace_mismatch";
  note: string;
};

const NOTE = "Business tools are not available on this account right now. Tell the user plainly and point them to Subscription for plan details; do not guess any figure.";
const refuse = (reason: BusinessAiRefusal["reason"]): { ok: false; refusal: BusinessAiRefusal } => ({ ok: false, refusal: { error: "business_toolkit_not_available", reason, note: NOTE } });

export async function requireBusinessAi(ctx: Pick<AiToolContext, "workspace">): Promise<{ ok: true; owner: DocOwner } | { ok: false; refusal: BusinessAiRefusal }> {
  const { workspace } = ctx;
  if (workspace.actor.kind !== "owner") return refuse("staff_not_supported");

  try {
    const { data, error } = await createAdminClient().from("users").select("plans(ai_enabled, business_toolkit_enabled)").eq("id", workspace.userId).maybeSingle();
    const plan = (data as any)?.plans;
    if (error || !plan || plan.ai_enabled !== true || plan.business_toolkit_enabled !== true) return refuse("plan_required");
  } catch {
    return refuse("plan_required");
  }

  const access = await resolveBookkeepingOwner();
  if (!access.ok) return refuse("not_available");
  const owner = access.owner as unknown as DocOwner;
  if (owner.userId !== workspace.userId || owner.profile.id !== workspace.profileId) return refuse("workspace_mismatch");
  return { ok: true, owner };
}
