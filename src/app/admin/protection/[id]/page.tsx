import { notFound } from "next/navigation";
import { getAdminProtectionTransactionDetail } from "@/lib/protection/adminTransactions";
import AdminProtectionDetail from "@/components/admin/AdminProtectionDetail";

export const dynamic = "force-dynamic";

export default async function AdminProtectionDetailPage({ params }: { params: { id: string } }) {
  const detail = await getAdminProtectionTransactionDetail(params.id);
  if (!detail) return notFound();
  return <AdminProtectionDetail detail={detail} />;
}
