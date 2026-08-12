import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";

// See src/app/admin/settings/page.tsx for why this matters — this layout
// is what feeds the sidebar's plan badge, so a stale cache here could
// keep showing "Free" right after an upgrade.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("email, plans(name)")
    .eq("id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("user_id", user.id)
    .single();

  const planName = (userRow?.plans as any)?.name ?? "free";

  return (
    <DashboardShell
      email={userRow?.email ?? user.email ?? ""}
      username={profile?.username ?? "you"}
      avatarUrl={profile?.avatar_url}
      planName={planName}
      isFreePlan={planName === "free"}
    >
      {children}
    </DashboardShell>
  );
}