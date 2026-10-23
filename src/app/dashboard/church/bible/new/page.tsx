import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { ProgramEditor } from "@/components/church/bible/BibleScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// A new programme: needs permission to write drafts. It is saved as a DRAFT; publishing is a separate, confirmed step. The church and the permissions are resolved on the server; /api/church/bible/** re-checks every request.
export default async function ChurchBibleNewPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.manageBible) return <NoAccess section="bible" />;
  return <ProgramEditor caps={caps} />;
}
