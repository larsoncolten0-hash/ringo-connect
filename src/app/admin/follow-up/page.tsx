import { loadCustomerFollowUp } from "@/lib/customerFollowUpData";
import CustomerFollowUp from "@/components/admin/CustomerFollowUp";

// See src/app/admin/settings/page.tsx for why this is needed on every admin page.
export const dynamic = "force-dynamic";

// Customer Follow-Up — one read-only view over the existing registration, payment, subscription,
// attribution and app-install data (plus an optional follow-up workflow). Reached only through
// src/app/admin/layout.tsx, which redirects every non-admin server-side before this renders.
export default async function AdminFollowUpPage() {
  const data = await loadCustomerFollowUp();
  return <CustomerFollowUp rows={data.rows} staff={data.staff} workflowAvailable={data.workflowAvailable} />;
}
