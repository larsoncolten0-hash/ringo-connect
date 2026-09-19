import { requireCustomer } from "@/lib/customer/server";
import { listActiveConnections } from "@/lib/customer/connections";
import { listActivity } from "@/lib/customer/activity";
import { HomeView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

export default async function MyRingoHomePage() {
  const customer = await requireCustomer();
  const [connections, activity] = await Promise.all([
    listActiveConnections(customer.id, 50),
    listActivity({ id: customer.id }, 5),
  ]);
  return <HomeView customer={{ name: customer.name, avatarUrl: customer.avatar_url }} connections={connections} activity={activity} />;
}
