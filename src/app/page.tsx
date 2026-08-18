import { createClient } from "@/lib/supabase/server";
import LandingView from "@/components/landing/LandingView";

// Reads the visiting user's own cookie-based session — must never be
// served from a shared cache, or one visitor's logged-in state (and
// dashboard link) could leak into what a different visitor sees.
export const dynamic = "force-dynamic";

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