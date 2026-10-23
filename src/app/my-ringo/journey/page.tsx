import JourneyList from "@/components/church/bible/journey/JourneyList";
import { getCustomerSession } from "@/lib/customer/server";

export const dynamic = "force-dynamic";

// The visitor's own Bible programmes. Signed out, the page only asks them to sign in; it never reads anything private without the visitor's session.
export default async function JourneyListPage() {
  const session = await getCustomerSession();
  return <JourneyList signedIn={!!session} />;
}
