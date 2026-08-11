import { createAdminClient } from "@/lib/supabase/server";
import UserTable from "@/components/admin/UserTable";

export default async function AdminUsersPage() {
  const supabase = createAdminClient();

  const { data: users } = await supabase
    .from("users")
    .select("*, plans(name), profiles(username)")
    .order("created_at", { ascending: false });

  const { data: plans } = await supabase.from("plans").select("*");

  return <UserTable users={users || []} plans={plans || []} />;
}
