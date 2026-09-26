// Adapter from Protection's ProtectionPaymentProvider boundary onto the EXISTING Fapshi client
// (src/lib/fapshi.ts). Nothing in fapshi.ts changes — same credentials, sandbox/live mode and
// platform kill switch, all still resolved from getPlatformSettings() there. Mirrors
// productCheckout/fapshiProvider.ts's own shape exactly, kept as its own file (not shared) so
// Protection's checkout lane never imports anything from productCheckout. Server only.

import { fapshiDirectPay, fapshiGetStatus } from "@/lib/fapshi";
import type { ProtectionPaymentProvider } from "./checkoutTypes";

export function createProtectionFapshiProvider(): ProtectionPaymentProvider {
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
