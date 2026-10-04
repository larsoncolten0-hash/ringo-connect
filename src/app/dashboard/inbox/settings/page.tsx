import { redirect } from "next/navigation";
import InboxSettingsForm from "@/components/inbox/InboxSettingsForm";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { loadInboxSettings } from "@/lib/inbox/automationData";
import { DEFAULT_SETTINGS } from "@/lib/inbox/settings";

export const dynamic = "force-dynamic";

// The owner's inbox automation settings. Owner only (the inbox layout also guards this). Read through the owner's own session and filtered on
// the session-derived profile id; every change goes through /api/inbox/settings. When the settings cannot be read (for example before the database
// migration is applied) the form is shown disabled with a plain message instead of pretending defaults were saved.
export default async function InboxSettingsPage() {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  const res = await loadInboxSettings(owner.supabase, owner.profileId);
  return <InboxSettingsForm initial={res.ok ? res.settings : { ...DEFAULT_SETTINGS, businessHours: {} }} available={res.ok} />;
}
