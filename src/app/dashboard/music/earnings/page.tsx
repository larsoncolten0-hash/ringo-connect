import { requireMusicProfile } from "@/lib/musicAuth";
import { getMyMusicEarningsOverview } from "@/lib/musicEarnings";
import { notFound } from "next/navigation";
import MusicEarningsView from "@/components/music/MusicEarningsView";

export const dynamic = "force-dynamic";

export default async function MusicEarningsPage() {
  await requireMusicProfile();

  const overview = await getMyMusicEarningsOverview();
  if (!overview) return notFound();

  return <MusicEarningsView overview={overview} />;
}
