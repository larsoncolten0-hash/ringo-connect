import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { checkAndConfirmFapshiOrder } from "@/lib/musicOrderPayment";
import TicketPassView from "@/components/music/TicketPassView";

// See src/app/[username]/page.tsx's own comment.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The actual digital ticket a fan lands on after a ticket purchase (see
// MusicStorePage's confirmation screen, which links each purchased
// ticket's own pass here) — and what the QR code rendered on it encodes,
// so re-scanning always lands back on this same live status.
//
// Public and unauthenticated by design (same posture as
// /api/music/orders/[id]: a fan has no Ringo account), but digital_tickets
// itself has no public RLS policy (see the migration) — reads only ever
// happen here, through the admin client, keyed by the unguessable
// ticket_code (a short random token, never the row's own uuid — see
// set_digital_ticket_code()).
export const dynamic = "force-dynamic";

export default async function TicketPassPage({ params }: { params: { username: string; code: string } }) {
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("digital_tickets")
    .select(
      `id, ticket_code, status, attendee_name, used_at, created_at,
       events(title, location, event_date, event_time, cover_image_url),
       music_orders(id, order_number, payment_status, payment_method, pending_fapshi_trans_id, total, created_at, profiles(id, user_id, name, username, theme_color, currency)),
       music_order_items(name_snapshot, price_snapshot)`
    )
    .eq("ticket_code", params.code)
    .maybeSingle();

  const order = (ticket as any)?.music_orders;
  const profile = order?.profiles;
  // The code alone is already the real access control (unguessable, one
  // ticket) — this username check is just defense in depth so a pass
  // copy-pasted onto the wrong artist's URL 404s instead of quietly
  // rendering.
  if (!ticket || !order || !profile || profile.username !== params.username) return notFound();

  // A ticket bought with real automatic Mobile Money never needs the
  // artist to confirm anything by hand (see src/lib/musicOrderPayment.ts,
  // also used by /api/music/orders/[id] for the same reason) — a fan can
  // land straight on this saved/shared pass link, well after closing the
  // checkout tab, before Fapshi has actually confirmed the charge. Without
  // this, "check back soon" above would be a dead end: reloading only
  // ever re-read the same stale 'unpaid' column, with no artist involved
  // to ever flip it. This route is force-dynamic, so every reload
  // (including TicketPassView's own client-side polling) re-runs this
  // check and picks up the real status the moment it clears.
  if (order.payment_status !== "paid" && order.pending_fapshi_trans_id) {
    try {
      const status = await checkAndConfirmFapshiOrder(admin, order);
      if (status === "SUCCESSFUL") order.payment_status = "paid";
    } catch {
      // Fapshi unreachable this request — fall through with the
      // last-known status; the next reload/poll tries again.
    }
  }

  const event = (ticket as any).events;
  const orderItem = (ticket as any).music_order_items;

  return (
    <TicketPassView
      ticket={{
        code: ticket.ticket_code,
        status: ticket.status,
        attendeeName: ticket.attendee_name,
        usedAt: ticket.used_at,
      }}
      order={{
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        createdAt: order.created_at,
      }}
      event={{
        title: event?.title || "",
        location: event?.location || null,
        date: event?.event_date || null,
        time: event?.event_time || null,
        coverImageUrl: event?.cover_image_url || null,
      }}
      ticketTypeName={orderItem?.name_snapshot || ""}
      price={orderItem?.price_snapshot ?? null}
      artistName={profile.name || profile.username}
      accent={profile.theme_color || "#F2B705"}
      currency={profile.currency || "USD"}
    />
  );
}
