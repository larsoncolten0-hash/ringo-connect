import { redirect } from "next/navigation";
import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import { listTemplates } from "@/lib/loyalty/templates";
import PackageTemplates from "@/components/loyalty/PackageTemplates";

export const dynamic = "force-dynamic";

export default async function LoyaltyPackagesPage() {
  const { profile } = await requireLoyaltyPage(["loyalty.manage"]);
  const options = getLoyaltyOptions(profile);
  if (!options.packages) redirect("/dashboard/loyalty");

  const templates = await listTemplates(profile.id);
  return <PackageTemplates templates={templates} actions={options.actions} />;
}
