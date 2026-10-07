import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminWatchdogView, { type WatchdogRow } from "@/components/admin/AdminWatchdogView";

// A live incident feed: never a stale cache. Every /admin/* route is already restricted to admins by admin/layout.tsx, and this page checks again (a layout is not a
// security boundary on its own); the table itself is readable by admins only.
export const dynamic = "force-dynamic";

const LIMIT = 100;

export default async function AdminWatchdogPage() {
  const admin = await assertAdmin();
  if (!admin) redirect("/admin");

  const { data } = await createAdminClient()
    .from("watchdog_events")
    .select("id, created_at, rule_code, severity, event_type, subject_user_id, params, status, acknowledged_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return <AdminWatchdogView rows={(data || []) as WatchdogRow[]} limit={LIMIT} />;
}
