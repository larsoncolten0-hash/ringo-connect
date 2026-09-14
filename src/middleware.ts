import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Throttle for the users.last_active_at write below — at most one DB write
// per signed-in user per this many seconds, no matter how many /dashboard
// or /admin requests they make in between. Backs two admin-reported
// metrics (see 2026-10-11_user_activity_and_pwa_tracking.sql): "daily
// active" (last_active_at within 24h) and "active in the last 15 min",
// the latter chosen specifically wider than this throttle so a genuinely
// active user's badge doesn't flicker between the two states purely from
// write-timing gaps.
const ACTIVITY_THROTTLE_SECONDS = 5 * 60;
const ACTIVITY_COOKIE = "rc_active_ping";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect /dashboard and /admin from logged-out visitors.
  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith("/dashboard") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // last_active_at instrumentation — every real /dashboard or /admin
  // request from a signed-in user counts as activity, throttled by a
  // short-lived, no-value cookie so deciding whether to write never costs
  // a DB read of its own. The write itself goes through event.waitUntil()
  // so it can never add latency to this request — if it's still in flight
  // (or fails) when the response is already on its way back, that's fine,
  // this is best-effort reporting data, not something anything else reads
  // synchronously. Uses the admin client rather than the request-scoped
  // session client on purpose: every other write to `users` in this
  // codebase goes through the service-role client server-side rather than
  // relying on the (technically permissive) "users update own row" RLS
  // policy, and this keeps that same posture.
  if (user && !request.cookies.get(ACTIVITY_COOKIE)) {
    response.cookies.set({
      name: ACTIVITY_COOKIE,
      value: "1",
      maxAge: ACTIVITY_THROTTLE_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });

    const userId = user.id;
    event.waitUntil(
      (async () => {
        const { error } = await createAdminClient()
          .from("users")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", userId);
        if (error) console.error("middleware activity ping failed:", error.message);
      })()
    );
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
