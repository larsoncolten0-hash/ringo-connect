import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import { listPrograms } from "@/lib/loyalty/programs";
import ProgramSetup from "@/components/loyalty/ProgramSetup";

export const dynamic = "force-dynamic";

export default async function LoyaltySetupPage() {
  const { profile } = await requireLoyaltyPage(["loyalty.manage"]);
  const options = getLoyaltyOptions(profile);
  const programs = await listPrograms(profile.id);

  return (
    <ProgramSetup
      programs={programs}
      options={{ actions: options.actions, programTypes: options.programTypes, packages: options.packages }}
      profileCurrency={profile.currency}
    />
  );
}
