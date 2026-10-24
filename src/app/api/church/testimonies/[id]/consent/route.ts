import { churchRoute } from "@/lib/church/routeKit";
import { withdrawConsent } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// POST { scope: "publication" | "name", confirm: true, expected_updated_at }: records that the SUBMITTER withdrew a consent. Staff can only withdraw, never grant or restore.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => withdrawConsent(actor, params.id, body));
