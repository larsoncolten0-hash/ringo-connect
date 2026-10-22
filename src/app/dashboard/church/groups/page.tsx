import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import GroupsView from "@/components/church/people/GroupsView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

export default async function ChurchGroupsPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewGroups) return <NoAccess section="groups" />;
  return <GroupsView caps={caps} />;
}
