import { requireMusicProfile } from "@/lib/musicAuth";
import MusicTabs from "@/components/music/MusicTabs";

export const dynamic = "force-dynamic";

export default async function MusicDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireMusicProfile();

  return (
    <div className="max-w-5xl">
      <MusicTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
