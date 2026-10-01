// Business Toolkit Phase 4 (inventory & stock control): the numbers every layer agrees on. The database re-enforces all of them
// (supabase/migrations/2026-12-04_inventory_stock_control.sql); these exist so the UI and the pre-checks quote the same values.
export const STOCK_LIMITS = { maxAdjust: 1_000_000, maxCount: 1_000_000_000, maxThreshold: 1_000_000, reason: 200, note: 500, sku: 60 } as const;
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
/** The movement kinds an owner can record by hand through "Adjust stock" (corrections and restocks have their own forms). */
export const ADJUST_KINDS = ["stock_in", "increase", "decrease", "damaged", "lost", "sold_elsewhere"] as const;
export type AdjustKind = (typeof ADJUST_KINDS)[number];
/** Kinds that need a written reason (the database enforces the same). */
export const REASON_REQUIRED_KINDS: readonly string[] = ["increase", "decrease", "sold_elsewhere"];
export const INVENTORY_FILTERS = ["tracked", "low", "out", "ok", "untracked", "legacy"] as const;
