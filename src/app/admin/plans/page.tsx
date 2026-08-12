import { createClient } from "@/lib/supabase/server";
import PlansManager from "@/components/admin/PlansManager";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back to a page via the sidebar can
// show stale cached data until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const supabase = createClient();
  const { data: plans } = await supabase.from("plans").select("*").order("price_usd", { ascending: true });

  return <PlansManager plans={plans || []} />;
}