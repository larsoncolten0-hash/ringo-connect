// Resolves the three Smart Card offers from the REAL add-on configuration (the `addons` table the /get-started form sells from). Nothing about a price
// or a subscription is written in the bot: the add-on row is the source of truth, and src/lib/signupPayment.ts's computeSignupAmount charges from the same rows.
//
// A card add-on is one that grants a plan (grants_plan_name + grants_plan_duration_days), exactly how src/app/api/signup-requests/route.ts recognises a Smart Card.
// The three tiers are told apart by what they grant (see supabase/migrations/2026-10-07, 2026-10-10 and 2026-11-13): Standard = Basic for 30 days, Pro = Pro for 30 days,
// Premium = Basic for 365 days. If a tier cannot be found (an admin changed the configuration), it is left out and reported; nothing is guessed.

export type TierKey = "standard" | "pro" | "premium";

export interface Offer {
  tier: TierKey;
  addonId: string;
  priceXaf: number;
  planName: string;
  days: number;
  hasQr: boolean;
  hasConfig: boolean;
}

const TIER_RULES: { tier: TierKey; plan: string; days: number }[] = [
  { tier: "standard", plan: "basic", days: 30 },
  { tier: "pro", plan: "pro", days: 30 },
  { tier: "premium", plan: "basic", days: 365 },
];

export interface OfferResolution {
  offers: Offer[];
  /** Tiers whose add-on could not be found, so the owner can fix the configuration. */
  missing: TierKey[];
}

interface AddonRow {
  id: string;
  price_xaf: number | string;
  grants_plan_name: string | null;
  grants_plan_duration_days: number | null;
  bundle_features: string[] | null;
  sort_order?: number | null;
}

export function offersFromAddons(rows: AddonRow[]): OfferResolution {
  const offers: Offer[] = [];
  const missing: TierKey[] = [];
  const sorted = [...rows].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  for (const rule of TIER_RULES) {
    const row = sorted.find((r) => (r.grants_plan_name || "").toLowerCase() === rule.plan && Number(r.grants_plan_duration_days) === rule.days);
    const price = row ? Math.round(Number(row.price_xaf)) : NaN;
    if (!row || !(price > 0)) {
      missing.push(rule.tier);
      continue;
    }
    const features = (row.bundle_features || []).map((f) => String(f).toLowerCase());
    offers.push({
      tier: rule.tier,
      addonId: row.id,
      priceXaf: price,
      planName: rule.plan,
      days: rule.days,
      hasQr: features.some((f) => f.includes("qr")),
      hasConfig: features.some((f) => f.includes("configuration")),
    });
  }
  return { offers, missing };
}

export async function resolveSmartCardOffers(admin: any): Promise<OfferResolution> {
  const { data, error } = await admin
    .from("addons")
    .select("id, price_xaf, grants_plan_name, grants_plan_duration_days, bundle_features, sort_order")
    .eq("active", true)
    .not("grants_plan_name", "is", null)
    .not("grants_plan_duration_days", "is", null);
  if (error || !Array.isArray(data)) return { offers: [], missing: TIER_RULES.map((r) => r.tier) };
  return offersFromAddons(data as AddonRow[]);
}
