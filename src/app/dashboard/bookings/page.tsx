import { requireOwnProfile } from "@/lib/bookingAuth";
import BookingsList from "@/components/dashboard/BookingsList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function BookingsPage({ searchParams }: { searchParams: { page?: string } }) {
  const { supabase, profile } = await requireOwnProfile();

  const page = Math.max(1, parseInt(searchParams?.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [{ data: bookings, count }, { count: pendingCount }, { count: confirmedCount }, { count: completedCount }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("*", { count: "exact" })
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .range(from, to),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "pending"),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "confirmed"),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "completed"),
    ]);

  return (
    <BookingsList
      bookings={bookings || []}
      bookingsEnabled={!!profile.bookings_enabled}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      pendingCount={pendingCount ?? 0}
      confirmedCount={confirmedCount ?? 0}
      completedCount={completedCount ?? 0}
    />
  );
}
