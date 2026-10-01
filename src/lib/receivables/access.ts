// Whether the Phase 3 database objects exist on this platform, so the Debtors tab is hidden (not half-working) until the migration is applied.
// UX only: the API routes and the database functions enforce access themselves, and answer 503 "receivables_unavailable" before the migration.
export async function receivablesAvailable(owner: { admin: any; profile: { id: string } }): Promise<boolean> {
  try {
    const { error } = await owner.admin.from("bk_reminders").select("id", { head: true, count: "exact" }).eq("profile_id", owner.profile.id).limit(1);
    return !error;
  } catch {
    return false;
  }
}
