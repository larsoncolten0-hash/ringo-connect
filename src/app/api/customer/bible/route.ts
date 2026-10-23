import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { listJourneys } from "@/lib/church/bible/journey";

export const dynamic = "force-dynamic";

// GET /api/customer/bible: the signed-in visitor's own Bible programmes (My Bible Journey) and how far along they are. The visitor comes only from the My Ringo cookie.
export const GET = (request: Request) => journeyRoute(request, { write: false }, (ctx) => listJourneys(ctx));
