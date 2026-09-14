import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveOrganization } from "@/lib/team/access";

export const dynamic = "force-dynamic";

// Gate for the whole /dashboard/team/* tree — requires BOTH the active
// organization's plan to unlock Team Management (Enterprise/"business"
// plan — see 2026-10-02_team_plan_gate.sql) AND the caller to be its owner
// or hold staff.view. Personal-plan organizations are rejected here even
// for their own owner: Team Management is an Enterprise feature, full
// stop (see the product spec's Personal-vs-Enterprise gating). This is a
// UX redirect on top of the real boundary — every /api/team/* route
// re-checks the exact same two conditions itself via requireOrgAccessJson,
// so a direct request against those routes is rejected server-side too,
// not just this page.
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const active = await resolveActiveOrganization(user.id);
  if (!active) redirect("/dashboard");
  if (!active.teamEnabled) redirect("/dashboard");
  if (!active.isOwner && !active.permissions.includes("staff.view")) redirect("/dashboard");

  return <>{children}</>;
}
