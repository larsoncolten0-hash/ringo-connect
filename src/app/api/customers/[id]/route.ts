import { customerProfile } from "@/lib/customers/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, READ-ONLY. One customer's profile: the existing Phase 3 statement plus derived totals and an activity timeline.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => customerProfile(owner, params.id));
}
