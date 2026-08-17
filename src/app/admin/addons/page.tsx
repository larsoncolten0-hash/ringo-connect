import { createAdminClient } from "@/lib/supabase/server";
import AddonsManager from "@/components/admin/AddonsManager";

export const dynamic = "force-dynamic";

export default async function AdminAddonsPage() {
  const admin = createAdminClient();
  const { data: addons } = await admin.from("addons").select("*").order("sort_order", { ascending: true });

  return <AddonsManager addons={addons || []} />;
}