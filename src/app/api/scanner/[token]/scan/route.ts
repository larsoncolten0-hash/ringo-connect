import { createAdminClient } from "@/lib/supabase/server";
import { checkAndConfirmFapshiOrder } from "@/lib/musicOrderPayment";
import { NextResponse } from "next/server";

// The one route that actually moves a ticket between not_checked_in /
// inside / outside — see checkin_ticket() in the migration for the atomic
// guarantee, and the migration's own header for why status vs entry_state
// are separate. Public/unauthenticated like the session route above, and
// re-validates the scanner session on every single scan (not just once at
// page load) — a session revoked mid-event must stop working on its very
// next scan, not whenever the page next happens to reload.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const body = await request.json().catch(() => null);
  const rawCode = typeof body?.ticket_code === "string" ? body.ticket_code.trim() : "";
  if (!rawCode) return NextResponse.json({ outcome: "not_found" });

  const admin = createAdminClient();

  const { data: session } = await admin.from("scanner_sessions").select("*").eq("token", params.token).maybeSingle();
  if (!session || !session.is_active || (session.expires_at && new Date(session.expires_at) < new Date())) {
    return NextResponse.json({ outcome: "expired_session" });
  }

  // ticket_code is stored upper-cased (see set_digital_ticket_code) —
  // normalize whatever the camera decoded the same way before lookup.
  const code = rawCode.toUpperCase();

  const { data: ticket } = await admin
    .from("digital_tickets")
    .select(
      "*, music_orders(id, total, payment_status, payment_method, pending_fapshi_trans_id, profiles(id, user_id, currency)), music_order_items(name_snapshot)"
    )
    .eq("ticket_code", code)
    .maybeSingle();

  const logBase = {
    scanned_code: code,
    event_id: session.event_id,
    scanner_session_id: session.id,
    gate_name: session.gate_name,
    direction: session.scanner_type as "entry" | "exit",
  };

  if (!ticket) {
    await admin.from("ticket_checkin_logs").insert({ ...logBase, result: "not_found" });
    return NextResponse.json({ outcome: "not_found" });
  }

  const orderItem = (ticket as any).music_order_items;
  const order = (ticket as any).music_orders;

  // A ticket scanned at a gate that belongs to a different event — always
  // rejected regardless of how legitimate the ticket is for its own
  // event. This is what stops one artist's real, paid ticket from ever
  // being usable at a different show.
  if (ticket.event_id !== session.event_id) {
    await admin.from("ticket_checkin_logs").insert({
      ...logBase,
      ticket_id: ticket.id,
      ticket_holder_name: ticket.attendee_name,
      ticket_type_name: orderItem?.name_snapshot || null,
      result: "wrong_event",
    });
    return NextResponse.json({ outcome: "wrong_event" });
  }

  // A ticket bought with real automatic Mobile Money never needs the
  // artist to confirm anything by hand (see src/lib/musicOrderPayment.ts)
  // — a fan whose payment cleared after they'd already stopped watching
  // the checkout/ticket-pass page (so nothing ever re-checked Fapshi)
  // must still be let in on a legitimately paid ticket rather than turned
  // away at the door pending the artist noticing and marking it by hand.
  if (order?.payment_status !== "paid" && order?.pending_fapshi_trans_id) {
    try {
      const status = await checkAndConfirmFapshiOrder(admin, order);
      if (status === "SUCCESSFUL") order.payment_status = "paid";
    } catch {
      // Fapshi unreachable — fall through and treat as still unpaid below.
    }
  }

  // digital_tickets rows exist from the moment an order is placed (see
  // /api/music/orders), not only once paid — a cash/card order left
  // unpaid must never scan in as if it were a completed sale.
  if (order?.payment_status !== "paid") {
    await admin.from("ticket_checkin_logs").insert({
      ...logBase,
      ticket_id: ticket.id,
      ticket_holder_name: ticket.attendee_name,
      ticket_type_name: orderItem?.name_snapshot || null,
      result: "unpaid",
    });
    return NextResponse.json({ outcome: "unpaid" });
  }

  const { data: event } = await admin
    .from("events")
    .select("entry_policy, title, require_id_verification")
    .eq("id", ticket.event_id)
    .single();

  const { data: rpcResult } = await admin.rpc("checkin_ticket", {
    p_ticket_id: ticket.id,
    p_direction: session.scanner_type,
    p_entry_policy: event?.entry_policy || "single_entry",
  });

  const outcome: string = rpcResult?.outcome || "not_found";

  await admin.from("ticket_checkin_logs").insert({
    ...logBase,
    ticket_id: ticket.id,
    ticket_holder_name: ticket.attendee_name,
    ticket_type_name: orderItem?.name_snapshot || null,
    result: outcome,
  });

  // ID-verification reminder — never a blocking outcome (section 22 of
  // the spec this was built from): a valid entry still auto-approves,
  // this just overlays a reminder on the scanner's green result so staff
  // remember to glance at a physical ID. Ticket type's own setting wins
  // over the event's default when the type explicitly set one.
  let idRequired = false;
  if (outcome === "approved" && session.scanner_type === "entry") {
    idRequired = event?.require_id_verification ?? false;
    if (ticket.ticket_type_id) {
      const { data: tt } = await admin
        .from("event_ticket_types")
        .select("require_id_verification")
        .eq("id", ticket.ticket_type_id)
        .maybeSingle();
      if (tt?.require_id_verification != null) idRequired = tt.require_id_verification;
    }
  }

  // Deliberately minimal — no phone/email/payment method/other-event data
  // ever reaches the scanner (see the migration's own privacy note and
  // section 30 of the spec).
  return NextResponse.json({
    outcome,
    ticketTypeName: orderItem?.name_snapshot || null,
    holderName: ticket.attendee_name,
    ticketCode: ticket.ticket_code,
    eventTitle: event?.title || "",
    idRequired,
  });
}
