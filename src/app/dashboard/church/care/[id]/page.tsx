import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { CareEditor } from "@/components/church/care/CareScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One case. The id is only a pointer: it is loaded through /api/church/care/[id], which resolves the church and the permissions itself and answers 404 for anything that is not this church's.
export default async function ChurchCaseEditorPage({ params }: { params: { id: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  if (actor.kind === "leader" || !actor.caps.viewCare) return <NoAccess section="care" />;
  return <CareEditor id={params.id} caps={actor.caps} />;
}
