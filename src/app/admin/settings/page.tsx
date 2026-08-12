import { getMaskedPlatformSettings } from "@/lib/platformSettings";
import SettingsForm from "@/components/admin/SettingsForm";

// Without this, Next.js's client-side Router Cache can serve a stale
// version of this page for up to 30s (sometimes longer in practice) when
// navigating back to it via a sidebar Link — meaning a change you just
// saved wouldn't visibly show up until a hard reload bypassed the cache
// entirely. Admin data should always be fresh, never cached client-side.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getMaskedPlatformSettings();
  return <SettingsForm initial={settings} />;
}