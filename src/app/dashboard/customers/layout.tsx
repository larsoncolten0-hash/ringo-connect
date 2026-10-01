import { redirect } from "next/navigation";
import { requireCustomersOwner, customersAvailable } from "@/lib/customers/access";

export const dynamic = "force-dynamic";

// Customers area (/dashboard/customers/**). Owner only: the profile owner, Business & E-commerce, on a plan with the Business Toolkit, never a demo
// account, and only once the Phase 3 contact table exists. A UX redirect; /api/customers/** and the database enforce the same rules independently.
export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireCustomersOwner();
  if (!(await customersAvailable(owner as any))) redirect("/dashboard");
  return <div className="max-w-5xl">{children}</div>;
}
