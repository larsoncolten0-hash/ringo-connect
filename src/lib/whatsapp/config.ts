// Which WhatsApp account this deployment trusts. Values come from the environment, never from code.

export interface WhatsAppAccountConfig {
  phoneNumberId: string | null;
  wabaId: string | null;
}

/**
 * WHATSAPP_PHONE_NUMBER_ID: the production phone number id events must belong to.
 * WHATSAPP_WABA_ID: the production WhatsApp Business Account id (optional extra check).
 */
export function getWhatsAppAccountConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppAccountConfig {
  return {
    phoneNumberId: (env.WHATSAPP_PHONE_NUMBER_ID || "").trim() || null,
    wabaId: (env.WHATSAPP_WABA_ID || "").trim() || null,
  };
}

/** Fail closed: with neither id configured nothing is trusted. Each configured id must match. */
export function isProductionAccountEvent(
  ev: { phoneNumberId: string; wabaId: string | null },
  cfg: WhatsAppAccountConfig,
): boolean {
  if (!cfg.phoneNumberId && !cfg.wabaId) return false;
  if (cfg.phoneNumberId && ev.phoneNumberId !== cfg.phoneNumberId) return false;
  if (cfg.wabaId && ev.wabaId !== cfg.wabaId) return false;
  return true;
}

export function partitionByAccount<T extends { phoneNumberId: string; wabaId: string | null }>(
  events: T[],
  cfg: WhatsAppAccountConfig,
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const e of events) (isProductionAccountEvent(e, cfg) ? accepted : rejected).push(e);
  return { accepted, rejected };
}
