import { createAdminClient } from "@/lib/supabase/server";
import UserTable from "@/components/admin/UserTable";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back to a page via the sidebar can
// show stale cached data until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = createAdminClient();

  // "*" already includes can_approve_requests — UserTable's super-creator
  // toggle reads it straight off each row.
  const { data: users } = await supabase
    .from("users")
    .select("*, plans(name), profiles(username)")
    .order("created_at", { ascending: false });

  const { data: plans } = await supabase.from("plans").select("*");

  return <UserTable users={users || []} plans={plans || []} />;
}