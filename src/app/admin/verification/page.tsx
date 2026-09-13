import { createAdminClient } from "@/lib/supabase/server";
import { listVerificationRequests } from "@/lib/verification";
import VerificationRequestsView from "@/components/admin/VerificationRequestsView";

// No extra gate needed — every /admin/* route is already restricted to
// role === "admin" by admin/layout.tsx (the API routes
// VerificationRequestsView calls re-check via assertAdmin() themselves,
// since a layout is never a security boundary on its own — same note as
// the Broadcast and Support pages).
export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  const initialRequests = await listVerificationRequests(createAdminClient());
  return <VerificationRequestsView initialRequests={initialRequests} />;
}
