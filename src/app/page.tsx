import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import LandingView from "@/components/landing/LandingView";
import { getBrandingSettings } from "@/lib/branding";
import { extractRequestContext } from "@/lib/requestContext";

// Reads the visiting user's own cookie-based session — must never be
// served from a shared cache, or one visitor's logged-in state (and
// dashboard link) could leak into what a different visitor sees.
export const dynamic = "force-dynamic";

// Scoped to this route only (merges over the root layout's generic
// fallback) — every other page keeps that fallback rather than inheriting
// homepage-specific marketing copy.
export const metadata: Metadata = {
  title: "Ringo Connect — Your Digital Identity. Your Business. Your Ringo.",
  description:
    "Create your digital identity with Ringo. Share your links, showcase products and services, connect with customers, and grow your presence — all in one place.",
  openGraph: {
    title: "Ringo Connect — Your Digital Identity. Your Business. Your Ringo.",
    description:
      "Create your digital identity with Ringo. Share your links, showcase products and services, connect with customers, and grow your presence — all in one place.",
    images: ["/logo.png"],
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

  const [branding, plansResult, bundleAddonsResult] = await Promise.all([
    getBrandingSettings(),
    // Public, unauthenticated read — same "plans are publicly readable" RLS
    // every pricing-facing page already relies on (see /get-started's own
    // fetch). All 5 plans, in existing-convention price order.
    supabase.from("plans").select("*").order("price_usd", { ascending: true }),
    // The two Ringo Card bundles (A5 of the entry-point restructure) —
    // same public read as /get-started's own addon fetch, filtered to
    // just the bundle rows since this section never shows the generic
    // addon checklist.
    supabase
      .from("addons")
      .select("id, name, price_xaf, price_usd, grants_plan_duration_days, bundle_features")
      .eq("active", true)
      .not("grants_plan_name", "is", null)
      .order("sort_order", { ascending: true }),
  ]);
  const { country } = extractRequestContext(headers());

  return (
    <LandingView
      isLoggedIn={!!user}
      dashboardHref={dashboardHref}
      appName={branding.appName}
      logoUrl={branding.logoUrl}
      plans={plansResult.data || []}
      bundleAddons={bundleAddonsResult.data || []}
      isCameroon={country === "CM"}
    />
  );
}