import { churchRoute } from "@/lib/church/routeKit";
import { listAttendance } from "@/lib/church/attendance/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/attendance?page=: the church's published events that have started, with how many people were recorded present. Needs church.attendance.view (or manage).
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listAttendance(actor, params));
