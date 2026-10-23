import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { setProgress } from "@/lib/church/bible/journey";

export const dynamic = "force-dynamic";

// POST { session_id, done }: marks one session of a programme the visitor joined as done (or not done). Idempotent.
export const POST = (request: Request, { params }: { params: { programId: string } }) => journeyRoute(request, { write: true }, (ctx, { body }) => setProgress(ctx, params.programId, body));
