import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// SIMULATION NOTICE
// This endpoint currently just marks the payment as successful without
// talking to Flutterwave at all — good enough to demo the upgrade flow.
// When wiring up real Flutterwave:
//   1. This route should instead create a Flutterwave payment link/session
//      and return its checkout URL to the client.
//   2. A separate route (e.g. /api/billing/webhook) should receive
//      Flutterwave's server-to-server webhook, VERIFY its signature, and
//      only then perform the plan_id update below.
//   3. Never trust a client-side "payment succeeded" call the way this
//      simulation does — always confirm via the provider's webhook.
//
// What's already production-shaped: the actual database write happens
// here, server-side, using the service-role key — a regular client can no
// longer update plan_id directly (see fix-restrict-users-update.sql).

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { planName } = await request.json();
  if (!["free", "pro", "business"].includes(planName)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: plan, error: planError } = await adminClient
    .from("plans")
    .select("id")
    .eq("name", planName)
    .single();

  if (planError || !plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // --- simulated payment step ---
  // A real integration replaces this whole block with a webhook handler.
  await new Promise((resolve) => setTimeout(resolve, 400));
  // --- end simulated payment step ---

  const { error: updateError } = await adminClient
    .from("users")
    .update({ plan_id: plan.id })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  await adminClient.from("admin_audit_log").insert({
    admin_id: user.id,
    action: "plan_upgrade_simulated",
    target_user_id: user.id,
    details: { planName },
  });

  return NextResponse.json({ ok: true, plan: planName });
}