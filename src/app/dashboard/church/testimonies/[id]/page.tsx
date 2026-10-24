import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import TestimonyDetail from "@/components/church/testimonies/TestimonyDetail";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// One testimony. The id is only a pointer: it is loaded through /api/church/testimonies/[id], which resolves the church and the permissions itself and answers 404 for anything that is not this church's.
export default async function ChurchTestimonyPage({ params }: { params: { id: string } }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  if (actor.kind === "leader" || !actor.caps.viewTestimonies) return <NoAccess section="testimonies" />;
  return <TestimonyDetail id={params.id} caps={actor.caps} />;
}
