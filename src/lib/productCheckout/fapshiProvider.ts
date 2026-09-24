// Adapter from the generic PaymentProvider boundary onto the EXISTING Fapshi client (src/lib/fapshi.ts).
// Nothing in fapshi.ts changes; credentials, sandbox/live mode and the platform kill switch all keep
// coming from getPlatformSettings() there. Server only.

import { fapshiDirectPay, fapshiGetStatus } from "@/lib/fapshi";
import type { PaymentProvider } from "./types";

export function createFapshiProvider(): PaymentProvider {
  return {
    async directPay({ amount, phone, medium, userId, externalId, message }) {
      const res = await fapshiDirectPay({ amount, phone, medium, userId, externalId, message });
      return { transId: res.transId };
    },
    async getStatus(transId) {
      const tx = await fapshiGetStatus(transId);
      return {
        status: tx.status,
        amount: typeof tx.amount === "number" && Number.isFinite(tx.amount) ? tx.amount : null,
        reason: tx.reason ?? null,
      };
    },
  };
}
