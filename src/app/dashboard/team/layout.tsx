import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveOrganization } from "@/lib/team/access";

export const dynamic = "force-dynamic";

// Gate for the whole /dashboard/team/* tree — the owner of the active
// organization always gets in; a staff member needs staff.view. This is a
// UX redirect on top of the real boundary (RLS + the /api/team/* routes
// each re-check their own required permission), same relationship every
// other category's dashboard guard (e.g. requireRestaurantProfile) has
// with its data.
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const active = await resolveActiveOrganization(user.id);
  if (!active) redirect("/dashboard");
  if (!active.isOwner && !active.permissions.includes("staff.view")) redirect("/dashboard");

  return <>{children}</>;
}
