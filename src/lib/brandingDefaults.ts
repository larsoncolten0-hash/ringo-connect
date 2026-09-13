// Split out of src/lib/branding.ts on purpose: that file imports
// createAdminClient from src/lib/supabase/server.ts, which itself
// imports next/headers — fine for the server components/routes that use
// getBrandingSettings(), but it means importing ANYTHING from
// branding.ts (even just this type/constant) into a Client Component's
// module graph fails the build ("next/headers ... not supported").
// AuthShell.tsx is a Client Component (every one of the 7 auth pages
// that render it has "use client" at the top), so it imports its
// starting values from here instead — see its own comment for how it
// gets the live, admin-configured values afterward.
export type BrandingSettings = {
  appName: string;
  shortName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  pwaThemeColor: string;
  pwaBackgroundColor: string;
};

export const DEFAULT_BRANDING: BrandingSettings = {
  appName: "Ringo Connect",
  shortName: "Ringo",
  logoUrl: "/logo.png",
  faviconUrl: "/favicon.ico",
  primaryColor: "#4F46E5",
  pwaThemeColor: "#4F46E5",
  pwaBackgroundColor: "#FAFAF8",
};
