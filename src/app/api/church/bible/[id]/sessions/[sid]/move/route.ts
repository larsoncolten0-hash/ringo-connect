import { churchRoute } from "@/lib/church/routeKit";
import { moveSession } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// POST { direction: "up" | "down" }: swaps the session with its neighbour in one statement. manage permission while the programme is a draft; publish permission once it is live.
export const POST = (request: Request, { params }: { params: { id: string; sid: string } }) => churchRoute(request, { write: true }, (actor, { body }) => moveSession(actor, params.id, params.sid, body));
