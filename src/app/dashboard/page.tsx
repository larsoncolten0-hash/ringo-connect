import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Editor from "@/components/Editor";

// See src/app/admin/settings/page.tsx for why this matters: without it,
// navigating back here via the sidebar can show stale cached data.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("*, plans(*)")
    .eq("id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, social_links(*), links(*), products(*), profile_phone_numbers(*)`)
    .eq("user_id", user.id)
    .single();

  if (!profile) redirect("/auth/login?error=profile_missing");

  return <Editor profile={profile} plan={userRow?.plans} userId={user.id} />;
}