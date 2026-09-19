// Demo/test capabilities (the Partner demo card-code lookup, demo-to-demo Partner invitations) are valid ONLY for
// a profile that is BOTH flagged demo AND still inside its demo window. This is the single definition of that rule.
//
// Fails closed on every doubtful input: a flag that is not exactly boolean true, a missing/empty/unparseable
// expiry, or an expiry that is not strictly in the future all mean "not an active demo profile".
//
// `now` is always the SERVER's clock (never anything from the request). The columns themselves can only be written
// by the trusted server role (see supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql).
export interface DemoFlags {
  is_demo?: unknown;
  demo_expires_at?: unknown;
}

export function isActiveDemoProfile(profile: DemoFlags | null | undefined, now: Date = new Date()): boolean {
  if (!profile || profile.is_demo !== true) return false;
  if (typeof profile.demo_expires_at !== "string" || profile.demo_expires_at.trim() === "") return false;
  const expires = Date.parse(profile.demo_expires_at);
  return Number.isFinite(expires) && expires > now.getTime();
}
