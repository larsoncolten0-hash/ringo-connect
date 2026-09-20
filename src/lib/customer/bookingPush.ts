import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToCustomer } from "@/lib/customer/push";
import { translations, type Locale } from "@/lib/i18n/translations";

// Tells a Ringo customer, on their My Ringo devices, that a business confirmed their booking.
//
// The recipient is resolved server-side only: first the customer the booking was linked to at
// checkout (customer_order_links, written from the signed-in session), otherwise the customer
// whose VERIFIED email equals the booking's email. Nothing is taken from the browser. Never
// throws, and never affects the confirmation itself.
export async function notifyBookingConfirmed(bookingId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: booking } = await admin
      .from("bookings")
      .select("id, customer_email, service_name_snapshot, booking_date, booking_time, profiles(name, username)")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return;

    let customerId: string | null = null;
    const { data: link } = await admin
      .from("customer_order_links")
      .select("customer_id")
      .eq("order_kind", "booking")
      .eq("order_id", bookingId)
      .maybeSingle();
    if (link) customerId = (link as any).customer_id;

    let locale: Locale = "fr";
    if (customerId) {
      const { data: c } = await admin.from("ringo_customers").select("preferred_language").eq("id", customerId).maybeSingle();
      locale = (c as any)?.preferred_language === "en" ? "en" : "fr";
    } else if ((booking as any).customer_email) {
      const { data: c } = await admin
        .from("ringo_customers")
        .select("id, preferred_language")
        .ilike("email", String((booking as any).customer_email).replace(/[\%_]/g, (m) => `\${m}`))
        .not("email_verified_at", "is", null)
        .maybeSingle();
      if (c) {
        customerId = (c as any).id;
        locale = (c as any).preferred_language === "en" ? "en" : "fr";
      }
    }
    if (!customerId) return;

    const profile = (booking as any).profiles;
    const n = translations[locale].customerPush.bookingConfirmed;
    await sendPushToCustomer(customerId, {
      category: "booking_confirmed",
      title: n.title,
      body: n.body(
        (booking as any).service_name_snapshot || "",
        profile?.name || profile?.username || "",
        (booking as any).booking_date || "",
        String((booking as any).booking_time || "").slice(0, 5)
      ),
      url: "/my-ringo/activity",
      data: { kind: "booking_confirmed" },
    });
  } catch (err) {
    console.error("notifyBookingConfirmed failed:", err);
  }
}
