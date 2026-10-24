import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { CareEditor } from "@/components/church/care/CareScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// A new case: needs permission to write drafts. It is saved as a PRIVATE draft; consent and publishing are separate, deliberate steps.
export default async function ChurchNewCasePage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  if (actor.kind === "leader" || !actor.caps.manageCare) return <NoAccess section="care" />;
  return <CareEditor caps={actor.caps} />;
}
