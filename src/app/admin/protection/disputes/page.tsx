import { listAdminProtectionDisputes } from "@/lib/protection/adminDisputes";
import AdminProtectionDisputesView from "@/components/admin/AdminProtectionDisputesView";

export const dynamic = "force-dynamic";

export default async function AdminProtectionDisputesPage() {
  const disputes = await listAdminProtectionDisputes();
  return <AdminProtectionDisputesView disputes={disputes} />;
}
