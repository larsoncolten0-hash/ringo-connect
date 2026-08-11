import { createClient } from "@/lib/supabase/server";
import PlansManager from "@/components/admin/PlansManager";

export default async function AdminPlansPage() {
  const supabase = createClient();
  const { data: plans } = await supabase.from("plans").select("*").order("price_usd", { ascending: true });

  return <PlansManager plans={plans || []} />;
}