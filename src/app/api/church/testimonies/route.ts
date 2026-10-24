import { churchRoute } from "@/lib/church/routeKit";
import { listTestimonies } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/testimonies?status=&publication=&q=&from=&to=&page=: the church's testimonies, newest first (private: names and phone numbers). Needs church.testimonies.view (or manage / publish).
// Testimonies are RECEIVED through the public route, never created here.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listTestimonies(actor, params));
