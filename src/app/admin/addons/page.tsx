import { createAdminClient } from "@/lib/supabase/server";
import AddonsManager from "@/components/admin/AddonsManager";
import CardsLinkCard from "@/components/CardsLinkCard";

export const dynamic = "force-dynamic";

export default async function AdminAddonsPage() {
  const admin = createAdminClient();
  const { data: addons } = await admin.from("addons").select("*").order("sort_order", { ascending: true });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <CardsLinkCard siteUrl={siteUrl} />
      <AddonsManager addons={addons || []} />
    </div>
  );
}