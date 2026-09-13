// Shared affiliate-code format rules — used both for instant client-side
// feedback (AffiliateCodeEditor in AffiliateView.tsx) and server-side
// enforcement (POST /api/affiliate/code), so the two can never drift
// apart. Deliberately its own file with zero server-only imports (unlike
// src/lib/affiliate.ts, which pulls in createAdminClient) so a "use
// client" component can import it directly without bundling server code.
//
// Letters and digits only, 3–6 characters — short enough to read out loud
// or type into a signup link's ?ref= param, long enough that the space of
// possible codes (36^3 to 36^6) makes squatting impractical. Always
// compared/stored uppercase, matching the auto-generated codes this lets
// someone replace (see set_affiliate_code() in
// supabase/migrations/2026-09-06_affiliate_system.sql) and
// attribute_referral()'s own `upper(trim(ref_code))` lookup — so an
// existing 8-character generated code (from before this feature existed)
// still resolves correctly even though a NEW custom code can never be
// that long.
export const AFFILIATE_CODE_MIN_LENGTH = 3;
export const AFFILIATE_CODE_MAX_LENGTH = 6;

const AFFILIATE_CODE_RE = new RegExp(`^[A-Z0-9]{${AFFILIATE_CODE_MIN_LENGTH},${AFFILIATE_CODE_MAX_LENGTH}}$`);

/** Uppercases + trims input the same way everywhere a code is entered or compared. */
export function normalizeAffiliateCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidAffiliateCodeFormat(code: string): boolean {
  return AFFILIATE_CODE_RE.test(code);
}
