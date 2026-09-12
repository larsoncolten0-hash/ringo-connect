import { redirect } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import QrCodeGenerator from "@/components/dashboard/QrCodeGenerator";

export const dynamic = "force-dynamic";

// Same gate as /dashboard/requests: full admins AND "super creators"
// (regular creators an admin has granted can_approve_requests to). See
// src/lib/assertAdmin.ts. Everyone else gets bounced to /dashboard — this
// page must gate itself since dashboard/layout.tsx isn't a security
// boundary.
export default async function QrCodePage() {
  const reviewer = await assertCanApproveRequests();
  if (!reviewer) redirect("/dashboard");

  const admin = createAdminClient();

  // Same scoping as /dashboard/requests: a super creator only picks from
  // customers they personally referred (users.referred_by — see
  // 2026-09-06_affiliate_system.sql), never the whole platform. A full
  // admin stays unscoped, same as /admin/qr-code.
  let profilesQuery = admin.from("profiles").select("username, name").order("username", { ascending: true });
  if (!reviewer.isAdmin) {
    const { data: referred } = await admin.from("users").select("id").eq("referred_by", reviewer.id);
    const referredIds = (referred || []).map((u) => u.id);
    profilesQuery = profilesQuery.in("user_id", referredIds.length ? referredIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: profiles } = await profilesQuery;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <QrCodeGenerator
      customers={(profiles || []).map((p) => ({ username: p.username, name: p.name }))}
      siteUrl={siteUrl}
    />
  );
}
