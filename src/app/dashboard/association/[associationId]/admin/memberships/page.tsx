import { notFound, redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAssociationCaps } from "@/lib/association/access";
import { isUuid } from "@/lib/association/permissions";
import MembershipAdminView from "@/components/association/admin/MembershipAdminView";

export const dynamic = "force-dynamic";

// Membership administration for one Association (Phase B1). Access is resolved by the DATABASE for the signed-in
// user (association_staff_role / has_association_permission use auth.uid()); the UI hides tabs by permission but
// every API route and SQL function re-checks independently.
export default async function AssociationMembershipAdminPage({ params }: { params: { associationId: string } }) {
  if (!isUuid(params.associationId)) notFound();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const admin = createAdminClient();
  const { data: association } = await admin
    .from("associations")
    .select("id, name, host_profile_id, config")
    .eq("id", params.associationId)
    .maybeSingle();
  if (!association) notFound();

  const { data: role } = await supabase.rpc("association_staff_role", { p_association_id: association.id });
  if (!role) redirect("/dashboard/association");

  const caps = await getAssociationCaps(association.host_profile_id);
  if (!caps.enabled) redirect("/dashboard/association");

  const has = async (p: string) => (await supabase.rpc("has_association_permission", { p_association_id: association.id, p_permission: p })).data === true;
  const [settings, plans, view, manage, audit] = await Promise.all([
    has("settings.manage"),
    has("plans.manage"),
    has("memberships.view"),
    has("memberships.manage"),
    has("audit.view"),
  ]);

  const cfg = (association.config as Record<string, unknown>) || {};
  return (
    <MembershipAdminView
      associationId={association.id}
      associationName={association.name}
      perms={{ settings, plans, membershipsView: view, membershipsManage: manage, audit }}
      initialEnabled={cfg.membership_enabled === true}
      initialPrefix={typeof cfg.membership_number_prefix === "string" ? cfg.membership_number_prefix : "M"}
    />
  );
}
