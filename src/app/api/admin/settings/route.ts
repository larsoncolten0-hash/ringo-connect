import { assertAdmin } from "@/lib/assertAdmin";
import { updatePlatformSettings, getMaskedPlatformSettings } from "@/lib/platformSettings";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  try {
    await updatePlatformSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Audit log deliberately does NOT record which secret values were set —
  // only that a settings change happened, and which non-secret fields
  // changed. A secret's value should never appear in a log anywhere.
  const nonSecretChanges: Record<string, any> = {};
  for (const key of [
    "fapshiEnabled",
    "stripeEnabled",
    "fapshiTestMode",
    "stripeTestMode",
    "stripePriceProTest",
    "stripePriceProYearlyTest",
    "stripePriceBusinessTest",
    "stripePriceBusinessYearlyTest",
    "stripePriceProLive",
    "stripePriceProYearlyLive",
    "stripePriceBusinessLive",
    "stripePriceBusinessYearlyLive",
    "manualPaymentName",
    "manualPaymentMtnNumber",
    "manualPaymentOrangeNumber",
  ]) {
    if (key in body) nonSecretChanges[key] = body[key];
  }
  const secretsChanged = [
    "fapshiApiUserTest",
    "fapshiApiKeyTest",
    "fapshiApiUserLive",
    "fapshiApiKeyLive",
    "stripeSecretKeyTest",
    "stripeWebhookSecretTest",
    "stripeSecretKeyLive",
    "stripeWebhookSecretLive",
  ].filter((k) => k in body && body[k]);

  const adminClient = createAdminClient();
  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "update_platform_settings",
    details: { ...nonSecretChanges, secretsChanged },
  });

  const masked = await getMaskedPlatformSettings();
  return NextResponse.json({ ok: true, settings: masked });
}