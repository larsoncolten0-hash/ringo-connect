import { NextResponse } from "next/server";
import { getBrandingSettings } from "@/lib/branding";
import { translations } from "@/lib/i18n/translations";

// The ONE manifest for the central Ringo customer app — "My Ringo". Linked
// only from src/app/my-ringo/layout.tsx, so installing from any /my-ringo
// page installs this app; profile pages keep their own per-profile manifests
// (untouched). Same service worker as everywhere else (/pwa-sw.js, scope "/"),
// which already handles push and notification clicks.
//
// scope is "/my-ringo" (prefix match, includes "/my-ringo/connections" etc.)
// and deliberately does NOT cover "/" — this app is My Ringo only; a link out
// to a creator's public page leaves the app shell instead of being captured
// by it. start_url must sit inside scope, which is why there is no trailing
// slash. If the customer isn't signed in, start_url lands on the sign-in page.
//
// Named in the visitor's language (Accept-Language), since a manifest can't
// use the in-app language switch.
export async function GET(request: Request) {
  const { pwaThemeColor } = await getBrandingSettings();
  const locale = (request.headers.get("accept-language") || "").toLowerCase().startsWith("en") ? "en" : "fr";
  const name = translations[locale].myRingo.title;

  const manifest = {
    id: "/my-ringo",
    name,
    short_name: name,
    description: locale === "en" ? "Your Ringo connections, music and activity in one place." : "Vos connexions, votre musique et votre activité Ringo au même endroit.",
    start_url: "/my-ringo",
    scope: "/my-ringo",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: pwaThemeColor,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept-Language",
    },
  });
}
