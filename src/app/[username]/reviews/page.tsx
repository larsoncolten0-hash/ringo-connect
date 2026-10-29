import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import { publicReviews, reviewsAvailable, type Db } from "@/lib/retention/reviews";
import PublicReviewsView from "@/components/reviews/PublicReviewsView";

// The public reviews of a business: the average, and each review as first name + last initial, stars, words and the owner's reply. Not offered for Churches & Ministries (404). The profile must be
// published and not suspended; the reviews table itself is closed to the browser, so it is read here on the server.
export const dynamic = "force-dynamic";

export default async function PublicReviewsPage({ params }: { params: { username: string } }) {
  const supabase = createClient();
  const { data: profile } = await supabase.from("profiles").select("id, username, name, category, categories").eq("username", params.username).eq("published", true).single();
  if (!profile || !reviewsAvailable(profile)) return notFound();
  if (await isPublicProfileSuspended(params.username)) return notFound();

  const data = await publicReviews(createAdminClient() as unknown as Db, profile);
  return <PublicReviewsView username={profile.username} name={profile.name || profile.username} data={data} />;
}
