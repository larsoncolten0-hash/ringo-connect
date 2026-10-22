import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import PeopleView from "@/components/church/people/PeopleView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

export default async function ChurchPeoplePage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewMembers && !caps.viewChildren) return <NoAccess section="people" />;
  return <PeopleView caps={caps} />;
}
