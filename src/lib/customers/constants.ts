// Business Toolkit Phase 6 (customers): the numbers every layer agrees on.
export const DIRECTORY_PAGE = { default: 25, max: 50, maxOffset: 100_000 } as const;
export const SEARCH = { minLength: 2, maxLength: 80, minPhoneDigits: 3 } as const;
export const DIRECTORY_STATUSES = ["active", "archived", "all"] as const;
export type DirectoryStatus = (typeof DIRECTORY_STATUSES)[number];

/** The Phase 3 statement function returns at most this many invoices / payments. Reaching it means older records are not in the totals. */
export const STATEMENT_LIMITS = { invoices: 200, payments: 500 } as const;
export const TIMELINE_CAP = 100;

/** Possible matching Shop orders: how many of the business's most recent orders are scanned for a phone match, and how many matches are listed. */
export const ORDER_SCAN = { window: 1000, show: 50 } as const;
