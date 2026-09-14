import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listUserOrganizations } from "@/lib/team/access";

// POST /api/team/switch-org — body: { profileId }. Sets which organization
// the dashboard renders next. Purely a UX preference (see the comment on
// ACTIVE_ORG_COOKIE in src/lib/team/access.ts) — every page/route still
// re-derives real access from auth.uid() on every request, so this cookie
// can never grant access to an organization the caller doesn't actually
// belong to; it only decides which of their OWN organizations to show.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const profileId = body?.profileId as string | undefined;
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const orgs = await listUserOrganizations(user.id);
  if (!orgs.some((o) => o.profile.id === profileId)) {
    return NextResponse.json({ error: "You don't belong to that organization." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("ringo_active_org", profileId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}
