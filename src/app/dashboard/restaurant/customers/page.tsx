import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import CustomersView from "@/components/restaurant/CustomersView";

export const dynamic = "force-dynamic";

export default async function RestaurantCustomersPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const { data: customers } = await supabase
    .from("restaurant_customers")
    .select("*, customer_marketing_consent(opted_in)")
    .eq("profile_id", profile.id)
    .order("last_order_at", { ascending: false, nullsFirst: false });

  return <CustomersView customers={customers || []} currency={profile.currency || "USD"} />;
}
