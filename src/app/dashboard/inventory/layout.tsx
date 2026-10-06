import { redirect } from "next/navigation";
import { resolveToolkitLock } from "@/lib/toolkitLock";
import ToolkitLocked from "@/components/subscription/ToolkitLocked";
import { requireInventoryOwner, inventoryAvailable } from "@/lib/inventory/access";

export const dynamic = "force-dynamic";

// Inventory area (/dashboard/inventory/**). Owner only: the profile owner, Business & E-commerce, on a plan with the Business Toolkit, never a
// demo account, and only once the Phase 4 tables exist. A UX redirect; /api/inventory/** and the database functions enforce the same rules.
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  // A Free owner in an entitled category sees this tool locked (what it does + an upgrade call to action) instead of being sent away. The tool itself
  // is never rendered, and its API and database functions still refuse a plan without the business tools.
  const lock = await resolveToolkitLock();
  if (lock.inventoryLocked) return <div className="max-w-5xl"><ToolkitLocked tool="inventory" /></div>;
  // not offered for this kind of business, or stock tracking is for shops only: said plainly, never an upgrade
  if (lock.unavailable || lock.inventoryUnavailable) return <div className="max-w-5xl"><ToolkitLocked tool="inventory" unavailable={lock.unavailable ?? "inventory"} /></div>;
  const owner = await requireInventoryOwner();
  if (!(await inventoryAvailable(owner as any))) redirect("/dashboard");
  return <div className="max-w-5xl">{children}</div>;
}
