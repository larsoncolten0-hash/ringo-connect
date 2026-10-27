// Churches & Ministries expansion: the church's FEATURE SWITCHES as the public page sees them (Bible in one year, counselling, giving). Fail-safe: any error, and a database that has not got the table
// yet, gives every feature OFF, so a church page can never break (or show an unfinished feature) because of this.

export interface PublicFeatures {
  bible_year: boolean;
  counselling: boolean;
  giving: boolean;
}
export const NO_FEATURES: PublicFeatures = { bible_year: false, counselling: false, giving: false };

export function shapeFeatures(row: unknown): PublicFeatures {
  if (!row || typeof row !== "object") return NO_FEATURES;
  const r = row as Record<string, unknown>;
  // only an explicit `true` counts
  return { bible_year: r.bible_year === true, counselling: r.counselling === true, giving: r.giving === true };
}

type Reader = { from(table: string): any };

export async function loadPublicFeatures(supabase: Reader, profileId: string): Promise<PublicFeatures> {
  try {
    const { data, error } = await supabase.from("church_features").select("bible_year, counselling, giving").eq("profile_id", profileId).maybeSingle();
    return error ? NO_FEATURES : shapeFeatures(data);
  } catch {
    return NO_FEATURES;
  }
}
