// Request-input validators for the Loyalty API. Pure functions (no I/O) so they
// can be reused by every route and tested in isolation. They only NARROW what a
// browser sent; the database functions re-validate everything themselves, so this
// is a fast, friendly first line and never the only one.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Client-generated idempotency key (one per Confirm tap). The database enforces uniqueness. */
export function parseIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && KEY_RE.test(value) ? value : null;
}

/** A whole number between 1 and `max`. Numeric strings are NOT accepted. */
export function parseQuantity(value: unknown, max = 100_000_000): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/** Mandatory reversal reason: 3..300 characters after trimming. */
export function parseReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 300 ? trimmed : null;
}

/** An ISO date string, or null. Used for an optional package start date. */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Optional short free text (payment reference), trimmed; null when empty. */
export function parseOptionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : undefined;
}
