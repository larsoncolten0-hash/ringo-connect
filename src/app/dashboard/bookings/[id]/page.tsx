import { notFound } from "next/navigation";
import { requireOwnProfile } from "@/lib/bookingAuth";
import BookingDetail from "@/components/dashboard/BookingDetail";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireOwnProfile();

  const { data: booking } = await supabase
    .from("bookings")
    .select("*, booking_status_history(*)")
    .eq("id", params.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!booking) notFound();

  return <BookingDetail booking={booking} whatsappNumber={profile.whatsapp_number} />;
}
