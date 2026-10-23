import JourneyView from "@/components/church/bible/journey/JourneyView";
import { loadPublicJourney } from "@/lib/church/bible/publicJourney";
import { getCustomerSession } from "@/lib/customer/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// One Bible programme. A signed-in visitor gets the full interactive view (everything private is fetched by the view from /api/customer/bible, with their own session). A visitor who is not signed in gets
// the public programme (read through the public policies) and an invitation to sign in; an unpublished or unknown programme is simply "not available".
export default async function JourneyProgramPage({ params }: { params: { programId: string } }) {
  const session = await getCustomerSession();
  if (session) return <JourneyView programId={params.programId} signedIn />;
  const preloaded = await loadPublicJourney(createClient(), params.programId);
  return <JourneyView programId={params.programId} signedIn={false} preloaded={preloaded} />;
}
