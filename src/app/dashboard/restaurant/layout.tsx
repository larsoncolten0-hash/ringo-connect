import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import RestaurantTabs from "@/components/restaurant/RestaurantTabs";

export const dynamic = "force-dynamic";

export default async function RestaurantDashboardLayout({ children }: { children: React.ReactNode }) {
  // No permission argument here — the Overview page itself requires none
  // (any active member of a restaurant-category org can reach it), so this
  // layout doesn't either. `access` is what lets RestaurantTabs show only
  // the sub-tabs this specific viewer's role actually has permission for —
  // see that component's own comment.
  const { access } = await requireRestaurantProfile();

  return (
    <div className="max-w-5xl">
      <RestaurantTabs access={access} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
