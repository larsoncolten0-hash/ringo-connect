import type { AiWorkspace } from "@/lib/ai/types";
import type { DraftFacts, SessionDb } from "./types";

// Fresh facts for draft validation, read with the owner's OWN session client
// (RLS) and explicitly scoped to the server-resolved user + profile. Returns
// null when anything can't be read — callers then refuse (fail closed)
// rather than validating against guessed values.

export async function loadDraftFacts(db: SessionDb, workspace: AiWorkspace): Promise<DraftFacts | null> {
  const [profileRes, userRes, productsRes, eventsRes] = await Promise.all([
    db.from("profiles").select("category, categories, currency").eq("id", workspace.profileId).eq("user_id", workspace.userId).maybeSingle(),
    db.from("users").select("plans(max_products)").eq("id", workspace.userId).maybeSingle(),
    db.from("products").select("id", { count: "exact", head: true }).eq("profile_id", workspace.profileId),
    db.from("events").select("id", { count: "exact", head: true }).eq("profile_id", workspace.profileId),
  ]);
  if (profileRes.error || !profileRes.data || userRes.error || productsRes.error || eventsRes.error) {
    const msg = profileRes.error?.message || userRes.error?.message || productsRes.error?.message || eventsRes.error?.message || "profile not found";
    console.error("ai draft facts failed:", msg);
    return null;
  }
  const p = profileRes.data as { category: string | null; categories: string[] | null; currency: string | null };
  const plan = ((userRes.data as any)?.plans || {}) as { max_products?: number | null };
  return {
    category: p.category ?? null,
    categories: Array.isArray(p.categories) ? p.categories : [],
    currency: p.currency || "USD",
    maxProducts: typeof plan.max_products === "number" ? plan.max_products : null,
    productCount: productsRes.count ?? 0,
    eventCount: eventsRes.count ?? 0,
  };
}

/** Everything the owner typed in this conversation — the provenance source for contact details. */
export async function loadOwnerMessages(db: SessionDb, userId: string, conversationId: string): Promise<string[] | null> {
  const { data: conv } = await db.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (!conv) return null;
  const { data, error } = await db
    .from("ai_messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error("ai owner messages failed:", error.message);
    return null;
  }
  return (data || []).map((m: any) => String(m.content || ""));
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
