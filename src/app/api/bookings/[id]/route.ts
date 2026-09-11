import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated — same reasoning as /api/orders/[id]: the
// booking's `id` is a random UUID handed to the customer at submission
// time (in the URL/confirmation screen, never listable/enumerable), so
// knowing it is itself the access control. No anon RLS policy on
// `bookings` exists at all — this route (admin client) is the only way to
// read one, scoped to itself automatically.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select(`*, profiles(name, username, whatsapp_number)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  return NextResponse.json({
    id: booking.id,
    status: booking.status,
    service_name: booking.service_name_snapshot,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
    created_at: booking.created_at,
    profile_name: booking.profiles?.name || booking.profiles?.username,
  });
}
