import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";

// Called once, right after a booking request is submitted (see
// /api/bookings) — the immediate "we got it" counterpart to
// sendBookingConfirmationEmail, which fires later once the business
// actually accepts the request. Its own separate claim column
// (request_email_sent_at, distinct from confirmation_email_sent_at) means
// this and the later confirmation email never interfere with each other's
// dedupe — same send-once pattern as every other receipt sender.
export async function sendBookingReceivedEmail(client: any, bookingId: string): Promise<void> {
  const { data: booking } = await client
    .from("bookings")
    .update({ request_email_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .is("request_email_sent_at", null)
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
    heading: "Booking request received",
    subheading: businessName,
    lines,
    footerNote: `${businessName} will review your request and confirm it soon.`,
  });

  const result = await sendEmail({
    to: booking.customer_email,
    subject: `Your booking request to ${businessName} was received`,
    html,
  });

  if (!result.ok) {
    console.error(`booking request email failed for booking ${bookingId}:`, result.error);
  }
}
