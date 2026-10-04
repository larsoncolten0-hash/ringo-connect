import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { profilePath, seoSiteUrl } from "@/lib/seo";

// Regenerated at most once an hour, not on every request.
export const revalidate = 3600;

// The sitemap protocol allows 50,000 URLs per file. Below that, every public profile is listed; past it
// the list is cut (and logged) rather than serving an invalid file. The framework's way to go beyond it is
// generateSitemaps() with one sitemap per range, and robots.ts listing each.
const SITEMAP_URL_LIMIT = 50000;
const PAGE = 1000; // rows per read (the API's own page size)
const ID_CHUNK = 200; // owner ids per users lookup (keeps the request URL short)

type Reader = ReturnType<typeof createAdminClient>;

/**
 * The usernames a visitor can actually see: published, not a demo, and whose owner is not suspended.
 * Read-only, server-side, and fail CLOSED: a profile is listed only when its owner's status was read and is
 * not "suspended"; any read that fails drops those profiles (never lists them on a guess). Only usernames
 * leave this function.
 */
export async function listPublicUsernames(admin: Reader): Promise<string[]> {
  const rows: { username: string; user_id: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("username, user_id")
      .eq("published", true)
      .eq("is_demo", false)
      .order("username", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("sitemap: profile read failed:", error.message);
      return [];
    }
    rows.push(...((data as any[]) || []).filter((r) => r?.username && r?.user_id));
    if (!data || data.length < PAGE) break;
  }

  const active = new Set<string>();
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from("users").select("id, status").in("id", userIds.slice(i, i + ID_CHUNK));
    if (error) {
      console.error("sitemap: owner status read failed:", error.message);
      continue; // these owners' profiles stay out
    }
    for (const u of (data as any[]) || []) if (u?.id && typeof u.status === "string" && u.status !== "suspended") active.add(u.id);
  }
  return rows.filter((r) => active.has(r.user_id)).map((r) => r.username);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = seoSiteUrl();
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: "weekly", priority: 1 }];
  let usernames: string[] = [];
  try {
    usernames = await listPublicUsernames(createAdminClient());
  } catch (err: any) {
    console.error("sitemap: failed, listing the homepage only:", err?.message);
  }
  if (usernames.length > SITEMAP_URL_LIMIT - 1) {
    console.error(`sitemap: ${usernames.length} profiles exceed the ${SITEMAP_URL_LIMIT}-URL protocol limit; list truncated`);
    usernames = usernames.slice(0, SITEMAP_URL_LIMIT - 1);
  }
  for (const username of usernames) entries.push({ url: `${base}${profilePath(username)}`, changeFrequency: "weekly", priority: 0.6 });
  return entries;
}
