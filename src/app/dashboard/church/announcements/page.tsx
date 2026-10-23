import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { AnnouncementsList } from "@/components/church/events/EventsScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's announcements (drafts and live). The church and the permissions are resolved on the server; /api/church/announcements/** re-checks every request.
export default async function ChurchAnnouncementsListPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewEvents) return <NoAccess section="events" />;
  return <AnnouncementsList caps={caps} />;
}
