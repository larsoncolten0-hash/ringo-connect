import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Daily cleanup for "Try the dashboard" demo accounts (see
// supabase/migrations/2026-10-13_demo_accounts.sql) — finds every account
// past its 7-day demo_expires_at and fully deletes it: the auth.users row
// plus everything that cascades from it.
//
// A small, fixed set of "who did this" columns reference public.users(id)
// WITHOUT on delete cascade (confirmed by reading every migration's FK
// definitions live against the schema, not assumed) — deleting straight
// through would fail with a foreign key violation the moment a demo
// account had, say, changed an order's status or edited a team role during
// its 7 days. Those columns are explicitly nulled out first, per account,
// so deletion always succeeds regardless of what the account touched.
// Kept separate from downgrade-expired/route.ts: unrelated logic (deleting
// an account entirely vs. downgrading a real subscriber's plan), so each
// file stays focused on one thing.
const RESTRICT_COLUMNS: { table: string; column: string }[] = [
  { table: "affiliate_payouts", column: "processed_by" },
  { table: "music_payouts", column: "processed_by" },
  { table: "booking_status_history", column: "changed_by" },
  { table: "order_status_history", column: "changed_by" },
  { table: "organization_roles", column: "created_by" },
  { table: "organization_invitations", column: "accepted_by" },
  { table: "organization_activity_log", column: "actor_user_id" },
  { table: "organization_activity_log", column: "target_user_id" },
  { table: "admin_audit_log", column: "target_user_id" },
];

// Same Vercel Cron auth pattern as downgrade-expired/route.ts — see that
// file's own comment for why this is safe to leave publicly reachable.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: expired, error: fetchError } = await admin
    .from("profiles")
    .select("user_id")
    .eq("is_demo", true)
    .lt("demo_expires_at", new Date().toISOString());

  if (fetchError) {
    console.error("Cron: failed to fetch expired demo accounts:", fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((expired || []).map((p) => p.user_id).filter(Boolean)));

  let cleaned = 0;
  let failed = 0;

  // One account at a time, each independently try/caught — a single
  // account failing to clean up (an unexpected FK we haven't seen, a
  // transient DB error) must never stop every other expired account from
  // being cleaned up in the same run.
  for (const userId of userIds) {
    try {
      for (const { table, column } of RESTRICT_COLUMNS) {
        const { error } = await admin.from(table).update({ [column]: null }).eq(column, userId);
        if (error) throw new Error(`${table}.${column}: ${error.message}`);
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error(deleteError.message);

      cleaned++;
    } catch (err: any) {
      failed++;
      console.error(`Cron: failed to clean up demo account ${userId}:`, err.message || err);
    }
  }

  console.log(`Cron: cleaned up ${cleaned} expired demo account(s)${failed ? `, ${failed} failed` : ""}.`);
  return NextResponse.json({ cleaned, failed });
}
