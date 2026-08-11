import { createClient } from "@/lib/supabase/server";
import LandingView from "@/components/landing/LandingView";

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