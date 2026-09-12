import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import RestaurantTabs from "@/components/restaurant/RestaurantTabs";

export const dynamic = "force-dynamic";

export default async function RestaurantDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireRestaurantProfile();

  return (
    <div className="max-w-5xl">
      <RestaurantTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
