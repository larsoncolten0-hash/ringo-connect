import { notFound, redirect } from "next/navigation";
import InboxView from "@/components/inbox/InboxView";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { LIST_LIMIT, countUnreadOpen, loadConversationList, loadSavedReplies, loadThread } from "@/lib/inbox/data";
import { cleanQueryParam, isStatusFilter, isUuid } from "@/lib/inbox/format";

export const dynamic = "force-dynamic";

// One conversation. The id in the URL only selects among the OWNER's conversations: the query also filters on the session-derived profile id,
// so another profile's id simply finds nothing ("not found"), exactly like an id that does not exist.
export default async function InboxThreadPage({ params, searchParams }: { params: { id: string }; searchParams?: { status?: string | string[]; q?: string | string[] } }) {
  if (!isUuid(params.id)) notFound();
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  // Lower-cased so the selected row is highlighted whichever case the URL used (the database treats uuids case-insensitively).
  const id = params.id.toLowerCase();
  const rawStatus = Array.isArray(searchParams?.status) ? searchParams?.status[0] : searchParams?.status;
  const q = cleanQueryParam(searchParams?.q);

  const [thread, savedReplies] = await Promise.all([loadThread(owner.supabase, owner.profileId, id), loadSavedReplies(owner.supabase, owner.profileId)]);
  // Without an explicit filter, the list shows the tab this conversation lives in (a closed conversation is found under Closed).
  const status = isStatusFilter(rawStatus) ? rawStatus : thread.ok ? thread.thread.conversation.status : "open";
  const [list, unreadOpen] = await Promise.all([
    loadConversationList(owner.supabase, owner.profileId, LIST_LIMIT, { status, query: q }),
    countUnreadOpen(owner.supabase, owner.profileId),
  ]);
  return <InboxView list={list} selectedId={id} thread={thread} filter={{ status, q }} unreadOpen={unreadOpen} savedReplies={savedReplies.ok ? savedReplies.items : null} />;
}
