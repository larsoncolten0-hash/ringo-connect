import { getBusinessProfile, putBusinessProfile } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// The business identity printed on invoices and receipts. Its own configuration: the public profile is never changed by it.
export async function GET() {
  return withOwner((owner) => getBusinessProfile(owner));
}

export async function PUT(request: Request) {
  const body = await readJson(request);
  return withOwner((owner) => putBusinessProfile(owner, body));
}
