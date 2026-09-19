import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { listTemplates } from "@/lib/loyalty/templates";
import LoyaltyScanner from "@/components/loyalty/LoyaltyScanner";

export const dynamic = "force-dynamic";

export default async function LoyaltyScanPage() {
  const { profile, can } = await requireLoyaltyPage(["loyalty.scan"]);

  // Package templates are only needed to SELL a package from a customer's profile, which is a
  // loyalty.manage action. Staff who only scan never receive them.
  const templates = can.manage
    ? (await listTemplates(profile.id))
        .filter((tpl) => tpl.active && tpl.loyalty_package_template_items.length > 0)
        .map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          price: tpl.price,
          currency: tpl.currency,
          durationDays: tpl.duration_days,
          items: tpl.loyalty_package_template_items.map((i) => ({ actionKey: i.action_key, quantity: i.quantity })),
        }))
    : [];

  return <LoyaltyScanner can={can} username={profile.username} templates={templates} />;
}
