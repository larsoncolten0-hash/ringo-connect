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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <BookingSettingsCard
      profileId={profile.id}
      username={profile.username}
      siteUrl={siteUrl}
      initialEnabled={!!profile.bookings_enabled}
      initialButtonText={profile.booking_button_text}
      initialDescription={profile.booking_description}
      initialServices={services || []}
    />
  );
}
