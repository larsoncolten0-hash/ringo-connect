import { redirect } from "next/navigation";
import SavedRepliesManager from "@/components/inbox/SavedRepliesManager";
import { resolveInboxActor, actorCan } from "@/lib/inbox/actor";
import { loadSavedReplies } from "@/lib/inbox/data";

export const dynamic = "force-dynamic";

// Saved replies (templates) of the organization: the owner, or a team member with inbox.saved_replies (create / edit; DELETE is owner-only and the delete
// control is not shown to members). The list is read through the user's own session and filtered on the server-resolved organization id; every change
// goes through /api/inbox/saved-replies.
export default async function SavedRepliesPage() {
  const access = await resolveInboxActor();
  if (!access.ok) redirect("/dashboard");
  const owner = access.actor;
  if (owner.kind === "staff" && !actorCan(owner, "inbox.saved_replies")) redirect("/dashboard/inbox");
  const replies = await loadSavedReplies(owner.supabase, owner.profileId);
  return <SavedRepliesManager items={replies.ok ? replies.items : []} available={replies.ok} canDelete={owner.kind === "owner"} />;
}
