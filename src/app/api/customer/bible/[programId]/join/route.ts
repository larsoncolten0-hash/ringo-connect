import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { joinProgram } from "@/lib/church/bible/journey";

export const dynamic = "force-dynamic";

// POST: the signed-in visitor joins a published Bible programme of a published church page (idempotent).
export const POST = (request: Request, { params }: { params: { programId: string } }) => journeyRoute(request, { write: true }, (ctx) => joinProgram(ctx, params.programId));
