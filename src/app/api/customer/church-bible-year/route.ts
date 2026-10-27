import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { leavePlan, myPlan, startPlan, tickDay, type BibleYearCtx } from "@/lib/church/bibleYear/handlers";

export const dynamic = "force-dynamic";

// The READER side of "The Bible in one year" (the visitor's My Ringo cookie, never a church staff session).
//   GET    ?profile_id=   the reader's plan: day, today's reading (en + fr), ticked days, streak
//   POST   { profile_id } opt in (needs a connection to the church)
//   PATCH  { profile_id, day, done } tick or untick a day
//   DELETE ?profile_id=   leave the plan
const asCtx = (ctx: unknown) => ctx as BibleYearCtx;
const profileIdOf = (request: Request): string => {
  try {
    return new URL(request.url).searchParams.get("profile_id") || "";
  } catch {
    return "";
  }
};

export const GET = (request: Request) => journeyRoute(request, { write: false }, (ctx) => myPlan(asCtx(ctx), profileIdOf(request)));
export const POST = (request: Request) => journeyRoute(request, { write: true }, (ctx, { body }) => startPlan(asCtx(ctx), body));
export const PATCH = (request: Request) => journeyRoute(request, { write: true }, (ctx, { body }) => tickDay(asCtx(ctx), body));
export const DELETE = (request: Request) => journeyRoute(request, { write: true }, (ctx) => leavePlan(asCtx(ctx), profileIdOf(request)));
