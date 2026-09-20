import { requireCustomer } from "@/lib/customer/server";
import { listActiveConnections, listDisconnectedConnections } from "@/lib/customer/connections";
import { ConnectionsView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

export default async function MyRingoConnectionsPage() {
  // customer.id comes from the server-side session — never from the request.
  const customer = await requireCustomer();
  const [connections, previous] = await Promise.all([listActiveConnections(customer.id), listDisconnectedConnections(customer.id)]);
  return <ConnectionsView connections={connections} previous={previous} />;
}
