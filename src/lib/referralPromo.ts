// Decides whether the dashboard's referral banner is shown, and what rate it may quote. Pure and
// server-safe. The rate is ALWAYS the live `platform_settings.affiliate_commission_rate` (what the
// commission trigger really pays) — never a hard-coded number — so the banner can only promise what
// the existing Affiliate program is currently configured to pay. No second program, no new terms.

export type ReferralPromo = { ratePct: string };

/** 0.1 → "10", 0.125 → "12.5", 0.1 → "10" (no trailing zeros). */
export function formatRatePct(rate: number): string {
  return String(Math.round(rate * 10000) / 100);
}

export function getReferralPromo(input: {
  isActingAsStaff: boolean;
  affiliateEnabled: boolean;
  affiliateSuspended: boolean;
  commissionRate: number;
}): ReferralPromo | null {
  if (input.isActingAsStaff) return null; // the offer is the signed-in person's own account
  if (!input.affiliateEnabled || input.affiliateSuspended) return null;
  if (!Number.isFinite(input.commissionRate) || input.commissionRate <= 0) return null;
  return { ratePct: formatRatePct(input.commissionRate) };
}

/** Only the dashboard home shows it — never billing, checkout or payment screens. */
export function referralPromoShowsOn(pathname: string): boolean {
  return pathname === "/dashboard";
}

export const referralPromoDismissKey = (userId: string) => `ringo-referral-promo-dismissed-${userId}`;
