import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Per-scanner Web App Manifest — what makes "Add to Home Screen" install
// this exact gate's scanner (name, icon, launch URL) rather than a
// generic Ringo Connect link. Linked from the scanner page's own <head>
// via generateMetadata (see src/lib/scannerMetadata.ts) — the browser
// fetches this when it evaluates installability, or when the guard taps
// "Add to Home Screen" (see ScannerAddToHomeScreen.tsx).
//
// Public/unauthenticated like every other scanner route — the token is
// the only credential a guard has, there's no Supabase session for RLS to
// check. Admin client, same as
// src/app/api/scanner/[token]/route.ts.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("scanner_sessions")
    .select("gate_name, events(title)")
    .eq("token", params.token)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const eventTitle = (session.events as any)?.title || "";
  const gateName = session.gate_name;
  const fullLabel = eventTitle ? `${eventTitle} — ${gateName}` : gateName;

  const manifest = {
    id: `/scanner/${params.token}`,
    // Exactly this scanner's own URL — installing must always reopen
    // precisely this gate's session, never a tracking-decorated variant
    // or a different gate's link.
    start_url: `/scanner/${params.token}`,
    name: `${fullLabel} Scanner`,
    // Fits under a home-screen icon better than the full "<Event> — <Gate>"
    // label — the gate name alone is what a guard actually needs to tell
    // their own device's icon apart from a colleague's other-gate one.
    short_name: gateName.length > 12 ? `${gateName.slice(0, 11)}…` : gateName,
    // Narrow on purpose, unlike the profile manifest's site-wide scope —
    // this app never links anywhere else within itself, it has exactly
    // one screen.
    scope: `/scanner/${params.token}`,
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    // No per-organizer branding concept here by design (see
    // scannerMetadata.ts) — always the site's own generated PWA icons.
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
