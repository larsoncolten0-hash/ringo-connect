// Shared shapes/labels for the event gate scanner — see
// supabase/migrations/2026-09-22_event_scanner_checkin.sql and
// src/app/api/scanner/[token]/*. Kept in one place so the scanner UI, the
// organizer's Check-in dashboard, and the API route that produces these
// outcomes all agree on exactly the same set of reasons a scan can result
// in, instead of each inventing its own subset/wording.

export type ScanDirection = "entry" | "exit";
export type ScannerType = "entry" | "exit";
export type ScannerPermission = "scanner" | "supervisor";
export type EntryPolicy = "single_entry" | "re_entry_allowed" | "unlimited_re_entry";

export type ScanOutcome =
  | "approved"
  | "not_found"
  | "wrong_event"
  | "unpaid"
  | "cancelled"
  | "refunded"
  | "already_used"
  | "already_inside"
  | "not_inside"
  | "expired_session";

/**
 * Display metadata for every possible scan result — one shared source so
 * the scanner's own big color result and the organizer's scan-history log
 * always describe the same outcome the same way.
 */
export const SCAN_OUTCOME_META: Record<
  ScanOutcome,
  { color: "green" | "red" | "orange"; labelKey: string }
> = {
  approved: { color: "green", labelKey: "validEntry" },
  not_found: { color: "red", labelKey: "invalidTicket" },
  wrong_event: { color: "red", labelKey: "invalidTicket" },
  unpaid: { color: "red", labelKey: "invalidTicket" },
  cancelled: { color: "red", labelKey: "cancelledTicket" },
  refunded: { color: "red", labelKey: "refundedTicket" },
  already_used: { color: "orange", labelKey: "alreadyUsed" },
  already_inside: { color: "orange", labelKey: "alreadyInside" },
  not_inside: { color: "orange", labelKey: "notInside" },
  expired_session: { color: "orange", labelKey: "expiredSession" },
};

/** Whether an entry_state/status combination currently counts as "inside" for live stats. */
export function isCurrentlyInside(entryState: string): boolean {
  return entryState === "inside";
}
