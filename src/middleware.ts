import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { classifyHost, getProfileDomain, profileAddress, profileSubdomainAllowed, routeSubdomainRequest, validateSubdomain } from "@/lib/profileSubdomain";

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

// Custom profile addresses (david.<profile domain>). Inert unless NEXT_PUBLIC_PROFILE_DOMAIN is configured, and only ever acts on a Host that is a subdomain of exactly that domain.
// Redirects go to NEXT_PUBLIC_SITE_URL (configured), never to anything built from the incoming Host.
function mainSiteUrl(request: NextRequest, path: string): URL | null {
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com");
    // A path like "//evil.com/x" or "/\evil.com" would otherwise resolve to another host.
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
    const target = new URL(`${path}${request.nextUrl.search}`, site.origin);
    if (target.origin !== site.origin) return null;
    const domain = getProfileDomain();
    // Never redirect into the profile domain itself (that would loop).
    if (domain && (target.hostname === domain || target.hostname.endsWith(`.${domain}`))) return null;
    return target;
  } catch {
    return null;
  }
}

async function handleProfileHost(request: NextRequest, host: ReturnType<typeof classifyHost>): Promise<NextResponse> {
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (host.kind === "apex") {
    const target = mainSiteUrl(request, request.nextUrl.pathname);
    return target ? NextResponse.redirect(target, 307) : notFound();
  }
  if (host.kind !== "profile") return notFound();

  const admin = createAdminClient();
  const { data } = await admin
    .from("profile_subdomains")
    .select("subdomain, profiles!inner(username, published, users(status, plans(name)))")
    .eq("subdomain", host.subdomain)
    .maybeSingle();
  if (!data) {
    // Not anyone's current address. If a profile released it recently, forward to that profile's CURRENT address (built from a validated stored label and the configured
    // domain, never from the request). Anything else: the same bare 404 as an unknown name.
    const { data: retired } = await admin.from("profile_subdomain_retired").select("profile_id, retired_until").eq("subdomain", host.subdomain).maybeSingle();
    if (retired && new Date(retired.retired_until as string).getTime() > Date.now()) {
      const { data: current } = await admin.from("profile_subdomains").select("subdomain").eq("profile_id", retired.profile_id).maybeSingle();
      const valid = current ? validateSubdomain((current as any).subdomain) : null;
      const target = valid && valid.ok && valid.subdomain !== host.subdomain ? profileAddress(valid.subdomain, getProfileDomain()) : null;
      if (target) return NextResponse.redirect(new URL("/", target), 307);
    }
    return notFound();
  }
  const profile: any = Array.isArray((data as any).profiles) ? (data as any).profiles[0] : (data as any).profiles;
  const account: any = Array.isArray(profile?.users) ? profile.users[0] : profile?.users;
  // Unclaimed or unpublished: the same bare 404 for all, so a visitor learns nothing about which it was. A suspended owner is a 404 as well.
  if (!profile?.username || profile.published === false || account?.status === "suspended") return notFound();
  // The owner is no longer on a paid plan (expired / downgraded): the custom address stops working, nothing is deleted, and visitors are forwarded to the same profile on the main site.
  if (!profileSubdomainAllowed(account)) {
    const target = mainSiteUrl(request, `/${encodeURIComponent(profile.username)}`);
    return target ? NextResponse.redirect(target, 307) : notFound();
  }

  const route = routeSubdomainRequest(request.nextUrl.pathname, request.method, profile.username);
  if (route.action === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = route.pathname;
    return NextResponse.rewrite(url);
  }
  if (route.action === "next") return NextResponse.next();
  if (route.action === "main-site") {
    const target = mainSiteUrl(request, request.nextUrl.pathname);
    return target ? NextResponse.redirect(target, 307) : notFound();
  }
  return notFound();
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const host = classifyHost(request.headers.get("host"), getProfileDomain());
  if (host.kind !== "off") return handleProfileHost(request, host);

  // The matcher now lets every request in (the profile-domain check above needs the Host of any path). Everything that is not /dashboard or /admin leaves here untouched,
  // before any Supabase client is created, so the main site behaves exactly as it did when the matcher only listed those two.
  const pathname = request.nextUrl.pathname;
  if (!(pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) return NextResponse.next();

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
    // Remember where they were going, so the login page can take them back there (it validates the value with safeNextPath, so only a same-site path is
    // ever followed). Before this a notification link, a bookmark or a shared dashboard URL opened while signed out landed on the default page after login.
    const requested = `${path}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    url.searchParams.set("next", requested);
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
  // Everything except Next's build assets. Non-dashboard / non-admin paths on the main site return immediately (see the top of middleware()).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
