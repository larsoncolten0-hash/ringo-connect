import { redirect } from "next/navigation";
import InboxView from "@/components/inbox/InboxView";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { LIST_LIMIT, countUnreadOpen, loadConversationList } from "@/lib/inbox/data";
import { cleanQueryParam, isStatusFilter } from "@/lib/inbox/format";

export const dynamic = "force-dynamic";

// Conversation list. The profile comes from the session, never from the URL or the browser. The only URL parameters are the list filter
// (status: open | closed | all) and the search text; both are validated/sanitised and only ever narrow the OWNER's own conversations.
export default async function InboxPage({ searchParams }: { searchParams?: { status?: string | string[]; q?: string | string[] } }) {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  const rawStatus = Array.isArray(searchParams?.status) ? searchParams?.status[0] : searchParams?.status;
  const status = isStatusFilter(rawStatus) ? rawStatus : "open";
  const q = cleanQueryParam(searchParams?.q);
  const [list, unreadOpen] = await Promise.all([
    loadConversationList(owner.supabase, owner.profileId, LIST_LIMIT, { status, query: q }),
    countUnreadOpen(owner.supabase, owner.profileId),
  ]);
  return <InboxView list={list} selectedId={null} thread={null} filter={{ status, q }} unreadOpen={unreadOpen} />;
}
