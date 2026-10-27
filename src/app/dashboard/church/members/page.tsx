import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import MembersView from "@/components/church/members/MembersView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Members: the approved members of the church, the requests that came from the church page, and the printable lists. The church and the permissions are resolved on the server;
// /api/church/members/** and /api/church/lists/** re-check every request and the database decides what is read or written. A group leader (not staff) never reaches this screen.
export default async function ChurchMembersPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps, kind } = access.actor;
  if (kind === "leader" || !caps.viewMembers) return <NoAccess section="members" />;
  return <MembersView canManage={caps.manageMembers} canExport={caps.exportLists} canExportLeadership={caps.exportLists && caps.viewLeadership} canExportGroups={caps.exportLists && caps.viewGroups} />;
}
