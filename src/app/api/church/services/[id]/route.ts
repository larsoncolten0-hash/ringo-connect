import { churchRoute } from "@/lib/church/routeKit";
import { archiveService, updateService } from "@/lib/church/schedule/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, expected_updated_at } edits, switches on or off (is_enabled) or archives ({ archived: true }) a service; DELETE ?expected_updated_at= is the same archive. Nothing is ever deleted.
// The version being changed is mandatory (400 if missing, 409 if it changed meanwhile).
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateService(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => archiveService(actor, params.id, query));
