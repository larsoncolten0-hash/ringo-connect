import { assertAdmin } from "@/lib/assertAdmin";
import { redirect } from "next/navigation";
import { getAmbassadorAdminOverview } from "@/lib/ambassador/admin";
import AdminAmbassadorsView from "@/components/admin/AdminAmbassadorsView";

// Same reasoning as every other admin list page (see src/app/admin/settings/page.tsx) —
// this feeds live operational/financial data, never a stale cache.
export const dynamic = "force-dynamic";

export default async function AdminAmbassadorsPage() {
  const admin = await assertAdmin();
  if (!admin) redirect("/admin");

  const overview = await getAmbassadorAdminOverview();
  return <AdminAmbassadorsView overview={overview} />;
}
