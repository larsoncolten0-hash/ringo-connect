import { redirect } from "next/navigation";
import InboxView from "@/components/inbox/InboxView";
import { resolveInboxActor } from "@/lib/inbox/actor";
import { LIST_LIMIT, countUnreadOpen, loadConversationList } from "@/lib/inbox/data";
import { loadAutomationView } from "@/lib/inbox/automationData";
import { cleanQueryParam, isStatusFilter } from "@/lib/inbox/format";

export const dynamic = "force-dynamic";

// Conversation list. The organization comes from the session / the database (owner, or a team member the database admitted), never from the URL or the browser. The only URL parameters are the list filter
// (status: open | closed | all) and the search text; both are validated/sanitised and only ever narrow the conversations of that organization.
export default async function InboxPage({ searchParams }: { searchParams?: { status?: string | string[]; q?: string | string[] } }) {
  const access = await resolveInboxActor();
  if (!access.ok) redirect("/dashboard");
  const owner = access.actor;
  const rawStatus = Array.isArray(searchParams?.status) ? searchParams?.status[0] : searchParams?.status;
  const status = isStatusFilter(rawStatus) ? rawStatus : "open";
  const q = cleanQueryParam(searchParams?.q);
  const [list, unreadOpen] = await Promise.all([
    loadConversationList(owner.supabase, owner.profileId, LIST_LIMIT, { status, query: q }),
    countUnreadOpen(owner.supabase, owner.profileId),
  ]);
  // lead signals and automation come from owner-only tables: a team member never sees them
  const automation = list.ok && owner.kind === "owner" ? await loadAutomationView(owner.supabase, owner.profileId, list.items.map((i) => i.id)) : null;
  return <InboxView list={list} selectedId={null} thread={null} filter={{ status, q }} unreadOpen={unreadOpen} automation={automation} access={{ kind: owner.kind, permissions: owner.permissions }} />;
}
