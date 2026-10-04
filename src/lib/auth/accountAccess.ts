// The one place that answers "may this signed-in person use Ringo?" after a successful sign-in, shared by the
// email-and-password route (/api/auth/login) and the Google / Apple callback (/auth/callback), so a suspended
// account is refused identically whichever way it signed in. Reads the person's own `users` row through the
// caller's session client (the same read the login route always made); it changes nothing.

export interface AccountAccess {
  /** a `users` row exists for this auth user */
  found: boolean;
  /** "admin" or "creator" (creator when the row has no role) */
  role: string;
  /** users.status === "suspended" */
  suspended: boolean;
}

export async function loadAccountAccess(supabase: { from: (table: string) => any }, userId: string): Promise<AccountAccess> {
  const { data: userRow } = await supabase.from("users").select("role, status").eq("id", userId).single();
  return { found: !!userRow, role: userRow?.role || "creator", suspended: userRow?.status === "suspended" };
}
