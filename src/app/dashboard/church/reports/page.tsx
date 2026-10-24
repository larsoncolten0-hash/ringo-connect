import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import ReportsView from "@/components/church/reports/ReportsView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Church Reports: aggregate numbers only (never names), for dates the person chooses, with a CSV download per section. The church and the permissions are resolved on the server;
// /api/church/reports re-checks every request and each section needs the permission for its own data.
export default async function ChurchReportsPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (access.actor.kind === "leader" || !access.actor.caps.viewReports) return <NoAccess section="reports" />;
  return <ReportsView />;
}
