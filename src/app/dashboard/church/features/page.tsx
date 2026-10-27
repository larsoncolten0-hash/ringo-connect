import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import FeaturesView from "@/components/church/features/FeaturesView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's feature switches (Bible in one year, counselling, giving). Church OWNER only: the church and the role are resolved on the server; /api/church/features re-checks every request.
export default async function ChurchFeaturesPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (access.actor.kind !== "owner") return <NoAccess section="features" />;
  return <FeaturesView />;
}
