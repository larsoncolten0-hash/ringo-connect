import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BookingPage from "@/components/BookingPage";

// The dedicated booking surface — reached from the public profile's "Book
// Now"/"Reserve Table" button (see BookingButton.tsx, RestaurantHeroButtons
// .tsx, MusicHeroButtons.tsx). Its own route rather than an on-page modal,
// the same reasoning /r/[username] (RestaurantOrderPage) already uses for
// ordering — the form gets a full, uncluttered screen instead of
// overlaying the profile's other sections and fighting them for attention.
export const dynamic = "force-dynamic";

export default async function BookingRoute({ params }: { params: { username: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      `id, username, name, category, theme_color, bookings_enabled, booking_button_text, booking_description, booking_services(*)`
    )
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profile.bookings_enabled) return notFound();

  return <BookingPage profile={profile} />;
}
