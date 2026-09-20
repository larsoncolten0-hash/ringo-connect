import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata, ResolvingMetadata } from "next";
import BookingPage from "@/components/BookingPage";
import { generateMetadata as generateProfileMetadata } from "@/lib/profileMetadata";

// The dedicated booking surface — reached from the public profile's "Book
// Now"/"Reserve Table" button (see BookingButton.tsx, RestaurantHeroButtons
// .tsx, MusicHeroButtons.tsx). Its own route rather than an on-page modal,
// the same reasoning /r/[username] (RestaurantOrderPage) already uses for
// ordering — the form gets a full, uncluttered screen instead of
// overlaying the profile's other sections and fighting them for attention.
export const dynamic = "force-dynamic";

// A shared service link (/[username]/book?service=<id>) previews as that service and opens
// the form with it already chosen.
export async function generateMetadata(
  { params, searchParams }: { params: { username: string }; searchParams: { service?: string } },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const base = await generateProfileMetadata({ params }, parent);
  if (!searchParams?.service) return base;
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, username, booking_services(id, name)")
    .eq("username", params.username)
    .eq("published", true)
    .single();
  const service = (profile as any)?.booking_services?.find((s: any) => s.id === searchParams.service);
  if (!service) return base;
  const title = `${service.name} — ${(profile as any).name || (profile as any).username}`;
  return { ...base, title, openGraph: { ...base.openGraph, title } };
}

export default async function BookingRoute({ params, searchParams }: { params: { username: string }; searchParams: { service?: string } }) {
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

  const initialServiceId = (profile.booking_services || []).some((s: any) => s.id === searchParams?.service) ? (searchParams.service as string) : "";

  return <BookingPage profile={profile} initialServiceId={initialServiceId} />;
}
