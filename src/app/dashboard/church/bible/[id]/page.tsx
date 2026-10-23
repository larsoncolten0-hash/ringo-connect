import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { ProgramEditor } from "@/components/church/bible/BibleScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One programme. The id is only a pointer: it is loaded through /api/church/bible/[id], which resolves the church and the permissions itself and answers 404 for anything that is not this church's. The church and the permissions are resolved on the server; /api/church/bible/** re-checks every request.
export default async function ChurchBibleEditPage({ params }: { params: { id: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewBible) return <NoAccess section="bible" />;
  return <ProgramEditor id={params.id} caps={caps} />;
}
