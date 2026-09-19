import type { Metadata } from "next";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import PwaInstallCapture from "@/components/my-ringo/PwaInstallCapture";

// My Ringo is a private, per-customer space: never indexed. Each page under
// (app)/ authorizes itself through the customer session (requireCustomer);
// /my-ringo/signin is the only unguarded page.
//
// It is also the central customer PWA: the manifest below is the single
// "My Ringo" app (see manifest.webmanifest/route.ts), and the existing
// service worker (/pwa-sw.js — installability, web push, notification
// clicks) is registered here rather than a second one being created.
export const metadata: Metadata = {
  title: "My Ringo",
  robots: { index: false, follow: false },
  manifest: "/my-ringo/manifest.webmanifest",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "My Ringo", statusBarStyle: "default" },
};

export default function MyRingoRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegisterServiceWorker />
      <PwaInstallCapture />
      {children}
    </>
  );
}
