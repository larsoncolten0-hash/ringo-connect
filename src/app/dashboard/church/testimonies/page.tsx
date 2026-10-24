import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import TestimoniesList from "@/components/church/testimonies/TestimoniesList";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// The church's testimonies (private: names and phone numbers). The church and the permissions are resolved on the server; /api/church/testimonies/** re-checks every request. A group leader (not staff) has none.
export default async function ChurchTestimoniesPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (access.actor.kind === "leader" || !access.actor.caps.viewTestimonies) return <NoAccess section="testimonies" />;
  return <TestimoniesList />;
}
