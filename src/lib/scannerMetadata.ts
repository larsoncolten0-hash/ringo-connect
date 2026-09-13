import type { Metadata, Viewport } from "next";
import { createAdminClient } from "@/lib/supabase/server";

// Same "Add to Home Screen" pattern as the public profile's/dashboard's
// (see profileMetadata.ts/dashboardMetadata.ts) but for one specific gate
// scanner — so a guard who installs it gets an icon that reopens exactly
// their own gate's scanner, not a generic Ringo link, if they close the
// tab/app by mistake mid-event. See
// src/app/scanner/[token]/manifest.webmanifest/route.ts.
//
// Uses the admin client, not the regular one — same reasoning as every
// other scanner route: security staff have no Supabase session at all,
// there's nothing for RLS to key off, the token itself is the only
// credential. A lookup failure (bad/expired/revoked token) just returns
// no metadata rather than an error — the page itself already shows a
// clear "scanner session expired/invalid" state; this only ever affects
// the install icon/name, never blocks the page from rendering.
async function getScannerSession(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("scanner_sessions")
    .select("gate_name, events(title)")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  return { gateName: data.gate_name, eventTitle: (data.events as any)?.title || "" };
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  // Always present regardless of whether the token resolves — this used
  // to be the page's own static `export const metadata`, moved here
  // because a segment can only ever have one or the other, never both.
  const base: Metadata = {
    title: "Ringo Event Scanner",
    robots: { index: false, follow: false },
  };

  const session = await getScannerSession(params.token);
  if (!session) return base;

  const label = session.eventTitle ? `${session.eventTitle} — ${session.gateName}` : session.gateName;

  return {
    ...base,
    // Powers the browser's "Add to Home Screen"/install prompt — see the
    // route handler this points at.
    manifest: `/scanner/${params.token}/manifest.webmanifest`,
    // iOS Safari does not reliably read the manifest's `name` for the
    // home-screen label — this is what actually controls it there.
    appleWebApp: {
      capable: true,
      title: `${label} Scanner`,
      statusBarStyle: "black-translucent",
    },
  };
}

export async function generateViewport({ params }: { params: { token: string } }): Promise<Viewport> {
  return {
    // Repeats the root layout's zoom-lock fields (see app/layout.tsx's
    // `viewport` export) rather than relying purely on inheritance — this
    // segment is the one actually installed as a PWA, so it can't afford
    // to silently lose them if that merge behavior ever changes.
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    // Fixed near-black, matching the scanner UI itself — there's no
    // creator theme color to read here, this app has no owner-branding
    // concept at all by design.
    themeColor: "#000000",
  };
}
