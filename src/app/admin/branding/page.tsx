import { getBrandingSettings } from "@/lib/branding";
import BrandingSettingsForm from "@/components/admin/BrandingSettingsForm";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back here can show stale values
// until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminBrandingPage() {
  const branding = await getBrandingSettings();
  return <BrandingSettingsForm initial={branding} />;
}
