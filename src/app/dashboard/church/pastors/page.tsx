import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import PastorsView from "@/components/church/pubgroups/PastorsView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The Pastors page of the church (pastors, vision and mission), shown on the public page once published. The church and the permissions are resolved on the server;
// /api/church/pastors and /api/church/about re-check every request and the database decides what is read or written.
export default async function ChurchPastorsPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (!access.actor.caps.managePastors) return <NoAccess section="pastors" />;
  return <PastorsView />;
}
