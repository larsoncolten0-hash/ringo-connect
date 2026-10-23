import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import DailyWordEditor from "@/components/church/content/DailyWordEditor";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One Daily Word. The id is only a pointer: the entry is loaded through /api/church/content/[id], which resolves the church and the permissions itself and answers 404 for anything that is not this church's.
export default async function DailyWordPage({ params }: { params: { id: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.viewContent) return <NoAccess section="content" />;
  return <DailyWordEditor id={params.id} caps={caps} />;
}
