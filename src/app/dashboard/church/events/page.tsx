import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { EventsList } from "@/components/church/events/EventsScreens";
import ServiceSchedule from "@/components/church/schedule/ServiceSchedule";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's events (drafts and live). The church and the permissions are resolved on the server; /api/church/events/** re-checks every request.
export default async function ChurchEventsListPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewEvents) return <NoAccess section="events" />;
  // The weekly services sit above the dated events: they are set once and show on the public page automatically, so no event is created for them each week.
  return (
    <>
      <ServiceSchedule />
      <EventsList caps={caps} />
    </>
  );
}
