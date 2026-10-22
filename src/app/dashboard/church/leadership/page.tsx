import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import LeadershipView from "@/components/church/people/LeadershipView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

export default async function ChurchLeadershipPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewLeadership) return <NoAccess section="leadership" />;
  return <LeadershipView caps={caps} />;
}
