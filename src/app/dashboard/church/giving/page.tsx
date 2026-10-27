import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import GivingView from "@/components/church/giving/GivingView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The giving and care funds of the church (definitions only: nothing collects money yet). The church and the permissions are resolved on the server;
// /api/church/giving-funds re-checks every request and the database decides what is read or written.
export default async function ChurchGivingPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (!access.actor.caps.manageGiving) return <NoAccess section="giving" />;
  return <GivingView />;
}
