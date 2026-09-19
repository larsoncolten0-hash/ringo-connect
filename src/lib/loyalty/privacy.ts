// What a business is allowed to see about a customer it looks up. Deliberately
// minimal: a name plus MASKED contact hints so staff can tell two "Larson"s apart
// without ever receiving a full email or phone number.

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `***${digits.slice(-3)}`;
}

export const MIN_SEARCH_LENGTH = 3;
export const MAX_SEARCH_RESULTS = 10;

/**
 * Reduces a search box value to a safe fragment for a PostgREST ilike filter:
 * letters, digits, spaces, "@", "+", "." and "-" only. Everything that could break
 * out of the filter syntax or act as a wildcard (commas, parentheses, quotes,
 * "%", "_", "*", backslashes) is dropped. Returns null when what is left is too
 * short to search on, so a 1-2 character probe can never enumerate customers.
 */
export function sanitizeSearchTerm(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} @+.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned.length >= MIN_SEARCH_LENGTH ? cleaned : null;
}
