import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import CounsellingView from "@/components/church/counselling/CounsellingView";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Counselling requests: what people wrote when they asked to meet a pastor or counsellor. Private to the people holding the counselling permission. The church and the permissions are resolved on the server;
// /api/church/counselling/** re-checks every request and the database decides what is read or written. A group leader (not staff) never reaches this screen.
export default async function ChurchCounsellingPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  const { caps, kind } = access.actor;
  if (kind === "leader" || !caps.viewCounselling) return <NoAccess section="counselling" />;
  return <CounsellingView canDecide={caps.manageCounselling} />;
}
