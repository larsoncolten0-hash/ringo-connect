import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { ProgramsList } from "@/components/church/bible/BibleScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's Bible programmes (drafts and live). The church and the permissions are resolved on the server; /api/church/bible/** re-checks every request.
export default async function ChurchBibleListPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewBible) return <NoAccess section="bible" />;
  return <ProgramsList caps={caps} />;
}
