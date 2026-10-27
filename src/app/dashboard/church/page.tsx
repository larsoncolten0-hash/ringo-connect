import { redirect } from "next/navigation";
import { resolveChurchActor } from "@/lib/church/actor";
import { accessibleChurchModules } from "@/lib/church/modules";
import ChurchHome from "@/components/church/workspace/ChurchHome";

export const dynamic = "force-dynamic";

// /dashboard/church: the church home, a grid of every section the signed-in person may open. A person who may open only ONE section goes straight to it (a grid of one
// card is a needless click). The list of sections and who may open each one is src/lib/church/modules.ts, the same list the section navigation uses; every section page re-checks on the server.
export default async function ChurchIndexPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  const { caps } = actor;
  const isOwner = actor.kind === "owner";
  const sections = accessibleChurchModules(caps, isOwner);

  if (sections.length <= 1) redirect(sections[0]?.href ?? "/dashboard");

  // the church's public name and picture (public profile fields, read with the person's own session)
  const { data } = await actor.supabase.from("profiles").select("name, username, avatar_url").eq("id", actor.profileId).maybeSingle();
  return (
    <ChurchHome
      caps={caps}
      isOwner={isOwner}
      church={{ name: typeof data?.name === "string" ? data.name : "", username: typeof data?.username === "string" ? data.username : null, avatarUrl: typeof data?.avatar_url === "string" ? data.avatar_url : null }}
    />
  );
}
