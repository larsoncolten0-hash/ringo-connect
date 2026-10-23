import { redirect } from "next/navigation";
import { NoAccess } from "@/components/church/people/ChurchShell";
import MusicLinks from "@/components/church/music/MusicLinks";
import { resolveChurchActor } from "@/lib/church/actor";

export const dynamic = "force-dynamic";

// Church Music: the links to where the church's music already lives (Spotify, YouTube, ...), shown on the public page. The church and the permissions are resolved on the server;
// /api/church/music/** re-checks every request and the database decides what is read or written.
export default async function ChurchMusicPage() {
  const access = await resolveChurchActor();
  if (!access.ok) redirect("/dashboard");
  if (!access.actor.caps.manageMusic) return <NoAccess section="music" />;
  return <MusicLinks />;
}
