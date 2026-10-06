import { redirect } from "next/navigation";
import { resolveToolkitLock } from "@/lib/toolkitLock";
import ToolkitLocked from "@/components/subscription/ToolkitLocked";
import { requireSalesOwner, saleRecordInstalled } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

// Record Sale (/dashboard/sales). Owner only, in an entitled Business Toolkit category, on a plan with the Toolkit, never a demo account, and only once the
// database function behind it exists. A UX redirect; /api/sales and the database function enforce the same rules independently.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  // A Free owner in an entitled category sees this tool locked (what it does + an upgrade call to action) instead of being sent away. The tool itself
  // is never rendered, and its API and database functions still refuse a plan without the business tools.
  const lock = await resolveToolkitLock();
  if (lock.locked) return <div className="max-w-5xl"><ToolkitLocked tool="sales" /></div>;
  const owner = await requireSalesOwner();
  if (!(await saleRecordInstalled((owner as any).admin))) redirect("/dashboard");
  return <div className="max-w-3xl">{children}</div>;
}
