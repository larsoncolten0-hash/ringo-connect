import { createClient } from "@/lib/supabase/server";
import { getBrandingSettings } from "@/lib/branding";
import { NextResponse } from "next/server";

// The admin console's own Web App Manifest — same "Add to Home Screen"
// mechanism as the dashboard's (see
// src/app/dashboard/manifest.webmanifest/route.ts), with a distinct
// id/start_url/scope so an admin who installs both the dashboard and the
// admin console ends up with two separate home-screen icons.
//
// Gated behind a signed-in admin because /admin/** itself is (see
// admin/layout.tsx) — a Route Handler is never wrapped by that layout, so
// the check has to happen here too.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (userRow?.role !== "admin") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const branding = await getBrandingSettings();

  const manifest = {
    id: "/admin",
    start_url: "/admin",
    name: `${branding.appName} Admin`,
    short_name: "Admin",
    scope: "/admin",
    display: "standalone",
    // Deliberately NOT branding.pwaThemeColor/pwaBackgroundColor — this
    // console's dark chrome is a fixed identity independent of the
    // admin's light/dark preference (see AdminShell.tsx's own comment),
    // so it stays independent of the platform's general PWA color
    // setting too. The logo is still the platform's own, though.
    background_color: "#0B1023",
    theme_color: "#0B1023",
    icons: [{ src: branding.logoUrl, sizes: "512x512", type: "image/png" }],
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
