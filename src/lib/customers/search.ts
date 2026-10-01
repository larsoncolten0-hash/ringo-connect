// Business Toolkit Phase 6 (customers): safe directory search. The search term comes from a person typing; it is reduced to a small safe alphabet
// BEFORE it is placed in a PostgREST filter, so it can never close the filter group, add a condition, or use a wildcard. The mandatory
// profile_id filter is applied separately with .eq() (an AND), so no term can widen the scope even if it were hostile.
import { SEARCH } from "./constants";

/** Letters (any language), digits, space, and the few characters real names, emails and phone numbers need. Everything else is dropped. */
const ALLOWED = /[^\p{L}\p{N} '@+.\-]/gu;

export function sanitizeSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.slice(0, 400).replace(ALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH.maxLength).trim();
  return Array.from(cleaned).length >= SEARCH.minLength ? cleaned : null;
}

/** The OR group for bk_customers: name, normalised email, and (for 3+ digits) normalised phone. Returns null when there is nothing safe to search. */
export function buildSearchFilter(raw: unknown): string | null {
  const term = sanitizeSearch(raw);
  if (!term) return null;
  const clauses = [`name.ilike.%${term}%`, `email_normalized.ilike.%${term.toLowerCase()}%`];
  const digits = term.replace(/[^0-9]/g, "");
  if (digits.length >= SEARCH.minPhoneDigits) clauses.push(`phone_normalized.ilike.%${digits}%`);
  return clauses.join(",");
}
