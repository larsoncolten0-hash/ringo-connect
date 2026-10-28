import { churchRoute } from "@/lib/church/routeKit";
import { payoutSummary, requestPayout } from "@/lib/church/giving/gifts/handlers";

export const dynamic = "force-dynamic";

// GET the church's balance (available, held by the hold period, requested, paid) and its payout requests. OWNER only: money belongs to the owner.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor) => payoutSummary(actor));
// POST asks for the available balance to be paid out. OWNER only; the database does the locking, the hold, the minimum and the owner check. Ringo administration then pays it and marks it.
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor) => requestPayout(actor));
