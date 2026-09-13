import type { Metadata, Viewport } from "next";

// Same "Add to Home Screen" pattern as src/lib/dashboardMetadata.ts, but
// for the admin console — no per-admin theming or avatar exists (unlike a
// creator's dashboard), so this is static rather than fetched per
// request. Exported as generateMetadata/generateViewport from
// admin/layout.tsx, so every /admin/** page inherits it.
export async function generateMetadata(): Promise<Metadata> {
  return {
    // Powers the browser's "Add to Home Screen"/install prompt on
    // Android/Chrome — see src/app/admin/manifest.webmanifest/route.ts.
    manifest: "/admin/manifest.webmanifest",
    // iOS Safari does not reliably read the manifest's `name` for the
    // home-screen label — this is what actually controls it there.
    appleWebApp: {
      capable: true,
      title: "Ringo Connect Admin",
      statusBarStyle: "black",
    },
    icons: {
      apple: "/apple-touch-icon.png",
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  // Matches AdminShell's fixed dark sidebar/topbar chrome color, not a
  // per-creator theme_color — the admin console deliberately isn't
  // theme-toggle-aware for its chrome (see AdminShell.tsx).
  return { themeColor: "#0B1023" };
}
