import { redirect } from "next/navigation";
import { resolveToolkitLock } from "@/lib/toolkitLock";
import ToolkitLocked from "@/components/subscription/ToolkitLocked";
import ReportsTabs from "@/components/reports/ReportsTabs";
import { requireReportsOwner, reportsAvailable } from "@/lib/reports/access";

export const dynamic = "force-dynamic";

// Reports area (/dashboard/reports/**). Owner only: the profile owner, Business & E-commerce, on a plan with the Business Toolkit, never a
// demo account. A UX redirect; /api/reports/**, /api/bookkeeping/** and the database enforce the same rules independently.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  // A Free owner in an entitled category sees this tool locked (what it does + an upgrade call to action) instead of being sent away. The tool itself
  // is never rendered, and its API and database functions still refuse a plan without the business tools.
  const lock = await resolveToolkitLock();
  if (lock.locked) return <div className="max-w-5xl"><ToolkitLocked tool="reports" /></div>;
  const owner = await requireReportsOwner();
  if (!(await reportsAvailable(owner as any))) redirect("/dashboard");
  return (
    <div className="max-w-5xl">
      <ReportsTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
