import { createClient } from "@/lib/supabase/server";
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

  const manifest = {
    id: "/admin",
    start_url: "/admin",
    name: "Ringo Connect Admin",
    short_name: "Admin",
    scope: "/admin",
    display: "standalone",
    background_color: "#0B1023",
    theme_color: "#0B1023",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
