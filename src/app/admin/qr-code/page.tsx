import { createAdminClient } from "@/lib/supabase/server";
import QrCodeGenerator from "@/components/dashboard/QrCodeGenerator";

// No extra gate needed here — every /admin/* route is already restricted
// to role === "admin" by admin/layout.tsx. Super creators reach the same
// generator through /dashboard/qr-code instead (see that route for the
// weaker, assertCanApproveRequests-based gate they need).
export const dynamic = "force-dynamic";

export default async function AdminQrCodePage() {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("username, name")
    .order("username", { ascending: true });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <QrCodeGenerator
      customers={(profiles || []).map((p) => ({ username: p.username, name: p.name }))}
      siteUrl={siteUrl}
    />
  );
}
