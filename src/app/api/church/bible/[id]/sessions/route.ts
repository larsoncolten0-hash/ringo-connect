import { churchRoute } from "@/lib/church/routeKit";
import { createSession } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// POST /api/church/bible/[id]/sessions: adds a session at the end of the programme. manage permission while the programme is a draft; publish permission once it is live.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => createSession(actor, params.id, body));
