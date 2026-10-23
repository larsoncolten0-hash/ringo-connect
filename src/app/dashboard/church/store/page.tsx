import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import ChurchStoreEntry from "@/components/church/store/ChurchStoreEntry";
import { resolveChurchActor } from "@/lib/church/actor";
import { shopIsVisibleFor } from "@/lib/shopAuth";

export const dynamic = "force-dynamic";

// Church Store: an entry to the church's existing Shop (no store of its own, no table, no payment code here). Owner only, because the Shop is owner only. The Shop link is offered only when the Shop
// is available for this profile (the same test the dashboard menu uses).
export default async function ChurchStorePage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  if (actor.kind !== "owner") return <NoAccess section="store" />;
  const { data: profile } = await actor.supabase.from("profiles").select("id, category, categories").eq("id", actor.profileId).maybeSingle();
  const shopAvailable = await shopIsVisibleFor(actor.supabase, profile as { id: string; category?: string | null; categories?: string[] | null } | null);
  return <ChurchStoreEntry shopAvailable={shopAvailable} />;
}
