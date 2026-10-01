import { updateSettings } from "@/lib/inventory/handlers";
import { withOwner, readJson } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Low-stock level, SKU and informational unit cost. Never changes the stock quantity.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => updateSettings(owner, params.id, body));
}
