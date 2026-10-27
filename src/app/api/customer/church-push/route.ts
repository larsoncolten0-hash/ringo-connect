import { journeyRoute } from "@/lib/church/bible/customerRoute";
import { getPrefs, setPrefs, stopAll, type PrefsCtx } from "@/lib/church/push/prefs";

export const dynamic = "force-dynamic";

// The VISITOR side of church notifications (the visitor's My Ringo cookie, never a church staff session).
//   GET    ?profile_id=            the topics chosen, the topics on offer, whether the visitor is connected and has a device registered
//   PUT    { profile_id, topics }  the choice (an empty list turns everything off); needs a connection
//   DELETE ?profile_id=            turn everything from this church off
// The devices themselves are registered by the existing /api/customer/push/subscribe route. The church never sees any of this.
const asCtx = (ctx: unknown) => ctx as PrefsCtx;
const profileIdOf = (request: Request): string => {
  try {
    return new URL(request.url).searchParams.get("profile_id") || "";
  } catch {
    return "";
  }
};

export const GET = (request: Request) => journeyRoute(request, { write: false }, (ctx) => getPrefs(asCtx(ctx), profileIdOf(request)));
export const PUT = (request: Request) => journeyRoute(request, { write: true }, (ctx, { body }) => setPrefs(asCtx(ctx), body));
export const DELETE = (request: Request) => journeyRoute(request, { write: true }, (ctx) => stopAll(asCtx(ctx), profileIdOf(request)));
