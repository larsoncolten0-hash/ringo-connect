import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { getOverviewStats } from "@/lib/loyalty/history";
import { listPrograms } from "@/lib/loyalty/programs";
import LoyaltyOverview from "@/components/loyalty/LoyaltyOverview";

export const dynamic = "force-dynamic";

export default async function LoyaltyOverviewPage() {
  const { profile, can } = await requireLoyaltyPage(["loyalty.scan", "loyalty.manage"]);

  // Numbers and programs are for people who manage loyalty; staff who only scan get the big
  // Scan Customer button and nothing else here.
  const programs = can.manage ? await listPrograms(profile.id) : [];
  const stats = can.manage && programs.length > 0 ? await getOverviewStats(profile.id, programs) : null;

  return <LoyaltyOverview can={can} programs={programs} stats={stats} />;
}
