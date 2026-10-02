import { redirect } from "next/navigation";
import { requireSalesOwner, saleRecordInstalled } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

// Record Sale (/dashboard/sales). Owner only, in an entitled Business Toolkit category, on a plan with the Toolkit, never a demo account, and only once the
// database function behind it exists. A UX redirect; /api/sales and the database function enforce the same rules independently.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireSalesOwner();
  if (!(await saleRecordInstalled((owner as any).admin))) redirect("/dashboard");
  return <div className="max-w-3xl">{children}</div>;
}
