import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { listActivity } from "@/lib/loyalty/history";
import ActivityList from "@/components/loyalty/ActivityList";

export const dynamic = "force-dynamic";

export default async function LoyaltyActivityPage() {
  const { profile, can } = await requireLoyaltyPage(["loyalty.scan"]);
  const page = await listActivity(profile.id);
  return <ActivityList initialItems={page.items} initialCursor={page.nextCursor} canReverse={can.reverse} />;
}
