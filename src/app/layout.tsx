import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { LanguageProvider } from "@/components/LanguageProvider";
import { SoundProvider } from "@/components/SoundProvider";
import ReferralCapture from "@/components/ReferralCapture";
import { getBrandingSettings } from "@/lib/branding";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

// generateMetadata (not a static `metadata` export) so the title/favicon
// come from src/lib/branding.ts — an admin's /admin/branding change shows
// up here without a code change. dashboardMetadata.ts/adminMetadata.ts/
// profileMetadata.ts each export their own generateMetadata that
// overrides this per-route (a per-creator or per-admin identity makes
// more sense there than the platform's own), so this is really just the
// fallback for the landing page, auth pages, and anywhere else that
// doesn't define one of those.
export async function generateMetadata(): Promise<Metadata> {
  const { appName, faviconUrl } = await getBrandingSettings();
  return {
    title: appName,
    description: "Your links, your catalog, one page — connect on WhatsApp.",
    icons: { icon: faviconUrl },
  };
}

// Same reasoning as generateMetadata above — dynamic so `themeColor`
// reflects the admin's configured PWA theme color, everything else
// unchanged from the static viewport this replaces. Locking
// maximumScale/userScalable is what stops pinch- and double-tap-zoom, and
// viewportFit lets content draw under the iOS notch/home-indicator area
// (paired with the safe-area-inset padding already used for the mobile
// tab bar) — both are what make the installed PWA read as a real
// Android/iOS app rather than a zoomable mobile website.
export async function generateViewport(): Promise<Viewport> {
  const { pwaThemeColor } = await getBrandingSettings();
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: pwaThemeColor,
  };
}

// Tailwind's --ringo-indigo variable holds R G B channel numbers, not a
// hex string (see globals.css's own comment on why) — this converts the
// hex color stored in branding_settings.primary_color into that form.
// Falls back to the real default's channels if the stored value is ever
// malformed, so a bad admin input can never break every ringo-indigo
// utility in the app at once.
function hexToRgbChannels(hex: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "79 70 229";
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Runs before paint to avoid a light-mode flash for users who prefer dark.
const themeInitScript = `
(function() {
  var saved = localStorage.getItem('ringo-theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { primaryColor } = await getBrandingSettings();

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Overrides --ringo-indigo (defined in globals.css) with the
            admin's configured primary brand color — every `ringo-indigo`
            Tailwind utility (see tailwind.config.ts) reads this variable,
            so this one override is what makes "Primary brand color" in
            /admin/branding actually repaint the whole app's accent color,
            not just a cosmetic setting nothing reads. Inline in <head>
            (not a class toggle) so it applies before first paint, same
            reasoning as the theme-init script above. */}
        <style dangerouslySetInnerHTML={{ __html: `:root{--ringo-indigo:${hexToRgbChannels(primaryColor)};}` }} />
      </head>
      <body>
        <ReferralCapture />
        <LanguageProvider>
          <SoundProvider>{children}</SoundProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
