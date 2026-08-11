// Server-only client for the Fapshi API (Cameroon mobile money — MTN
// MoMo and Orange Money). Verified against Fapshi's current docs
// (docs.fapshi.com):
//   POST /direct-pay          — prompts a USSD confirmation on the payer's phone
//   GET  /payment-status/{id} — check a transaction's status
//
// Credentials are resolved per-call via getPlatformSettings() rather than
// read from process.env at module load — that's what makes the admin
// settings UI actually take effect without a redeploy.

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
  amount: number;
  revenue: number;
  payerName: string | null;
  email: string | null;
  redirectUrl: string | null;
  externalId: string | null;
  userId: string | null;
  financialTransId: string | null;
  dateInitiated: string;
  dateConfirmed: string | null;
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
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi direct-pay failed (${res.status})`);
  }
  return data;
}

export async function fapshiGetStatus(transId: string): Promise<FapshiTransaction> {
  const settings = await resolveCredentials();

  const res = await fetch(`${settings.fapshiBaseUrl}/payment-status/${transId}`, {
    method: "GET",
    headers: headers(settings.fapshiApiUser!, settings.fapshiApiKey!),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Fapshi payment-status failed (${res.status})`);
  }
  return data;
}