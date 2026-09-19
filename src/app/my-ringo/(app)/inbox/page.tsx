import { requireCustomer } from "@/lib/customer/server";
import { InboxView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

// Empty state only: there is no customer↔business messaging backend yet, and
// the creator/admin support chat is deliberately not connected here.
export default async function MyRingoInboxPage() {
  await requireCustomer();
  return <InboxView />;
}
