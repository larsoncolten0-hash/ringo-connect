import { requireOwnProfile } from "@/lib/community/auth";
import CommunityTabs from "@/components/dashboard/CommunityTabs";

export const dynamic = "force-dynamic";

export default async function CommunityDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireOwnProfile();

  return (
    <div className="max-w-5xl">
      <CommunityTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
