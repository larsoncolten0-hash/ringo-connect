import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import AttendanceDetail from "@/components/church/attendance/AttendanceDetail";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One event's attendance. The id is only a pointer: it is loaded through /api/church/attendance/[eventId], which resolves the church and the permissions itself and answers 404 for anything that is not
// a published event of this church.
export default async function ChurchAttendanceEventPage({ params }: { params: { eventId: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewAttendance) return <NoAccess section="attendance" />;
  return <AttendanceDetail eventId={params.eventId} caps={caps} />;
}
