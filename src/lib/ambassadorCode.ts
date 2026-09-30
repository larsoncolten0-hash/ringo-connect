// Shared Ambassador-code format rules — used for instant client-side feedback
// (AmbassadorCodeEditor) and server-side enforcement (POST /api/ambassador/code),
// so the two can never drift apart. Zero server-only imports so a "use client"
// component can import it (same reason as src/lib/affiliateCode.ts).
//
// Letters and digits only, 4–12 characters: short enough to read out loud or type
// into a link's ?amb= param, long enough to resist squatting, and comfortably inside
// the database's own 4–20 length check on ambassador_profiles.sales_code. Always
// compared/stored UPPERCASE — ambassador_attribute_sale() looks the code up with
// upper(trim(...)), and the auto-generated 7-character codes already work that way,
// so an existing generated code keeps resolving.
export const AMBASSADOR_CODE_MIN_LENGTH = 4;
export const AMBASSADOR_CODE_MAX_LENGTH = 12;

const AMBASSADOR_CODE_RE = new RegExp(`^[A-Z0-9]{${AMBASSADOR_CODE_MIN_LENGTH},${AMBASSADOR_CODE_MAX_LENGTH}}$`);

/** Uppercases + trims input the same way everywhere a code is entered or compared. */
export function normalizeAmbassadorCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidAmbassadorCodeFormat(code: string): boolean {
  return AMBASSADOR_CODE_RE.test(code);
}
