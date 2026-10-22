import { churchRoute } from "@/lib/church/routeKit";
import { deleteMember, getMember, updateMember } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// GET / PATCH (edit, status, age group, guardian) / DELETE (permanent; needs church.members.delete) one roster record of the signed-in user's church.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getMember(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateMember(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor) => deleteMember(actor, params.id));
