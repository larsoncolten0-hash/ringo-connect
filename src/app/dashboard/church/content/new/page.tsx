import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import DailyWordEditor from "@/components/church/content/DailyWordEditor";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// A new Daily Word: needs permission to write drafts. The word is saved as a DRAFT; publishing is a separate, confirmed step.
export default async function NewDailyWordPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps } = access.actor;
  if (!caps.manageContent) return <NoAccess section="content" />;
  return <DailyWordEditor caps={caps} />;
}
