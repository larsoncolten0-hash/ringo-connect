import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import LoyaltyShell from "@/components/loyalty/LoyaltyShell";

export const dynamic = "force-dynamic";

// Loyalty is available on every plan. Anyone with loyalty.scan or loyalty.manage (owners and
// admins hold both) can open it; each page below re-checks what it specifically needs, because
// a layout is not re-run when navigating between sibling pages.
export default async function LoyaltyLayout({ children }: { children: React.ReactNode }) {
  const { profile, can } = await requireLoyaltyPage(["loyalty.scan", "loyalty.manage"]);
  const options = getLoyaltyOptions(profile);

  return (
    <LoyaltyShell can={can} packagesOffered={options.packages} hidden={options.availability === "hidden"}>
      {children}
    </LoyaltyShell>
  );
}
