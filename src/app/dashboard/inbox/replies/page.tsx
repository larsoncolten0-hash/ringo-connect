import { redirect } from "next/navigation";
import SavedRepliesManager from "@/components/inbox/SavedRepliesManager";
import { resolveInboxOwner } from "@/lib/inbox/access";
import { loadSavedReplies } from "@/lib/inbox/data";

export const dynamic = "force-dynamic";

// The owner's saved replies (templates). Owner only (the inbox layout also guards this). The list is read through the owner's own session and
// filtered on the session-derived profile id; every change goes through /api/inbox/saved-replies.
export default async function SavedRepliesPage() {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect("/dashboard");
  const { owner } = access;
  const replies = await loadSavedReplies(owner.supabase, owner.profileId);
  return <SavedRepliesManager items={replies.ok ? replies.items : []} available={replies.ok} />;
}
