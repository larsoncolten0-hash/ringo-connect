import { churchRoute } from "@/lib/church/routeKit";
import { reviewTestimony } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// POST { status: "under_review" | "approved" | "rejected", expected_updated_at }. Approving never publishes: publishing is its own step and needs the submitter's consent.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => reviewTestimony(actor, params.id, body));
