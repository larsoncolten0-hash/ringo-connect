// Page-level and navigation access for Record Sale. It is exactly the invoice-area gate (owner of the profile, an entitled Business Toolkit category, the plan
// flag, not a demo): the same server-side rules the API routes and the database function re-check. The navigation entry additionally waits until the database
// function sale_record exists, so nobody sees a Record Sale button before the migration that creates it has been applied.
import { createAdminClient } from "@/lib/supabase/server";
import { documentsNavVisible } from "@/lib/documents/access";

export { requireDocumentsOwner as requireSalesOwner } from "@/lib/documents/access";

/** True when sale_record exists. The probe is called with no actor, so it can only fail at the access check: it never reads or writes any business data. */
export async function saleRecordInstalled(admin: any): Promise<boolean> {
  try {
    const { error } = await admin.rpc("sale_record", {
      p_profile_id: "00000000-0000-4000-8000-000000000000", p_actor_user_id: null, p_locale: "en", p_lines: [], p_customer_id: null, p_method: "cash",
      p_sold_on: null, p_notes: null, p_client_request_id: null,
    });
    if (!error) return true;
    return !(["PGRST202", "42883", "42P01"].includes(String(error.code)) || /could not find the function|does not exist/i.test(String(error.message)));
  } catch {
    return false;
  }
}

export async function salesNavVisible(args: Parameters<typeof documentsNavVisible>[0]): Promise<boolean> {
  try {
    if (!(await documentsNavVisible(args))) return false;
    return await saleRecordInstalled(createAdminClient());
  } catch {
    return false;
  }
}
