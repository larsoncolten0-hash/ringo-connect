import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import LandingView from "@/components/landing/LandingView";
import { publicPlans } from "@/lib/association/publicVisibility";
import { getBrandingSettings } from "@/lib/branding";
import { bundleAddonsFrom, getPublicActiveAddons, getPublicPlans } from "@/lib/publicCatalog";
import { seoSiteUrl } from "@/lib/seo";
import { extractRequestContext } from "@/lib/requestContext";

// Reads the visiting user's own cookie-based session — must never be
// served from a shared cache, or one visitor's logged-in state (and
// dashboard link) could leak into what a different visitor sees.
export const dynamic = "force-dynamic";

// Scoped to this route only (merges over the root layout's generic
// fallback) — every other page keeps that fallback rather than inheriting
// homepage-specific marketing copy.
export const metadata: Metadata = {
  // The absolute origin relative URLs below (the share image, the canonical) resolve against: the same
  // configured site URL the rest of the app uses (lib/deepLinks siteBase), not a new constant.
  metadataBase: new URL(seoSiteUrl()),
  alternates: { canonical: "/" },
  title: "Ringo Connect — Your Digital Identity. Your Business. Your Ringo.",
  description:
    "Create your digital identity with Ringo. Share your links, showcase products and services, connect with customers, and grow your presence — all in one place.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Ringo Connect",
    title: "Ringo Connect — Your Digital Identity. Your Business. Your Ringo.",
    description:
      "Create your digital identity with Ringo. Share your links, showcase products and services, connect with customers, and grow your presence — all in one place.",
    images: [{ url: "/brand/ringo-og.png", width: 1200, height: 630, alt: "Ringo Connect" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ringo Connect — Your Digital Identity. Your Business. Your Ringo.",
    description:
      "Create your digital identity with Ringo. Share your links, showcase products and services, connect with customers, and grow your presence — all in one place.",
    images: ["/brand/ringo-og.png"],
  },
};

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let dashboardHref = "/dashboard";
  if (user) {
    const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).single();
    dashboardHref = userRow?.role === "admin" ? "/admin" : "/dashboard";
  }

  const [branding, allPlans, activeAddons] = await Promise.all([
    getBrandingSettings(),
    // Public, unauthenticated read — shared, short-lived cache (lib/publicCatalog.ts), display only.
    // All 5 plans, in existing-convention price order.
    getPublicPlans(),
    // The two Ringo Card bundles (A5 of the entry-point restructure) — the same
    // cached active add-ons /get-started uses, narrowed to just the bundle rows
    // since this section never shows the generic addon checklist.
    getPublicActiveAddons(),
  ]);
  const { country } = extractRequestContext(headers());

  return (
    <LandingView
      isLoggedIn={!!user}
      dashboardHref={dashboardHref}
      appName={branding.appName}
      logoUrl={branding.logoUrl}
      plans={publicPlans(allPlans)}
      bundleAddons={bundleAddonsFrom(activeAddons)}
      isCameroon={country === "CM"}
    />
  );
}