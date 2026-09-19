import { requireCustomer } from "@/lib/customer/server";
import { MusicView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

// Empty state only: existing music orders are guest records keyed by
// unverified email/phone, so they are not linked to the customer identity
// yet. The music purchase/preview/audio security is untouched.
export default async function MyRingoMusicPage() {
  await requireCustomer();
  return <MusicView />;
}
