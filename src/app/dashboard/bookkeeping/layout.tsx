import { redirect } from "next/navigation";
import { requireReportsOwner, reportsAvailable } from "@/lib/reports/access";

export const dynamic = "force-dynamic";

// Bookkeeping (/dashboard/bookkeeping): the list of recorded sales, income and expenses with the entry form, correction and void. It used to be a tab of
// Reports; it is now its own entry in the dashboard menu and shares the Reports entitlement (owner, entitled category, plan flag, not a demo). A UX redirect;
// /api/bookkeeping/** and the database enforce the same rules independently.
export default async function BookkeepingLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireReportsOwner();
  if (!(await reportsAvailable(owner as any))) redirect("/dashboard");
  return <div className="max-w-5xl">{children}</div>;
}
