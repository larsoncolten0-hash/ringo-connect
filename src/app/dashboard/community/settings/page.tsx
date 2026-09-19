import { requireOwnProfile } from "@/lib/community/auth";
import CommunitySettingsCard from "@/components/dashboard/CommunitySettingsCard";

export const dynamic = "force-dynamic";

export default async function CommunitySettingsPage() {
  const { profile } = await requireOwnProfile();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <CommunitySettingsCard username={profile.username} siteUrl={siteUrl} />
  );
}
