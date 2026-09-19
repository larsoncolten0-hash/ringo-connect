import { requireCustomer } from "@/lib/customer/server";
import { listActivity } from "@/lib/customer/activity";
import ActivityView from "@/components/my-ringo/ActivityView";

export const dynamic = "force-dynamic";

// Read-only history aggregated from the authoritative records (connections,
// music orders, restaurant orders, bookings) that belong to the signed-in
// customer — no separate activity table.
export default async function MyRingoActivityPage() {
  const customer = await requireCustomer();
  const items = await listActivity({ id: customer.id });
  return <ActivityView items={items} />;
}
