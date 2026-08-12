import { createAdminClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// The external shape stays exactly the same as before test/live mode
// existed — getPlatformSettings() resolves which credential set is
// active internally and returns flat values. This means fapshi.ts,
// stripe.ts, and every checkout/webhook route needed ZERO changes to
// support test/live mode; they only ever see "the currently active
// credentials," never the test/live distinction itself.
export type PlatformSettings = {
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  fapshiTestMode: boolean;
  stripeTestMode: boolean;
  fapshiApiUser: string | null;
  fapshiApiKey: string | null;
  fapshiBaseUrl: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePricePro: string | null;
  stripePriceBusiness: string | null;
  stripePriceProYearly: string | null;
  stripePriceBusinessYearly: string | null;
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("*").limit(1).single();

  const fapshiTestMode = data?.fapshi_test_mode ?? true;
  const stripeTestMode = data?.stripe_test_mode ?? true;

  const fapshiApiUser = fapshiTestMode
    ? decryptSecret(data?.fapshi_api_user_test_encrypted)
    : decryptSecret(data?.fapshi_api_user_live_encrypted);
  const fapshiApiKey = fapshiTestMode
    ? decryptSecret(data?.fapshi_api_key_test_encrypted)
    : decryptSecret(data?.fapshi_api_key_live_encrypted);

  const stripeSecretKey = stripeTestMode
    ? decryptSecret(data?.stripe_secret_key_test_encrypted)
    : decryptSecret(data?.stripe_secret_key_live_encrypted);
  const stripeWebhookSecret = stripeTestMode
    ? decryptSecret(data?.stripe_webhook_secret_test_encrypted)
    : decryptSecret(data?.stripe_webhook_secret_live_encrypted);

  return {
    fapshiEnabled: data?.fapshi_enabled ?? true,
    stripeEnabled: data?.stripe_enabled ?? true,
    fapshiTestMode,
    stripeTestMode,
    fapshiApiUser: fapshiApiUser || process.env.FAPSHI_API_USER || null,
    fapshiApiKey: fapshiApiKey || process.env.FAPSHI_API_KEY || null,
    // Base URL is derived from the mode automatically — no separate field
    // to keep in sync with the credentials.
    fapshiBaseUrl: fapshiTestMode ? "https://sandbox.fapshi.com" : "https://live.fapshi.com",
    stripeSecretKey: stripeSecretKey || process.env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || null,
    stripePricePro:
      (stripeTestMode ? data?.stripe_price_pro_test : data?.stripe_price_pro_live) ||
      process.env.STRIPE_PRICE_PRO ||
      null,
    stripePriceBusiness:
      (stripeTestMode ? data?.stripe_price_business_test : data?.stripe_price_business_live) ||
      process.env.STRIPE_PRICE_BUSINESS ||
      null,
    stripePriceProYearly:
      (stripeTestMode ? data?.stripe_price_pro_yearly_test : data?.stripe_price_pro_yearly_live) ||
      process.env.STRIPE_PRICE_PRO_YEARLY ||
      null,
    stripePriceBusinessYearly:
      (stripeTestMode ? data?.stripe_price_business_yearly_test : data?.stripe_price_business_yearly_live) ||
      process.env.STRIPE_PRICE_BUSINESS_YEARLY ||
      null,
  };
}

/**
 * Safe to send to the client: booleans for whether each secret is
 * configured (both test AND live, independently), the mode toggles, and
 * non-secret fields as-is. Never includes an actual decrypted value.
 */
export async function getMaskedPlatformSettings() {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("*").limit(1).single();

  return {
    fapshiEnabled: data?.fapshi_enabled ?? true,
    stripeEnabled: data?.stripe_enabled ?? true,
    fapshiTestMode: data?.fapshi_test_mode ?? true,
    stripeTestMode: data?.stripe_test_mode ?? true,

    fapshiApiUserTestSet: !!data?.fapshi_api_user_test_encrypted,
    fapshiApiKeyTestSet: !!data?.fapshi_api_key_test_encrypted,
    fapshiApiUserLiveSet: !!data?.fapshi_api_user_live_encrypted,
    fapshiApiKeyLiveSet: !!data?.fapshi_api_key_live_encrypted,

    stripeSecretKeyTestSet: !!data?.stripe_secret_key_test_encrypted,
    stripeWebhookSecretTestSet: !!data?.stripe_webhook_secret_test_encrypted,
    stripePriceProTest: data?.stripe_price_pro_test || null,
    stripePriceProYearlyTest: data?.stripe_price_pro_yearly_test || null,
    stripePriceBusinessTest: data?.stripe_price_business_test || null,
    stripePriceBusinessYearlyTest: data?.stripe_price_business_yearly_test || null,

    stripeSecretKeyLiveSet: !!data?.stripe_secret_key_live_encrypted,
    stripeWebhookSecretLiveSet: !!data?.stripe_webhook_secret_live_encrypted,
    stripePriceProLive: data?.stripe_price_pro_live || null,
    stripePriceProYearlyLive: data?.stripe_price_pro_yearly_live || null,
    stripePriceBusinessLive: data?.stripe_price_business_live || null,
    stripePriceBusinessYearlyLive: data?.stripe_price_business_yearly_live || null,
  };
}

export type PlatformSettingsPatch = Partial<{
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  fapshiTestMode: boolean;
  stripeTestMode: boolean;

  fapshiApiUserTest: string;
  fapshiApiKeyTest: string;
  fapshiApiUserLive: string;
  fapshiApiKeyLive: string;

  stripeSecretKeyTest: string;
  stripeWebhookSecretTest: string;
  stripePriceProTest: string;
  stripePriceProYearlyTest: string;
  stripePriceBusinessTest: string;
  stripePriceBusinessYearlyTest: string;

  stripeSecretKeyLive: string;
  stripeWebhookSecretLive: string;
  stripePriceProLive: string;
  stripePriceProYearlyLive: string;
  stripePriceBusinessLive: string;
  stripePriceBusinessYearlyLive: string;
}>;

/**
 * Updates platform settings. Only ever call this from an already
 * admin-verified API route (see src/lib/assertAdmin.ts) — this function
 * itself does not check permissions, since it uses the service-role
 * client which has no RLS to fall back on for protection.
 */
export async function updatePlatformSettings(patch: PlatformSettingsPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.fapshiEnabled !== undefined) dbPatch.fapshi_enabled = patch.fapshiEnabled;
  if (patch.stripeEnabled !== undefined) dbPatch.stripe_enabled = patch.stripeEnabled;
  if (patch.fapshiTestMode !== undefined) dbPatch.fapshi_test_mode = patch.fapshiTestMode;
  if (patch.stripeTestMode !== undefined) dbPatch.stripe_test_mode = patch.stripeTestMode;

  // Price IDs aren't secret — stored plainly, overwritten whenever a
  // value is explicitly provided (including clearing to empty).
  if (patch.stripePriceProTest !== undefined) dbPatch.stripe_price_pro_test = patch.stripePriceProTest;
  if (patch.stripePriceProYearlyTest !== undefined)
    dbPatch.stripe_price_pro_yearly_test = patch.stripePriceProYearlyTest;
  if (patch.stripePriceBusinessTest !== undefined)
    dbPatch.stripe_price_business_test = patch.stripePriceBusinessTest;
  if (patch.stripePriceBusinessYearlyTest !== undefined)
    dbPatch.stripe_price_business_yearly_test = patch.stripePriceBusinessYearlyTest;

  if (patch.stripePriceProLive !== undefined) dbPatch.stripe_price_pro_live = patch.stripePriceProLive;
  if (patch.stripePriceProYearlyLive !== undefined)
    dbPatch.stripe_price_pro_yearly_live = patch.stripePriceProYearlyLive;
  if (patch.stripePriceBusinessLive !== undefined)
    dbPatch.stripe_price_business_live = patch.stripePriceBusinessLive;
  if (patch.stripePriceBusinessYearlyLive !== undefined)
    dbPatch.stripe_price_business_yearly_live = patch.stripePriceBusinessYearlyLive;

  // Secrets: only overwrite if a new non-empty value was actually
  // submitted — an empty string means "leave this one alone," not
  // "clear it." Matches how the form works: fields show a masked
  // "configured" state, not the real value, so leaving a field blank on
  // save must not accidentally wipe an existing key.
  if (patch.fapshiApiUserTest) dbPatch.fapshi_api_user_test_encrypted = encryptSecret(patch.fapshiApiUserTest);
  if (patch.fapshiApiKeyTest) dbPatch.fapshi_api_key_test_encrypted = encryptSecret(patch.fapshiApiKeyTest);
  if (patch.fapshiApiUserLive) dbPatch.fapshi_api_user_live_encrypted = encryptSecret(patch.fapshiApiUserLive);
  if (patch.fapshiApiKeyLive) dbPatch.fapshi_api_key_live_encrypted = encryptSecret(patch.fapshiApiKeyLive);

  if (patch.stripeSecretKeyTest)
    dbPatch.stripe_secret_key_test_encrypted = encryptSecret(patch.stripeSecretKeyTest);
  if (patch.stripeWebhookSecretTest)
    dbPatch.stripe_webhook_secret_test_encrypted = encryptSecret(patch.stripeWebhookSecretTest);
  if (patch.stripeSecretKeyLive)
    dbPatch.stripe_secret_key_live_encrypted = encryptSecret(patch.stripeSecretKeyLive);
  if (patch.stripeWebhookSecretLive)
    dbPatch.stripe_webhook_secret_live_encrypted = encryptSecret(patch.stripeWebhookSecretLive);

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}