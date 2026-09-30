import { createAdminClient } from "@/lib/supabase/server";
import { getTestAccountIds } from "@/lib/adminTestAccounts";
import { buildFollowUpRows, type FollowUpRow, type StaffRow } from "@/lib/customerFollowUp";

// Read-only loader for the admin Customer Follow-Up page. Uses the service-role client, so it must
// ONLY be called from an admin-gated server component (src/app/admin/layout.tsx redirects every
// non-admin before any admin page renders). It selects only the columns the page shows — never
// tokens, payout details or push endpoints/keys — and writes nothing.
const LIMIT = 5000;

export type FollowUpData = {
  rows: FollowUpRow[];
  staff: StaffRow[];
  /** False until the proposed customer_followups migration has been applied: the page still works
   *  read-only, and the mark/assign controls are hidden. */
  workflowAvailable: boolean;
};

export async function loadCustomerFollowUp(): Promise<FollowUpData> {
  const admin = createAdminClient();
  const [requests, users, profiles, phones, plans, sales, ambassadorProfiles, teams, pushSubs, followUps, test] = await Promise.all([
    admin.from("signup_requests").select("id, full_name, whatsapp_number, email, status, customer_paid, pending_fapshi_trans_id, created_user_id, referral_code, source, ambassador_code, requested_plan_id, created_at").order("created_at", { ascending: false }).limit(LIMIT),
    admin.from("users").select("id, email, role, plan_id, status, created_at, plan_expires_at, referred_by, affiliate_code, last_active_at, last_active_standalone, pwa_installed_at").limit(LIMIT),
    admin.from("profiles").select("id, user_id, name, username").limit(LIMIT),
    admin.from("profile_phone_numbers").select("profile_id, phone_number, sort_order").limit(LIMIT),
    admin.from("plans").select("id, name").limit(200),
    admin.from("ambassador_sales").select("signup_request_id, ambassador_id, team_id, customer_user_id").limit(LIMIT),
    admin.from("ambassador_profiles").select("id, user_id, team_id, sales_code").limit(LIMIT),
    admin.from("ambassador_teams").select("id, team_leader_user_id, name").limit(LIMIT),
    admin.from("push_subscriptions").select("user_id, user_agent").not("user_id", "is", null).limit(LIMIT),
    admin.from("customer_followups").select("subject_type, subject_id, status, follow_up_date, assigned_to, note, updated_at").limit(LIMIT),
    getTestAccountIds(admin),
  ]);

  const userRows = (users.data || []) as any[];
  const staff = userRows.filter((u) => u.role === "admin").map((u) => ({ id: u.id as string, email: (u.email as string) ?? null }));

  const rows = buildFollowUpRows({
    requests: (requests.data || []) as any[],
    users: userRows,
    profiles: (profiles.data || []) as any[],
    phones: (phones.data || []) as any[],
    plans: (plans.data || []) as any[],
    sales: (sales.data || []) as any[],
    ambassadorProfiles: (ambassadorProfiles.data || []) as any[],
    teams: (teams.data || []) as any[],
    pushSubs: (pushSubs.data || []) as any[],
    followUps: followUps.error ? [] : ((followUps.data || []) as any[]),
    staff,
    testUserIds: test.userIds,
  });
  return { rows, staff, workflowAvailable: !followUps.error };
}
