import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
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
       music_orders(id, order_number, payment_status, created_at, profiles(name, username, theme_color, currency)),
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
