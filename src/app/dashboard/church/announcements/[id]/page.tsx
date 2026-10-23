import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { AnnouncementEditor } from "@/components/church/events/EventsScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One entry. The id is only a pointer: it is loaded through /api/church/announcements/[id], which resolves the church and the permissions itself and answers 404 for anything that is not this church's.
export default async function ChurchAnnouncementEditorPage({ params }: { params: { id: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewEvents) return <NoAccess section="events" />;
  return <AnnouncementEditor id={params.id} caps={caps} />;
}
