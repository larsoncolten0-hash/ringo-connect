// Powers the small "needs your attention" badges on AdminShell's nav —
// both its initial server-rendered value (admin/layout.tsx) and its
// polling refresh (src/app/api/admin/nav-counts/route.ts) share this one
// function so the two can never quietly drift apart, same pattern as
// src/lib/support.ts / src/lib/verification.ts.
//
// Each count answers "how many of these does an admin still need to act
// on," not "how many exist total" — e.g. affiliate/music payouts use
// status = 'requested' (a submitted request awaiting review), not
// 'processing'/'paid'/'rejected', matching the same default filter
// AdminAffiliatesView.tsx/AdminMusicPayoutsView.tsx themselves open on.
export type AdminNavCounts = {
  requests: number;
  support: number;
  verification: number;
  affiliates: number;
  musicPayouts: number;
};

export async function getAdminNavCounts(admin: any): Promise<AdminNavCounts> {
  const [
    { count: requests },
    { data: conversations },
    { count: verification },
    { count: affiliates },
    { count: musicPayouts },
  ] = await Promise.all([
    admin.from("signup_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    // Just the two timestamps needed to judge "unread for admin" (same
    // rule listAdminConversations() uses) — not the full shaped list
    // src/lib/support.ts returns, since this only needs a count.
    admin.from("support_conversations").select("last_message_at, admin_last_read_at"),
    admin.from("verification_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("affiliate_payouts").select("id", { count: "exact", head: true }).eq("status", "requested"),
    admin.from("music_payouts").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);

  const support = (conversations || []).filter(
    (c: any) => !c.admin_last_read_at || new Date(c.last_message_at) > new Date(c.admin_last_read_at)
  ).length;

  return {
    requests: requests || 0,
    support,
    verification: verification || 0,
    affiliates: affiliates || 0,
    musicPayouts: musicPayouts || 0,
  };
}
