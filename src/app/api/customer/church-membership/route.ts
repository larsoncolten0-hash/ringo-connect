import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { myMembership, requestMembership, type MembershipCtx } from "@/lib/church/membership/request";

export const dynamic = "force-dynamic";

// The VISITOR side of church membership (the visitor's My Ringo cookie, never a church staff session).
//   GET  ?profile_id=  where this visitor stands with that church: connected or not, and the status of their request (none / pending / active).
//   POST { profile_id, age_group: "adult" | "youth", consent: true }  asks to become a member. A child is never self-registered. The database decides; see lib/church/membership/request.ts.
const asCtx = (ctx: unknown) => ctx as MembershipCtx;

export const GET = (request: Request) => {
  let profileId = "";
  try {
    profileId = new URL(request.url).searchParams.get("profile_id") || "";
  } catch {
    /* none */
  }
  return journeyRoute(request, { write: false }, (ctx) => myMembership(asCtx(ctx), profileId));
};
export const POST = (request: Request) => journeyRoute(request, { write: true }, (ctx, { body }) => requestMembership(asCtx(ctx), body));
