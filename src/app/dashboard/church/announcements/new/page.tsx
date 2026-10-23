import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { AnnouncementEditor } from "@/components/church/events/EventsScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// A new entry: needs permission to write drafts. It is saved as a DRAFT; publishing is a separate, confirmed step.
export default async function ChurchNewAnnouncementEditorPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.manageEvents) return <NoAccess section="events" />;
  return <AnnouncementEditor caps={caps} />;
}
