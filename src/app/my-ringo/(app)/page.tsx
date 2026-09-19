import { requireCustomer } from "@/lib/customer/server";
import { listActiveConnections } from "@/lib/customer/connections";
import { HomeView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

export default async function MyRingoHomePage() {
  const customer = await requireCustomer();
  const connections = await listActiveConnections(customer.id, 50);
  return <HomeView customer={{ name: customer.name, avatarUrl: customer.avatar_url }} connections={connections} />;
}
