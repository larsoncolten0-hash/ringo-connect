import { redirect } from "next/navigation";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// /dashboard/church opens the first section the signed-in person may use.
export default async function ChurchIndexPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (caps.viewMembers || caps.viewChildren) redirect("/dashboard/church/people");
  if (caps.viewGroups) redirect("/dashboard/church/groups");
  if (caps.viewLeadership) redirect("/dashboard/church/leadership");
  if (caps.viewContent) redirect("/dashboard/church/content");
  if (caps.viewEvents) redirect("/dashboard/church/events");
  if (caps.viewBible) redirect("/dashboard/church/bible");
  if (caps.viewAttendance) redirect("/dashboard/church/attendance");
  if (caps.manageMusic) redirect("/dashboard/church/music");
  if (caps.viewReports) redirect("/dashboard/church/reports");
  if (caps.viewCare) redirect("/dashboard/church/care");
  redirect("/dashboard");
}
