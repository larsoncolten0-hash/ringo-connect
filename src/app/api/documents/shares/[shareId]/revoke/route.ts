import { revokeShare } from "@/lib/documents/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Revokes one share link at once (idempotent); the link then behaves exactly like one that never existed.
export async function POST(_request: Request, { params }: { params: { shareId: string } }) {
  return withOwner((owner) => revokeShare(owner, params.shareId));
}
