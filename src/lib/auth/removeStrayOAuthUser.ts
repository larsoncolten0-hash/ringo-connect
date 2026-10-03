import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isStrayOAuthUser } from "./strayOAuthUser";

// The ONE place a stray OAuth-only account is deleted. Called by the Google / Apple callback right after it has
// refused the person and ended their session, so a person who is not a Ringo customer does not leave an auth user
// behind (which would later make the admin "approve request" step fail with "email already registered").
//
// Strictly best-effort and fail-safe: it reads three facts with the service role, deletes only when ALL of the
// guards in isStrayOAuthUser hold, and does nothing (and says why in the log) when any read fails or any guard does
// not hold. A delete that the database refuses (a row elsewhere still references the user) rolls back as one
// transaction; it is logged and the sign-in outcome is unchanged. It never throws.
//
// It does NOT clean up accounts that were created outside the callback (earlier attempts, other routes); those are
// only listed by a read-only query for a person to review.

export type StrayCleanupResult = "deleted" | "skipped" | "unreadable" | "failed";

export type StrayCandidateUser = Pick<User, "id" | "identities" | "created_at">;

export async function removeStrayOAuthUser(admin: SupabaseClient, user: StrayCandidateUser): Promise<StrayCleanupResult> {
  try {
    const [profiles, owner, payments] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      admin.from("users").select("role").eq("id", user.id).maybeSingle(),
      admin.from("payment_transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
    if (profiles.error || owner.error || payments.error) {
      console.error("oauth stray cleanup skipped: a guard could not be read (user not deleted)");
      return "unreadable";
    }
    const stray = isStrayOAuthUser({
      identities: user.identities,
      createdAt: user.created_at,
      role: (owner.data as { role?: string | null } | null)?.role ?? null,
      profileCount: profiles.count ?? null,
      paymentCount: payments.count ?? null,
    });
    if (!stray) return "skipped";

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("oauth stray cleanup failed:", error.message);
      return "failed";
    }
    return "deleted";
  } catch (err) {
    console.error("oauth stray cleanup threw:", err instanceof Error ? err.message : "unknown error");
    return "failed";
  }
}
