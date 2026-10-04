import type { WhatsAppEvent } from "./types";

// Keys the next (database) phase can put a unique constraint on. Meta retries deliveries and may send
// the same status more than once, so processing must be keyed on these, not on the HTTP request.
//   inbound message: the wamid is globally unique        -> "msg:<wamid>"
//   status event:    one wamid goes sent->delivered->read -> "status:<wamid>:<status>"
// Status timestamps are deliberately not part of the key: a redelivery of the same transition is a duplicate.

export const messageIdempotencyKey = (messageId: string) => `msg:${messageId}`;
export const statusIdempotencyKey = (messageId: string, status: string) => `status:${messageId}:${status}`;

/** Drops repeats of the same key inside one delivery (first one wins). Cross-delivery dedupe is the DB's job. */
export function dedupeEvents<T extends WhatsAppEvent>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.idempotencyKey)) return false;
    seen.add(e.idempotencyKey);
    return true;
  });
}
