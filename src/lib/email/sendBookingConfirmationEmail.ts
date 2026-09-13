import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";

// Called when a booking's status is set to 'confirmed' (see
// /api/bookings/[id]/confirm) — the moment a fan's request actually turns
// into a real appointment, which is the natural equivalent of a "receipt"
// for a booking (there's no payment captured through Ringo Connect for
// these, just a service being scheduled).
//
// Same send-once claim pattern as the other two receipt senders: only the
// caller that flips confirmation_email_sent_at from null actually emails,
// so this is safe to call more than once for the same booking.
export async function sendBookingConfirmationEmail(client: any, bookingId: string): Promise<void> {
  const { data: booking } = await client
    .from("bookings")
    .update({ confirmation_email_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .is("confirmation_email_sent_at", null)
    .not("customer_email", "is", null)
    .select("customer_email, service_name_snapshot, booking_date, booking_time, party_size, location, profiles(name, username)")
    .maybeSingle();

  if (!booking || !booking.customer_email) return;

  const profile = booking.profiles as any;
  const businessName = profile?.name || profile?.username || "the business";

  const lines: { label: string; amount?: string | null }[] = [];
  if (booking.service_name_snapshot) lines.push({ label: "Service", amount: booking.service_name_snapshot });
  if (booking.booking_date) lines.push({ label: "Date", amount: new Date(`${booking.booking_date}T00:00:00`).toLocaleDateString("en-US") });
  if (booking.booking_time) lines.push({ label: "Time", amount: booking.booking_time });
  if (booking.party_size) lines.push({ label: "Party size", amount: String(booking.party_size) });
  if (booking.location) lines.push({ label: "Location", amount: booking.location });

  const html = renderReceiptEmail({
    heading: "Booking confirmed",
    subheading: businessName,
    lines,
    footerNote: `${businessName} confirmed your booking request.`,
  });

  const result = await sendEmail({
    to: booking.customer_email,
    subject: `Your booking with ${businessName} is confirmed`,
    html,
  });

  if (!result.ok) {
    console.error(`booking confirmation email failed for booking ${bookingId}:`, result.error);
  }
}
