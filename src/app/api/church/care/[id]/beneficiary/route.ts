import { churchRoute } from "@/lib/church/routeKit";
import { clearBeneficiary, getBeneficiary, setBeneficiary } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// The PRIVATE link from a case to the roster person it is for (staff only; never public, never in a report, never in Ringo AI). A child can never be linked: link the guardian instead.
// GET reads it. PUT { member_id } sets or replaces it. DELETE removes it. Needs church.care.view to read, church.care.manage to change.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getBeneficiary(actor, params.id));
export const PUT = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => setBeneficiary(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor) => clearBeneficiary(actor, params.id));
