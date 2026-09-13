import { createAdminClient } from "@/lib/supabase/server";
import { listAdminConversations } from "@/lib/support";
import SupportInboxView from "@/components/admin/SupportInboxView";

// No extra gate needed — every /admin/* route is already restricted to
// role === "admin" by admin/layout.tsx (the API routes SupportInboxView
// calls re-check via assertAdmin() themselves, since a layout is never a
// security boundary on its own — same note as the Broadcast page).
export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const initialConversations = await listAdminConversations(createAdminClient());
  return <SupportInboxView initialConversations={initialConversations} />;
}
