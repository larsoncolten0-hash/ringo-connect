import { redirect } from "next/navigation";
import ReportsTabs from "@/components/reports/ReportsTabs";
import { requireReportsOwner, reportsAvailable } from "@/lib/reports/access";

export const dynamic = "force-dynamic";

// Reports area (/dashboard/reports/**). Owner only: the profile owner, Business & E-commerce, on a plan with the Business Toolkit, never a
// demo account. A UX redirect; /api/reports/**, /api/bookkeeping/** and the database enforce the same rules independently.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireReportsOwner();
  if (!(await reportsAvailable(owner as any))) redirect("/dashboard");
  return (
    <div className="max-w-5xl">
      <ReportsTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
