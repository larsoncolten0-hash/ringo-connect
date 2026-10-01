import { redirect } from "next/navigation";
import { requireInventoryOwner, inventoryAvailable } from "@/lib/inventory/access";

export const dynamic = "force-dynamic";

// Inventory area (/dashboard/inventory/**). Owner only: the profile owner, Business & E-commerce, on a plan with the Business Toolkit, never a
// demo account, and only once the Phase 4 tables exist. A UX redirect; /api/inventory/** and the database functions enforce the same rules.
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireInventoryOwner();
  if (!(await inventoryAvailable(owner as any))) redirect("/dashboard");
  return <div className="max-w-5xl">{children}</div>;
}
