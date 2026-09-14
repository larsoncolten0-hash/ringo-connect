import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Per-session signal from the client: is this page currently running as an
// installed PWA (window.matchMedia('(display-mode: standalone)'))? Fired
// once per browser tab/session by ActivitySignals.tsx (sessionStorage-gated
// there, not throttled here) — this is the proxy for "currently using as
// installed app" in the admin Users analytics view, and specifically the
// signal that catches iOS home-screen installs, which the `appinstalled`
// event (see /api/pwa/install) never fires for.
//
// Also refreshes last_active_at — middleware.ts covers the common
// server-navigation case, but this client mount is a real activity signal
// too and costs nothing extra to fold in here.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.standalone !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ last_active_at: new Date().toISOString(), last_active_standalone: body.standalone })
    .eq("id", user.id);

  if (error) {
    console.error("activity session ping failed:", error.message);
    return NextResponse.json({ error: "Could not record activity." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
