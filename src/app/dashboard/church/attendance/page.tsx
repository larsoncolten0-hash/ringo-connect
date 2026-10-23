import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import AttendanceList from "@/components/church/attendance/AttendanceList";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Attendance: the church's published events that have started, with how many were recorded present. Private. The church and the permissions are resolved on the server; /api/church/attendance/**
// re-checks every request and the database decides what is read or written.
export default async function ChurchAttendancePage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewAttendance) return <NoAccess section="attendance" />;
  return <AttendanceList />;
}
