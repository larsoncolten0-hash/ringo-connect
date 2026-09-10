import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import LandingView from "@/components/landing/LandingView";

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

  return <LandingView isLoggedIn={!!user} dashboardHref={dashboardHref} />;
}