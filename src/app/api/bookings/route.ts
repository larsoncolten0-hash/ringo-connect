import { createAdminClient } from "@/lib/supabase/server";
import { sendBookingReceivedEmail } from "@/lib/email/sendBookingReceivedEmail";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — a visitor booking a profile has no
// Ringo account (same reasoning as /api/orders and /api/signup-requests).
// Everything that matters is re-derived server-side: a picked service's
// name is looked up from booking_services, never trusted from the client.
// There is no anon RLS policy on bookings/booking_status_history at all —
// this route (service-role admin client) is the only way in.
//
// Anti-spam: this is the first public submission endpoint in this project
// to need it (grepped the whole codebase — /api/orders and
// /api/signup-requests have none either), so it's kept minimal rather than
// pulling in new infra: a honeypot field real visitors never see or fill,
// plus a simple per-phone/profile rate limit.
const MAX_BOOKINGS_PER_HOUR = 5;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  // Honeypot — a field named to look legitimate to a bot but hidden from
  // real visitors by BookingPage's own CSS. A filled value never reaches
  // the database; the caller gets an identical-looking success response so
  // a bot has no signal to adapt against.
  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ id: crypto.randomUUID() });
  }

  const profileId = body?.profile_id;
  const customerName = typeof body?.customer_name === "string" ? body.customer_name.trim().slice(0, 120) : "";
  const customerEmail = typeof body?.customer_email === "string" ? body.customer_email.trim().slice(0, 200) : "";
  const customerPhone = typeof body?.customer_phone === "string" ? body.customer_phone.trim().slice(0, 40) : "";

  if (!profileId) {
    return NextResponse.json({ error: "Invalid booking." }, { status: 400 });
  }
  if (!customerName || !customerPhone) {
    return NextResponse.json({ error: "Name and phone number are required." }, { status: 400 });
  }

  const { data: profile } = await admin.from("profiles").select("*").eq("id", profileId).eq("published", true).single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (profile.bookings_enabled !== true) {
    return NextResponse.json({ error: "This profile isn't accepting booking requests right now." }, { status: 400 });
  }

  // Simple, table-only rate limit — no new infra, matches the "keep it
  // minimal" instruction this was built from. Scoped per-profile so one
  // spammy visitor can't exhaust every profile's quota at once.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("customer_phone", customerPhone)
    .gte("created_at", oneHourAgo);
  if ((recentCount || 0) >= MAX_BOOKINGS_PER_HOUR) {
    return NextResponse.json({ error: "Too many requests — please try again later." }, { status: 429 });
  }

  // Service — re-derived from the database, never trusted from the client,
  // same reasoning as menu_items in /api/orders. Snapshotted onto the
  // booking so a later rename/deletion never changes what already got sent.
  let serviceId: string | null = null;
  let serviceNameSnapshot: string | null = null;
  if (body?.service_id) {
    const { data: service } = await admin
      .from("booking_services")
      .select("id, name")
      .eq("id", body.service_id)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (service) {
      serviceId = service.id;
      serviceNameSnapshot = service.name;
    }
  }

  // The category-specific "extras" bag — only ever these three known keys,
  // never an arbitrary client-supplied object, and each truncated the same
  // way every other free-text field in this app is.
  const rawDetails = body?.details && typeof body.details === "object" ? body.details : {};
  const details: Record<string, string> = {};
  for (const key of ["event_type", "meeting_type", "preferred_contact_method"]) {
    const value = rawDetails[key];
    if (typeof value === "string" && value.trim()) details[key] = value.trim().slice(0, 200);
  }

  const partySize = Number.isFinite(Number(body?.party_size)) && Number(body?.party_size) > 0
    ? Math.min(100000, Math.round(Number(body.party_size)))
    : null;

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .insert({
      profile_id: profileId,
      service_id: serviceId,
      service_name_snapshot: serviceNameSnapshot,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone,
      booking_date: typeof body?.booking_date === "string" && body.booking_date ? body.booking_date : null,
      booking_time: typeof body?.booking_time === "string" ? body.booking_time.trim().slice(0, 40) || null : null,
      party_size: partySize,
      location: typeof body?.location === "string" ? body.location.trim().slice(0, 300) || null : null,
      budget: typeof body?.budget === "string" ? body.budget.trim().slice(0, 100) || null : null,
      details,
      notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null,
      consent_email_updates: body?.consent_email_updates === true,
      consent_whatsapp_updates: body?.consent_whatsapp_updates === true,
    })
    .select()
    .single();

  if (bookingError || !booking) {
    console.error("booking insert failed:", bookingError?.message);
    return NextResponse.json({ error: "Could not send your booking request — try again." }, { status: 500 });
  }

  await admin.from("booking_status_history").insert({ booking_id: booking.id, status: "pending" });

  if (customerEmail) {
    try {
      await sendBookingReceivedEmail(admin, booking.id);
    } catch (err) {
      // Never fail the booking submission itself over a notification
      // email — the request itself already succeeded above.
      console.error(`booking request email threw for booking ${booking.id}:`, err);
    }
  }

  return NextResponse.json({ id: booking.id });
}
