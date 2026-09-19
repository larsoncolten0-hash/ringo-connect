import { requireCustomer } from "@/lib/customer/server";
import { getCustomerRewards, type CustomerRewardsData } from "@/lib/loyalty/customerView";
import { getLoyaltyPrefs } from "@/lib/loyalty/prefs";
import MyRewardsView from "@/components/my-ringo/loyalty/MyRewardsView";

export const dynamic = "force-dynamic";

const EMPTY: CustomerRewardsData = { ready: [], progress: [], packages: [], history: { rewards: [], packages: [], activity: [] } };

// Rewards Ready / Loyalty Progress / Packages / History, read from the database for the signed-in
// customer on every request. Nothing is calculated in the browser.
export default async function MyRingoRewardsPage() {
  const customer = await requireCustomer();

  let data = EMPTY;
  let loadError = false;
  try {
    data = await getCustomerRewards(customer.id);
  } catch (err) {
    console.error("my-ringo rewards failed:", (err as any)?.message ?? "unknown error");
    loadError = true;
  }
  const prefs = await getLoyaltyPrefs(customer.id);

  return <MyRewardsView data={data} loadError={loadError} prefs={prefs} emailConfirmed={!!customer.email_verified_at} />;
}
