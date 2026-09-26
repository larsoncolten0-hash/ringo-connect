import { listAdminProtectionRefunds } from "@/lib/protection/adminRefunds";
import AdminProtectionRefundsView from "@/components/admin/AdminProtectionRefundsView";

export const dynamic = "force-dynamic";

export default async function AdminProtectionRefundsPage() {
  const refunds = await listAdminProtectionRefunds();
  return <AdminProtectionRefundsView refunds={refunds} />;
}
