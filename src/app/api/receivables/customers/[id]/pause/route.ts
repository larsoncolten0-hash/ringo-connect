import { setContactAutoPaused } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Pause or resume AUTOMATIC reminders for one contact ({ "paused": true|false }). Manual reminders stay possible.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => setContactAutoPaused(owner, params.id, body));
}
