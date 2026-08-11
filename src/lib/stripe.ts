import Stripe from "stripe";
import { getPlatformSettings } from "@/lib/platformSettings";

// A Stripe client can't be a static module-level export anymore now that
// the secret key can change at runtime via the admin settings UI (not
// just at deploy time via env vars) — so this resolves a fresh client
// per call instead. Creating a Stripe instance is cheap (no persistent
// connection), so there's no real cost to this.
export async function getStripeClient(): Promise<Stripe> {
  const settings = await getPlatformSettings();
  if (!settings.stripeEnabled) {
    throw new Error("Card payments are currently disabled by the platform admin.");
  }
  if (!settings.stripeSecretKey) {
    throw new Error("Stripe is not configured yet — set an API key in the admin settings page.");
  }

  // Deliberately NOT specifying apiVersion at all — not as a hardcoded
  // literal, and not even as `null`. The `stripe` package's accepted
  // apiVersion type is pinned to whatever was "latest" when that exact
  // package version was published and has changed shape between SDK
  // versions (sometimes accepting a version string, sometimes also
  // accepting null, sometimes neither matching what you'd expect) — so
  // any explicit value here is one `npm install` away from breaking the
  // build again for a reason that has nothing to do with this file.
  // Omitting the key entirely is the one form that's valid no matter
  // what the installed SDK version's type expects, since it's always an
  // optional property. Requests then simply use the account's
  // dashboard-configured default API version.
  return new Stripe(settings.stripeSecretKey);
}