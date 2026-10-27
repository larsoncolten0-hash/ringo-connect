// Churches & Ministries expansion, Phase 7: the giving and care funds as the PUBLIC page may show them. Pure helpers plus a fail-safe loader. No React, no money.
//
// The database already returns a fund only when it is published AND the owner switched giving on (which the application keeps impossible while GIVING_AVAILABLE is false). This file re-checks the shape of
// what it receives. It shows a title, a description and a goal: never an amount received, a donor or a way to pay, because none exists yet. Any failure gives an empty list: a church page can never break
// because of this feature.

export interface PublicFund {
  id: string;
  kind: "giving" | "care";
  title_en: string;
  title_fr: string;
  description_en: string | null;
  description_fr: string | null;
  goal_xaf: number | null;
}

type Row = Record<string, unknown>;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null);

export function shapeFund(r: Row): PublicFund | null {
  if (typeof r.id !== "string" || (r.kind !== "giving" && r.kind !== "care")) return null;
  const en = text(r.title_en, 120), fr = text(r.title_fr, 120);
  if (!en || !fr) return null;
  const goal = typeof r.goal_xaf === "number" && Number.isInteger(r.goal_xaf) && r.goal_xaf > 0 ? r.goal_xaf : null;
  return { id: r.id, kind: r.kind, title_en: en, title_fr: fr, description_en: text(r.description_en, 600), description_fr: text(r.description_fr, 600), goal_xaf: goal };
}

export async function loadPublicFunds(supabase: { from(table: string): any }, profileId: string): Promise<PublicFund[]> {
  try {
    const { data, error } = await supabase
      .from("church_giving_funds")
      .select("id, kind, title_en, title_fr, description_en, description_fr, goal_xaf, is_published")
      .eq("profile_id", profileId)
      .eq("is_published", true)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(40);
    if (error || !Array.isArray(data)) return [];
    return (data as Row[]).map(shapeFund).filter((f): f is PublicFund => f !== null);
  } catch {
    return [];
  }
}
