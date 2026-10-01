import { createShare, listShares } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. GET lists the share links of ONE of the owner's documents (metadata only: the token hash and the token are never
// returned). POST creates a link and returns its URL exactly once; only the hash of the token is stored.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => listShares(owner, params.id));
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return withOwner((owner) => createShare(owner, params.id, body, origin));
}
