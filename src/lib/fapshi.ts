// Server-only client for the Fapshi API (Cameroon mobile money — MTN
// MoMo and Orange Money). Verified against Fapshi's current docs
// (docs.fapshi.com):
//   POST /direct-pay          — prompts a USSD confirmation on the payer's phone
//   GET  /payment-status/{id} — check a transaction's status (works for
//                               both Collection and Payout transactions)
//   POST /payout              — disburses money OUT to a mobile money or
//                               Fapshi account (used for affiliate payouts)
//   GET  /balance             — the service account's current balance
//
// Credentials are resolved per-call via getPlatformSettings() rather than
// read from process.env at module load — that's what makes the admin
// settings UI actually take effect without a redeploy.
//
// IMPORTANT — IP whitelisting: Fapshi lets a service restrict transaction
// creation (initiate-pay, direct-pay, AND payout) to whitelisted server
// IPs, configured on the Fapshi dashboard. If that's turned on for this
// service and the deploying host's outbound IP isn't on the list, every
// call below fails with a 403 even with valid credentials — that's a
// dashboard configuration issue, not a bug in this file.

import { getPlatformSettings } from "@/lib/platformSettings";

function headers(apiUser: string, apiKey: string) {
  return {
    "Content-Type": "application/json",
    apiuser: apiUser,
    apikey: apiKey,
  };
}

export type FapshiMedium = "mobile money" | "orange money";

export type FapshiDirectPayResponse = {
  message: string;
  transId: string;
  dateInitiated: string;
};

export type FapshiStatus = "CREATED" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export type FapshiTransaction = {
  transId: string;
  status: FapshiStatus;
  medium: string;
  serviceName: string;
  // "Collection" = money coming in (direct-pay/initiate-pay); "Payout" =
  // money going out — this is how the same status endpoint tells the two
  // apart when checking a payout's transId.
  transType?: "Collection" | "Payout";
  amount: number;
  revenue: number;
  payerName: string | null;
  email: string | null;
  redirectUrl: string | null;
  externalId: string | null;
  userId: string | null;
  // Only meaningful on a failed/expired transaction.
  reason?: string | null;
  financialTransId: string | null;
  dateInitiated: string;
  dateConfirmed: string | null;
};

export type FapshiPayoutMedium = FapshiMedium | "fapshi";

export type FapshiPayoutResponse = {
  message: string;
  transId: string;
  dateInitiated: string;
};

export type FapshiBalance = {
  service: string;
  balance: number;
  currency: string;
};

async function resolveCredentials() {
  const settings = await getPlatformSettings();
  if (!settings.fapshiEnabled) {
    throw new Error("Fapshi payments are currently disabled by the platform admin.");
  }
  if (!settings.fapshiApiUser || !settings.fapshiApiKey) {
    throw new Error("Fapshi is not configured yet — set API keys in the admin settings page.");
  }
  return settings;
}

/**
 * Credentials for the DISBURSEMENT service — falls back to the collection
 * service's credentials if a dedicated payout apiuser/apikey hasn't been
 * set, so this works before an admin fills in the separate pair. Used by
 * fapshiPayout, fapshiGetBalance, and fapshiGetStatus when checking a
 * payout transaction.
 */
async function resolvePayoutCredentials() {
  const settings = await getPlatformSettings();
  if (!settings.fapshiEnabled) {
    throw new Error("Fapshi payments are currently disabled by the platform admin.");
  }
  const apiUser = settings.fapshiPayoutApiUser || settings.fapshiApiUser;
  const apiKey = settings.fapshiPayoutApiKey || settings.fapshiApiKey;
  if (!apiUser || !apiKey) {
    throw new Error("Fapshi disbursement is not configured yet — set payout API keys in the admin settings page.");
  }
  return { ...settings, fapshiApiUser: apiUser, fapshiApiKey: apiKey };
}

/** Prompts a USSD confirmation directly on the payer's phone — no redirect. */
export async function fapshiDirectPay(params: {
  amount: number; // whole XAF, no decimals
  phone: string; // local format, e.g. "677123456"
  medium: FapshiMedium;
  userId: string;
  externalId: string;
  message?: string;
}): Promise<FapshiDirectPayResponse> {
  const settings = await resolveCredentials();

  const res = await fetch(`${settings.fapshiBaseUrl}/direct-pay`, {
    method: "POST",
    headers: headers(settings.fapshiApiUser!, settings.fapshiApiKey!),
    body: JSON.stringify(params),
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi direct-pay failed (${res.status})`);
  }
  return data;
}

export async function fapshiGetStatus(
  transId: string,
  opts?: { disbursement?: boolean }
): Promise<FapshiTransaction> {
  // A payout transaction was created under the disbursement service's
  // credentials — Fapshi's API scopes a transaction lookup to the
  // service that created it, so checking one needs the SAME credentials
  // fapshiPayout used, not the collection ones.
  const settings = opts?.disbursement ? await resolvePayoutCredentials() : await resolveCredentials();

  const res = await fetch(`${settings.fapshiBaseUrl}/payment-status/${transId}`, {
    method: "GET",
    headers: headers(settings.fapshiApiUser!, settings.fapshiApiKey!),
    // A status check exists specifically to get the CURRENT state — never
    // let Next.js's default fetch caching hand back a stale "PENDING"
    // from an earlier check. See the `dynamic` export on the pay-status
    // route for the other half of this fix.
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi payment-status failed (${res.status})`);
  }
  return data;
}

/** Local Cameroon mobile numbers only — strips spaces/dashes and a leading
 *  country code (+237 / 237) so "677 12 34 56" and "+237677123456" both
 *  normalize to the plain 9-digit form Fapshi expects. */
export function normalizeCameroonPhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

/**
 * Sends money OUT — to a mobile money/Orange Money number, or to another
 * Fapshi service account. Used for affiliate payouts (currency must be
 * XAF; Fapshi doesn't move any other currency).
 *
 * Same IP-whitelisting caveat as fapshiDirectPay: if the Fapshi dashboard
 * restricts this service to specific server IPs, a call from a
 * non-whitelisted host fails with 403 regardless of valid credentials.
 */
export async function fapshiPayout(params: {
  amount: number; // whole XAF, minimum 100 per Fapshi's docs
  phone?: string; // required unless medium is "fapshi"
  medium?: FapshiPayoutMedium; // auto-detected from the phone's prefix if omitted
  name?: string;
  email?: string; // required when medium is "fapshi"
  userId?: string;
  externalId?: string;
  message?: string;
}): Promise<FapshiPayoutResponse> {
  const settings = await resolvePayoutCredentials();

  const body = { ...params, phone: params.phone ? normalizeCameroonPhone(params.phone) : undefined };

  const res = await fetch(`${settings.fapshiBaseUrl}/payout`, {
    method: "POST",
    headers: headers(settings.fapshiApiUser!, settings.fapshiApiKey!),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi payout failed (${res.status})`);
  }
  return data;
}

/** The service account's current spendable balance — check this before
 *  approving a payout so it doesn't fail partway through for insufficient
 *  funds. Sandbox returns a random balance on every call (per Fapshi's
 *  own docs), so this is only meaningful in live mode. */
export async function fapshiGetBalance(): Promise<FapshiBalance> {
  // The disbursement service's balance specifically — that's the account
  // payouts actually draw from, which is what this exists to preview.
  const settings = await resolvePayoutCredentials();

  const res = await fetch(`${settings.fapshiBaseUrl}/balance`, {
    method: "GET",
    headers: headers(settings.fapshiApiUser!, settings.fapshiApiKey!),
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi balance check failed (${res.status})`);
  }
  return data;
}