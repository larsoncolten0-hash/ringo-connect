import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import ContentView from "@/components/church/content/ContentView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Content Studio: the church's Daily Words (drafts, scheduled and live). The church and the permissions are resolved on the server; /api/church/content/** re-checks every request.
export default async function ChurchContentPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewContent) return <NoAccess section="content" />;
  return <ContentView caps={caps} />;
}
