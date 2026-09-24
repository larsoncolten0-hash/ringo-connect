// Server-side minimum gap between provider status checks for the same transaction id — defense in
// depth behind the client's own polling interval (Fapshi: max 6 status requests/minute/transaction).
// In-memory and per server instance: it cannot coordinate across instances, which is why the client
// interval and the 11s gap (rather than the bare 10s) leave headroom. Dependency-free.

import { PROVIDER_STATUS_MIN_GAP_MS } from "./constants";

export interface ProviderPollGate {
  /** true = the caller may query the provider now (and the slot is consumed); false = too soon. */
  tryAcquire(transactionId: string, nowMs: number): boolean;
}

export function createProviderPollGate(minGapMs: number = PROVIDER_STATUS_MIN_GAP_MS, maxEntries = 5000): ProviderPollGate {
  const last = new Map<string, number>();
  return {
    tryAcquire(transactionId, nowMs) {
      const prev = last.get(transactionId);
      if (prev !== undefined && nowMs - prev < minGapMs && nowMs >= prev) return false;
      last.set(transactionId, nowMs);
      if (last.size > maxEntries) {
        for (const [k, t] of last) if (nowMs - t >= minGapMs) last.delete(k);
        if (last.size > maxEntries) last.delete(last.keys().next().value as string); // hard bound
      }
      return true;
    },
  };
}
