import { redirect } from "next/navigation";
import { resolveChurchActor } from "@/lib/church/actor";
import ChurchHome from "@/components/church/workspace/ChurchHome";

export const dynamic = "force-dynamic";

// /dashboard/church: the church home, a grid of every section the signed-in person may open. A person who may open only ONE section goes straight to it (a grid of one
// card is a needless click). The capability checks below are the same ones the section navigation uses; every section page re-checks on the server.
export default async function ChurchIndexPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  const { caps } = actor;
  const isOwner = actor.kind === "owner";
  // one entry per section of churchModules (ChurchShell.tsx), in its order: a client module's function cannot be called from this server page, so the list is mirrored here
  const sections = [caps.viewMembers || caps.viewChildren, caps.viewGroups, caps.viewLeadership, caps.viewContent, caps.viewEvents, caps.viewEvents, caps.viewBible, caps.viewAttendance, caps.manageMusic, caps.viewReports, caps.viewCare, caps.viewTestimonies, isOwner].filter(Boolean).length;

  if (sections <= 1) {
    if (caps.viewMembers || caps.viewChildren) redirect("/dashboard/church/people");
    if (caps.viewGroups) redirect("/dashboard/church/groups");
    if (caps.viewLeadership) redirect("/dashboard/church/leadership");
    if (caps.viewContent) redirect("/dashboard/church/content");
    if (caps.viewEvents) redirect("/dashboard/church/events");
    if (caps.viewBible) redirect("/dashboard/church/bible");
    if (caps.viewAttendance) redirect("/dashboard/church/attendance");
    if (caps.manageMusic) redirect("/dashboard/church/music");
    if (caps.viewReports) redirect("/dashboard/church/reports");
    if (caps.viewCare) redirect("/dashboard/church/care");
    if (caps.viewTestimonies) redirect("/dashboard/church/testimonies");
    if (isOwner) redirect("/dashboard/church/store");
    redirect("/dashboard");
  }

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
