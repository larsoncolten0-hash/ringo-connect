// Is this signed-in person a STRAY: an account that exists only because they pressed "Continue with Google / Apple"
// without having a Ringo account? Supabase creates an auth user for them (and the signup trigger a bare `users` row,
// never a profile) before our callback can refuse them. Pure and deliberately strict: every condition must hold, and
// anything missing or unreadable means "not a stray", so the answer can only ever lead to a clean-up of a freshly
// made, empty, OAuth-only account. See lib/auth/removeStrayOAuthUser.ts for the one place that acts on it.

/** An account older than this is never treated as a stray: it was not created by the sign-in that is happening now. */
export const STRAY_MAX_AGE_MS = 60_000;

/** Clock skew tolerated for a `created_at` slightly in the future. */
const FUTURE_SKEW_MS = 5_000;

export interface StrayCandidate {
  /** The auth user's identities (their `provider` is all that is read). */
  identities?: ReadonlyArray<{ provider?: string | null } | null> | null;
  /** auth.users.created_at (ISO string). */
  createdAt?: string | null;
  /** public.users.role; anything other than "creator" is never a stray. */
  role?: string | null;
  /** How many profiles the account owns; null = could not be read. */
  profileCount: number | null;
  /** How many payment_transactions rows the account has; null = could not be read. */
  paymentCount: number | null;
  /** Injectable clock for tests. */
  now?: number;
}

export function isStrayOAuthUser(candidate: StrayCandidate): boolean {
  const providers = (candidate.identities ?? []).map((identity) => identity?.provider ?? null);
  // only Google / Apple identities: any email (or other) identity means a real, existing account
  if (providers.length === 0 || !providers.every((provider) => provider === "google" || provider === "apple")) return false;
  // no profile, and no payment record (it cascades, so this is the one table whose rows a delete would destroy)
  if (candidate.profileCount !== 0 || candidate.paymentCount !== 0) return false;
  if (candidate.role !== "creator") return false;
  const created = Date.parse(candidate.createdAt ?? "");
  const now = candidate.now ?? Date.now();
  return Number.isFinite(created) && now - created <= STRAY_MAX_AGE_MS && created - now <= FUTURE_SKEW_MS;
}
