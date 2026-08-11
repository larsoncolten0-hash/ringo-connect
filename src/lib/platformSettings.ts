import { createAdminClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type PlatformSettings = {
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  fapshiApiUser: string | null;
  fapshiApiKey: string | null;
  fapshiBaseUrl: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePricePro: string | null;
  stripePriceBusiness: string | null;
};

/**
 * The single source of truth for payment provider config, used by every
 * checkout/webhook route instead of reading process.env directly. DB
 * values (set via the admin UI) take priority; falling back to env vars
 * means a deployment that hasn't touched the admin settings page yet
 * keeps working exactly as before — nothing breaks by adding this layer.
 */
/**
 * Safe to send to the client: booleans for whether each secret is
 * configured, plus the non-secret fields as-is. Never includes an actual
 * decrypted key/secret — even for an already-verified admin, there's no
 * legitimate reason the browser needs the real value, only whether one
 * is set and a way to overwrite it.
 */
export async function getMaskedPlatformSettings() {
  const settings = await getPlatformSettings();
  return {
    fapshiEnabled: settings.fapshiEnabled,
    stripeEnabled: settings.stripeEnabled,
    fapshiApiUserSet: !!settings.fapshiApiUser,
    fapshiApiKeySet: !!settings.fapshiApiKey,
    fapshiBaseUrl: settings.fapshiBaseUrl,
    stripeSecretKeySet: !!settings.stripeSecretKey,
    stripeWebhookSecretSet: !!settings.stripeWebhookSecret,
    stripePricePro: settings.stripePricePro,
    stripePriceBusiness: settings.stripePriceBusiness,
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("*").limit(1).single();

  return {
    fapshiEnabled: data?.fapshi_enabled ?? true,
    stripeEnabled: data?.stripe_enabled ?? true,
    fapshiApiUser: decryptSecret(data?.fapshi_api_user_encrypted) || process.env.FAPSHI_API_USER || null,
    fapshiApiKey: decryptSecret(data?.fapshi_api_key_encrypted) || process.env.FAPSHI_API_KEY || null,
    fapshiBaseUrl: data?.fapshi_base_url || process.env.FAPSHI_BASE_URL || "https://sandbox.fapshi.com",
    stripeSecretKey: decryptSecret(data?.stripe_secret_key_encrypted) || process.env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret:
      decryptSecret(data?.stripe_webhook_secret_encrypted) || process.env.STRIPE_WEBHOOK_SECRET || null,
    stripePricePro: data?.stripe_price_pro || process.env.STRIPE_PRICE_PRO || null,
    stripePriceBusiness: data?.stripe_price_business || process.env.STRIPE_PRICE_BUSINESS || null,
  };
}

/**
 * Updates platform settings. Only ever call this from an already
 * admin-verified API route (see src/lib/assertAdmin.ts) — this function
 * itself does not check permissions, since it uses the service-role
 * client which has no RLS to fall back on for protection.
 */
export async function updatePlatformSettings(
  patch: Partial<{
    fapshiEnabled: boolean;
    stripeEnabled: boolean;
    fapshiApiUser: string;
    fapshiApiKey: string;
    fapshiBaseUrl: string;
    stripeSecretKey: string;
    stripeWebhookSecret: string;
    stripePricePro: string;
    stripePriceBusiness: string;
  }>,
  updatedByUserId: string
) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("platform_settings").select("id").limit(1).single();
  if (!existing) throw new Error("platform_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.fapshiEnabled !== undefined) dbPatch.fapshi_enabled = patch.fapshiEnabled;
  if (patch.stripeEnabled !== undefined) dbPatch.stripe_enabled = patch.stripeEnabled;
  if (patch.fapshiBaseUrl !== undefined) dbPatch.fapshi_base_url = patch.fapshiBaseUrl;
  if (patch.stripePricePro !== undefined) dbPatch.stripe_price_pro = patch.stripePricePro;
  if (patch.stripePriceBusiness !== undefined) dbPatch.stripe_price_business = patch.stripePriceBusiness;

  // Secrets: only overwrite if a new non-empty value was actually
  // submitted — an empty string means "leave this one alone," not
  // "clear it." This matches how the admin UI works: fields show a
  // masked "configured" state, not the real value, so leaving a field
  // blank on save must not accidentally wipe an existing key.
  if (patch.fapshiApiUser) dbPatch.fapshi_api_user_encrypted = encryptSecret(patch.fapshiApiUser);
  if (patch.fapshiApiKey) dbPatch.fapshi_api_key_encrypted = encryptSecret(patch.fapshiApiKey);
  if (patch.stripeSecretKey) dbPatch.stripe_secret_key_encrypted = encryptSecret(patch.stripeSecretKey);
  if (patch.stripeWebhookSecret) dbPatch.stripe_webhook_secret_encrypted = encryptSecret(patch.stripeWebhookSecret);

  const { error } = await admin.from("platform_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}