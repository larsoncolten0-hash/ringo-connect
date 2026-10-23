import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { getJourney, leaveProgram } from "@/lib/church/bible/journey";

export const dynamic = "force-dynamic";

// GET one published programme as this visitor sees it (content, sessions, whether they joined, which sessions they finished). DELETE leaves the programme and erases their progress.
export const GET = (request: Request, { params }: { params: { programId: string } }) => journeyRoute(request, { write: false }, (ctx) => getJourney(ctx, params.programId));
export const DELETE = (request: Request, { params }: { params: { programId: string } }) => journeyRoute(request, { write: true }, (ctx) => leaveProgram(ctx, params.programId));
