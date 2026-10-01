import { renderPdf } from "@/lib/documents/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only PDF of an invoice or receipt, regenerated from the stored immutable snapshot (the same document every time). An issued
// document is rendered only if its content still matches the hash computed at issue. Never cached; never public.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => renderPdf(owner, params.id));
}
