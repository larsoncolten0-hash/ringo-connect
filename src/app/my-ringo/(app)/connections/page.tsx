import { requireCustomer } from "@/lib/customer/server";
import { listActiveConnections } from "@/lib/customer/connections";
import { ConnectionsView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

export default async function MyRingoConnectionsPage() {
  // customer.id comes from the server-side session — never from the request.
  const customer = await requireCustomer();
  const connections = await listActiveConnections(customer.id);
  return <ConnectionsView connections={connections} />;
}
