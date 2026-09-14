import type { SupabaseClient } from "@supabase/supabase-js";

// Shared thresholds for the admin Users analytics view — kept in one place
// so the query side (admin/page.tsx) and the label side
// (AdminUsersAnalytics.tsx, UserTable.tsx) can't drift apart.
//
// ONLINE_WINDOW_MINUTES: there is no real presence/websocket system in
// this app — this is "active within the last N minutes" using
// users.last_active_at, deliberately wider than the 5-minute write
// throttle in middleware.ts so a genuinely active user's badge doesn't
// flicker between "online" and not purely from write-timing gaps. Always
// labeled in the UI as "Active in the last 15 min," never as "online" on
// its own, so it never implies a live connection that doesn't exist.
export const ONLINE_WINDOW_MINUTES = 15;

// "Daily active" = last_active_at within the last 24 hours.
export const DAILY_ACTIVE_WINDOW_HOURS = 24;

// The self_downgrade audit-log instrumentation (src/app/api/billing/cancel
// /route.ts) ships alongside this feature — there is no reliable signal
// for organic downgrades before this date (billing/cancel wrote no audit
// trail at all until now), so the churn metric this feeds must say so
// rather than imply a complete history. Update this only if that
// instrumentation's ship date actually changes.
export const CHURN_TRACKING_STARTED_AT = "2026-10-11";

/**
 * auth.users.last_sign_in_at per user id, via the admin client's
 * auth.admin.listUsers() (there's no way to join public.users straight to
 * auth.users in a single Postgres query through supabase-js). Paginated
 * defensively — every user fits on one page today, but this won't quietly
 * truncate as the user base grows. Capped at 20 pages (20,000 users) as a
 * safety valve, matching the platform-wide click_events cap admin/analytics
 * already uses for the same reason.
 */
export async function getLastSignInMap(admin: SupabaseClient): Promise<Record<string, string | null>> {
  const map: Record<string, string | null> = {};
  const perPage = 1000;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("getLastSignInMap: listUsers failed:", error.message);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) map[u.id] = u.last_sign_in_at ?? null;
    if (users.length < perPage) break;
  }

  return map;
}
