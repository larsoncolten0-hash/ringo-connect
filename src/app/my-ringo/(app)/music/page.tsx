import { requireCustomer } from "@/lib/customer/server";
import { listMusicLibrary } from "@/lib/customer/activity";
import { MusicView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

// The customer's purchased tracks. The customer comes from the session; only
// PAID music orders they own are considered (see resolveOwnedOrderIds), and
// playback/download still go through the existing signed-URL audio route.
export default async function MyRingoMusicPage() {
  const customer = await requireCustomer();
  const tracks = await listMusicLibrary({ id: customer.id });
  return <MusicView tracks={tracks} />;
}
