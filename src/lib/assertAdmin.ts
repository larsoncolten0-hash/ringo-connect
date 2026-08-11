import { createClient } from "@/lib/supabase/server";

/**
 * Verifies the current request is from a logged-in admin. Returns the
 * authenticated user (with role confirmed) or null — callers should
 * respond 403 on null. Every admin-only API route should use this exact
 * check rather than reimplementing it, so there's exactly one place that
 * defines "what counts as an admin."
 */
export async function assertAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (userRow?.role !== "admin") return null;

  return user;
}