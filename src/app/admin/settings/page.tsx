import { getMaskedPlatformSettings } from "@/lib/platformSettings";
import SettingsForm from "@/components/admin/SettingsForm";

export default async function AdminSettingsPage() {
  const settings = await getMaskedPlatformSettings();
  return <SettingsForm initial={settings} />;
}