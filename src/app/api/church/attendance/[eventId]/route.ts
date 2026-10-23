import { churchRoute } from "@/lib/church/routeKit";
import { getAttendance, recordAttendance, removeAttendance } from "@/lib/church/attendance/handlers";

export const dynamic = "force-dynamic";

// GET the attendance of one event (who was present, the visitor and children counts)
// POST { member_id } or { member_ids: [...] } records people present (idempotent for a person already recorded)
// DELETE ?member_id= removes one person's record (undo a mistake). Needs church.attendance.manage. Attendance is recorded or removed, never edited.
export const GET = (request: Request, { params }: { params: { eventId: string } }) => churchRoute(request, { write: false }, (actor) => getAttendance(actor, params.eventId));
export const POST = (request: Request, { params }: { params: { eventId: string } }) => churchRoute(request, { write: true }, (actor, { body }) => recordAttendance(actor, params.eventId, body));
export const DELETE = (request: Request, { params }: { params: { eventId: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => removeAttendance(actor, params.eventId, query));
