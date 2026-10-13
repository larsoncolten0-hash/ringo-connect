import { redirect } from "next/navigation";
import SalesBotSwitchPanel from "@/components/inbox/SalesBotSwitchPanel";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { salesBotConfigured } from "@/lib/salesBot/ids";
import { loadSalesBotSwitch } from "@/lib/salesBot/settings";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The account OWNER's Smart Card sales bot switch, on its own Inbox page (not part of the automation settings). Owner only: a team member or anyone without their own
// WhatsApp account is sent back to the dashboard. The saved value is read through a service-role-only database function that re-checks ownership; when it cannot be
// read (for example before the database migration is applied) the panel says so instead of guessing. Whether the deployment has the bot configured is shown as a plain
// yes/no (never the number). Every change goes through /api/inbox/sales-bot.
export default async function InboxSalesBotPage() {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  let enabled: boolean | null = null;
  try {
    enabled = await loadSalesBotSwitch(createAdminClient() as any, owner.userId, owner.profileId);
  } catch {
    enabled = null;
  }
  return <SalesBotSwitchPanel enabled={enabled} deploymentConfigured={salesBotConfigured()} />;
}
