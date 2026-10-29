import { requireLoyaltyPage } from "@/lib/loyalty/access";
import { reviewsAvailable } from "@/lib/retention/reviews";
import ReviewsModeration from "@/components/loyalty/ReviewsModeration";

export const dynamic = "force-dynamic";

// Reviews of this business: hide, show, reply. Needs loyalty.manage. Not offered for Churches & Ministries.
export default async function LoyaltyReviewsPage() {
  const { profile } = await requireLoyaltyPage(["loyalty.manage"]);
  return <ReviewsModeration available={reviewsAvailable(profile)} />;
}
