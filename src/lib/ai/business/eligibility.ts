// Ringo AI x Business Toolkit: whether this owner's PLAN allows the Business Toolkit AI tools and drafts (plans.ai_enabled AND plans.business_toolkit_enabled),
// read with the service client for the server-resolved user only. Fails CLOSED: any error or missing row means "not eligible". Used to decide what the model
// is OFFERED (snapshot) and what a draft may be PREPARED for (draft facts); the real gate is still re-run when a tool runs and when a draft is applied
// (src/lib/ai/business/gate.ts).
import { BOOKKEEPING_CATEGORIES } from "@/lib/bookkeeping/decision";
import { profileHasCategory } from "@/lib/categories";
import { createAdminClient } from "@/lib/supabase/server";

export async function loadToolkitPlanFlags(userId: string): Promise<{ ai: boolean; toolkit: boolean }> {
  try {
    const { data, error } = await createAdminClient().from("users").select("plans(ai_enabled, business_toolkit_enabled)").eq("id", userId).maybeSingle();
    const plan = (data as any)?.plans;
    if (error || !plan) return { ai: false, toolkit: false };
    return { ai: plan.ai_enabled === true, toolkit: plan.business_toolkit_enabled === true };
  } catch {
    return { ai: false, toolkit: false };
  }
}

/** The category part of the Business Toolkit gate (the same list every Toolkit route uses). */
export const categoryHasToolkit = (shape: { category?: string | null; categories?: string[] | null }): boolean =>
  BOOKKEEPING_CATEGORIES.some((c) => profileHasCategory({ category: shape.category ?? null, categories: shape.categories ?? [] } as any, c));

export async function isBusinessToolkitAiEligible(userId: string, shape: { category?: string | null; categories?: string[] | null }): Promise<boolean> {
  if (!categoryHasToolkit(shape)) return false;
  const f = await loadToolkitPlanFlags(userId);
  return f.ai && f.toolkit;
}
