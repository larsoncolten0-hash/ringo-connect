import { redirect } from "next/navigation";
import InboxView from "@/components/inbox/InboxView";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { loadConversationList } from "@/lib/inbox/data";

export const dynamic = "force-dynamic";

// Conversation list. The profile comes from the session, never from the URL or the browser.
export default async function InboxPage() {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  const list = await loadConversationList(owner.supabase, owner.profileId);
  return <InboxView list={list} selectedId={null} thread={null} />;
}
