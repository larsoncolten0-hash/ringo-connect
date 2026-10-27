import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import PubGroupsView from "@/components/church/pubgroups/PubGroupsView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The public group pages (Men, Women, Youths, Children): a leader, a welcome text and photos, shown on the church's public page. The church and the permissions are resolved on the server;
// /api/church/public-groups/** re-checks every request and the database decides what is read or written. Nothing here lists a member.
export default async function ChurchGroupPagesPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  if (!actor.caps.viewGroups) return <NoAccess section="pubgroups" />;
  const { data } = await actor.supabase.from("profiles").select("username").eq("id", actor.profileId).maybeSingle();
  return <PubGroupsView username={typeof data?.username === "string" ? data.username : null} canManage={actor.caps.manageGroups && actor.kind !== "leader"} />;
}
