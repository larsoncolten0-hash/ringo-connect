import { requireOwnProfile } from "@/lib/community/auth";
import CommunitySubscribersList from "@/components/dashboard/CommunitySubscribersList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CommunitySubscribersPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; status?: string; source?: string };
}) {
  const { supabase, profile } = await requireOwnProfile();

  const page = Math.max(1, parseInt(searchParams?.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const q = (searchParams?.q || "").trim();
  const status = searchParams?.status || "";
  const source = searchParams?.source || "";

  let query = supabase
    .from("community_subscribers")
    .select("*, community_subscription_preferences(*)", { count: "exact" })
    .eq("profile_id", profile.id);

  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);

  const { data: subscribers, count } = await query.order("created_at", { ascending: false }).range(from, to);

  return (
    <CommunitySubscribersList
      subscribers={subscribers || []}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      q={q}
      status={status}
      source={source}
    />
  );
}
