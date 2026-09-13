import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { LanguageProvider } from "@/components/LanguageProvider";
import { SoundProvider } from "@/components/SoundProvider";
import ReferralCapture from "@/components/ReferralCapture";
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

export const metadata: Metadata = {
  title: "Ringo Connect",
  description: "Your links, your catalog, one page — connect on WhatsApp.",
  icons: {
    icon: "/favicon.ico",
  },
};

// Site-wide base viewport — every route inherits this (dashboardMetadata/
// profileMetadata/scannerMetadata's own generateViewport only override
// themeColor, so these fields fall through everywhere else too). Locking
// maximumScale/userScalable is what stops pinch- and double-tap-zoom, and
// viewportFit lets content draw under the iOS notch/home-indicator area
// (paired with the safe-area-inset padding already used for the mobile
// tab bar) — both are what make the installed PWA read as a real
// Android/iOS app rather than a zoomable mobile website.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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