import { redirect } from "next/navigation";
import ChurchShell, { NoAccess } from "@/components/church/people/ChurchShell";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Church workspace (/dashboard/church/**): People, Groups and Leadership. The church is the signed-in user's own (owner), or the one they work in as a team member with at least one church
// permission; the active-organization cookie only picks among those. A UX redirect on top of the real boundary: every page below re-resolves the actor and every /api/church/** request does
// the same, and the database's row-level security decides what is read or written.
export default async function ChurchLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveChurchActor();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  const { actor } = access;
  // a group leader is a person on the roster, not a dashboard user: they have no church workspace here
  if (actor.kind === "leader") return <NoAccess />;
  return (
    <ChurchShell caps={actor.caps} isOwner={actor.kind === "owner"}>
      {children}
    </ChurchShell>
  );
}
