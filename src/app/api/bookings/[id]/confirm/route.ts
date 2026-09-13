import { createClient } from "@/lib/supabase/server";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmationEmail";
import { NextResponse } from "next/server";

// The artist/business accepting a booking request — previously a direct
// client-side Supabase update (see BookingDetail.tsx's own comment); this
// one specific transition is now routed through an API route instead so a
// confirmation email can actually be sent (sendEmail is server-only — the
// Resend API key must never reach the browser). Every OTHER status
// transition (decline/cancel/complete) stays a direct client update — no
// email is owed for those. Request-scoped client, not the admin client:
// RLS ("bookings owner all") is what actually verifies this booking
// belongs to the caller's own profile, same as the direct update it
// replaces.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: booking, error } = await supabase
    .from("bookings")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();

  // RLS silently returns zero rows for a booking the caller doesn't own,
  // same as a genuinely missing id — both surface identically here.
  if (error || !booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  await supabase.from("booking_status_history").insert({ booking_id: booking.id, status: "confirmed" });

  try {
    await sendBookingConfirmationEmail(supabase, booking.id);
  } catch (err) {
    // Never fail the confirm action itself over a confirmation email — the
    // booking is already confirmed above regardless.
    console.error(`booking confirmation email threw for booking ${booking.id}:`, err);
  }

  return NextResponse.json({ ok: true });
}
