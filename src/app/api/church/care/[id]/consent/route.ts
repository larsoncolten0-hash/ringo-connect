import { churchRoute } from "@/lib/church/routeKit";
import { listConsent, recordConsent } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// GET the consent record of a case (newest first). POST { kind: "granted" | "withdrawn", given_by: "beneficiary" | "guardian", method: "written" | "verbal_witnessed" } adds one.
// A record is only ever added, never edited or deleted. Withdrawing consent takes a published case back to a private draft at once. Needs church.care.view to read, church.care.manage to add.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => listConsent(actor, params.id));
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => recordConsent(actor, params.id, body));
