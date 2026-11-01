import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// The public plans / add-ons catalogue shown on the landing page and the /get-started* sign-up pages. Every visit used to run two or more database reads for rows that change only when an
// admin edits a plan or an add-on, so the two base reads below are kept in Next's shared Data Cache for CATALOG_REVALIDATE_SECONDS and dropped immediately by
// revalidateTag(PUBLIC_CATALOG_TAG) from the admin plan / add-on save routes (same pattern as lib/branding.ts). Each page derives its own view (filter / order) from these two reads, so there is one
// cache, not one per page.
//
// DISPLAY ONLY. Nothing here may ever decide an amount that is charged: signupPayment, applyPayment, the Fapshi / Stripe initiate and status routes, the admin charge / approve routes, the renewal
// cron and the card-bundle initiate route keep reading the live rows themselves and never import this file. The read uses the public anon key with no cookies (so nothing per-visitor can enter the
// cache) and the same "plans are publicly readable" RLS the pages' own cookie client relied on.
export const PUBLIC_CATALOG_TAG = "public-catalog";
export const CATALOG_REVALIDATE_SECONDS = 300;

type Row = Record<string, any>;

function publicClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Throw on a failed read so unstable_cache never stores an error as an empty catalogue for the whole window.
async function readPlans(): Promise<Row[]> {
  const { data, error } = await publicClient().from("plans").select("*").order("price_usd", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function readActiveAddons(): Promise<Row[]> {
  const { data, error } = await publicClient().from("addons").select("*").eq("active", true).order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

const readPlansCached = unstable_cache(readPlans, ["public-catalog-plans"], { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [PUBLIC_CATALOG_TAG] });
const readActiveAddonsCached = unstable_cache(readActiveAddons, ["public-catalog-addons"], { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [PUBLIC_CATALOG_TAG] });

// Cache first, then a direct read where the cache is unavailable (tests, plain Node), then an empty list: the pages already treated a failed read as "no rows" (`|| []`).
async function load(cached: () => Promise<Row[]>, direct: () => Promise<Row[]>): Promise<Row[]> {
  try {
    return await cached();
  } catch {
    try {
      return await direct();
    } catch {
      return [];
    }
  }
}

/** Every plan, cheapest (USD) first. */
export function getPublicPlans(): Promise<Row[]> {
  return load(readPlansCached, readPlans);
}

/** Every active add-on, in the admin's sort order. */
export function getPublicActiveAddons(): Promise<Row[]> {
  return load(readActiveAddonsCached, readActiveAddons);
}

/** Active add-ons that grant a plan: the Ringo Card bundles, with only the columns the landing page's bundle section uses. */
export function bundleAddonsFrom(addons: Row[]): Row[] {
  return addons
    .filter((a) => a.grants_plan_name != null)
    .map((a) => ({ id: a.id, name: a.name, price_xaf: a.price_xaf, price_usd: a.price_usd, grants_plan_duration_days: a.grants_plan_duration_days, bundle_features: a.bundle_features }));
}

/** Plans that can be bought by an affiliate's link: everything except the free plan. */
export function paidPlansFrom(plans: Row[]): Row[] {
  return plans.filter((p) => p.name !== "free");
}

/** Association-enabled plans, smallest member cap first, plans with no cap (unlimited) last. */
export function associationPlansFrom(plans: Row[]): Row[] {
  return plans
    .filter((p) => p.association_enabled === true)
    .sort((a, b) => {
      const x = a.max_association_members;
      const y = b.max_association_members;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x - y;
    });
}

/** Active add-ons an admin chose to show on the affiliate page. */
export function affiliateAddonsFrom(addons: Row[]): Row[] {
  return addons.filter((a) => a.show_on_affiliate_page === true);
}
