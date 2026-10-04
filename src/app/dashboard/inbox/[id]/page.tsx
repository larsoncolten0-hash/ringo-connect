import { notFound, redirect } from "next/navigation";
import InboxView from "@/components/inbox/InboxView";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { loadConversationList, loadThread } from "@/lib/inbox/data";
import { isUuid } from "@/lib/inbox/format";

export const dynamic = "force-dynamic";

// One conversation. The id in the URL only selects among the OWNER's conversations: the query also filters on the session-derived profile id,
// so another profile's id simply finds nothing ("not found"), exactly like an id that does not exist.
export default async function InboxThreadPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  // Lower-cased so the selected row is highlighted whichever case the URL used (the database treats uuids case-insensitively).
  const id = params.id.toLowerCase();
  const [list, thread] = await Promise.all([loadConversationList(owner.supabase, owner.profileId), loadThread(owner.supabase, owner.profileId, id)]);
  return <InboxView list={list} selectedId={id} thread={thread} />;
}
