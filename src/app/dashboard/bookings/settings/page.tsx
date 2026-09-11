import { requireOwnProfile } from "@/lib/bookingAuth";
import BookingSettingsCard from "@/components/dashboard/BookingSettingsCard";

export const dynamic = "force-dynamic";

export default async function BookingSettingsPage() {
  const { supabase, profile } = await requireOwnProfile();

  const { data: services } = await supabase
    .from("booking_services")
    .select("*")
    .eq("profile_id", profile.id)
    .order("sort_order");

  return (
    <BookingSettingsCard
      profileId={profile.id}
      initialEnabled={!!profile.bookings_enabled}
      initialButtonText={profile.booking_button_text}
      initialDescription={profile.booking_description}
      initialServices={services || []}
    />
  );
}
