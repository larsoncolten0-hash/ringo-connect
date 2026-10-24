import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import { CareList } from "@/components/church/care/CareScreens";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's care cases (private drafts and published). The church and the permissions are resolved on the server; /api/church/care/** re-checks every request. A group leader (not staff) has none.
export default async function ChurchCareListPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (access.actor.kind === "leader" || !access.actor.caps.viewCare) return <NoAccess section="care" />;
  return <CareList caps={access.actor.caps} />;
}
