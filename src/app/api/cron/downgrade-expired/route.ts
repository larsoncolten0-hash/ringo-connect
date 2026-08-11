import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Runs daily via Vercel Cron (see vercel.json). Fapshi mobile money has no
// stored payment method to auto-charge, so a Fapshi purchase grants 30
// days (plan_expires_at) rather than renewing itself the way a Stripe
// subscription does. This job is what actually enforces that expiry —
// without it, a lapsed Fapshi account would keep paid access forever.
//
// Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` on
// requests it triggers for a configured cron job, as long as CRON_SECRET
// is set as an env var on the project — that's what's being checked here.
// This also means the endpoint is safe to leave public: without the
// correct secret, it just returns 401.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: freePlan, error: freePlanError } = await admin
    .from("plans")
    .select("id")
    .eq("name", "free")
    .single();

  if (freePlanError || !freePlan) {
    console.error("Cron: free plan not found:", freePlanError?.message);
    return NextResponse.json({ error: "Free plan not found" }, { status: 500 });
  }

  const { data: expiredUsers, error: fetchError } = await admin
    .from("users")
    .select("id")
    .not("plan_expires_at", "is", null)
    .lt("plan_expires_at", new Date().toISOString());

  if (fetchError) {
    console.error("Cron: failed to fetch expired users:", fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!expiredUsers || expiredUsers.length === 0) {
    return NextResponse.json({ downgraded: 0 });
  }

  const ids = expiredUsers.map((u) => u.id);

  const { error: updateError } = await admin
    .from("users")
    .update({ plan_id: freePlan.id, payment_provider: null, plan_expires_at: null })
    .in("id", ids);

  if (updateError) {
    console.error("Cron: failed to downgrade expired users:", updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // admin_id is NOT NULL in the schema — there's no human admin behind an
  // automated downgrade, so each affected user is recorded as their own
  // actor here, with the automated reason spelled out in `details`.
  await admin.from("admin_audit_log").insert(
    ids.map((id) => ({
      admin_id: id,
      action: "plan_expired_downgrade",
      target_user_id: id,
      details: { reason: "Fapshi plan_expires_at passed without renewal", automated: true },
    }))
  );

  console.log(`Cron: downgraded ${ids.length} expired Fapshi account(s) to Free.`);
  return NextResponse.json({ downgraded: ids.length });
}