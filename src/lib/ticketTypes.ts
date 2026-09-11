// Shared logic for event_ticket_types (see
// supabase/migrations/2026-09-21_event_ticket_types.sql) — kept in one
// place so "is this ticket actually on sale right now" is computed
// identically everywhere it matters: the public ticket selector, the
// checkout hand-off, and the dashboard editor's own preview of what fans
// will see. An event with zero ticket types is untouched by any of this —
// it keeps using its own events.price/ticket_url/WhatsApp fallback exactly
// as before this feature existed.

export type EventTicketType = {
  id: string;
  event_id: string;
  name: string;
  description?: string | null;
  benefits?: string[] | null;
  price: number | string;
  total_quantity?: number | null;
  sold_quantity?: number | null;
  sales_start_at?: string | null;
  sales_end_at?: string | null;
  max_per_customer?: number | null;
  is_active?: boolean;
  is_primary?: boolean;
  sort_order?: number;
};

/** null = unlimited stock. */
export function remainingForTicketType(tt: EventTicketType): number | null {
  if (tt.total_quantity == null) return null;
  return Math.max(0, tt.total_quantity - (tt.sold_quantity || 0));
}

export function isSoldOut(tt: EventTicketType): boolean {
  const remaining = remainingForTicketType(tt);
  return remaining !== null && remaining <= 0;
}

/** Enabled, within its own optional sales window, and not sold out. */
export function isTicketTypeOnSale(tt: EventTicketType, now: Date = new Date()): boolean {
  if (tt.is_active === false) return false;
  if (tt.sales_start_at && new Date(tt.sales_start_at) > now) return false;
  if (tt.sales_end_at && new Date(tt.sales_end_at) < now) return false;
  if (isSoldOut(tt)) return false;
  return true;
}

/** Every type an artist has actually enabled for this event, in their chosen order. */
export function sortedTicketTypes(ticketTypes: EventTicketType[] | null | undefined): EventTicketType[] {
  return [...(ticketTypes || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * The one ticket type the artist has chosen to feature on the public
 * profile card (see EventTicketTypesEditor's "Primary" toggle) — falls
 * back to the first on-sale type, then the first type at all, so a public
 * card never renders with a name/price to show but nothing selected. Never
 * assumes "cheapest" on its own; that's only ever the outcome of the
 * artist's own ordering when they haven't set a primary explicitly.
 */
export function primaryTicketType(ticketTypes: EventTicketType[] | null | undefined): EventTicketType | null {
  const sorted = sortedTicketTypes(ticketTypes);
  if (sorted.length === 0) return null;
  return sorted.find((t) => t.is_primary) || sorted.find((t) => isTicketTypeOnSale(t)) || sorted[0];
}

/** Whether an event has anything at all a fan could buy — new multi-tier types, or the legacy single price. */
export function eventHasTickets(event: { price?: number | string | null }, ticketTypes: EventTicketType[] | null | undefined): boolean {
  return (ticketTypes && ticketTypes.length > 0) || !!event.price;
}

/** A configurable "only N left" threshold — real inventory only, never a fabricated number. */
export const LOW_INVENTORY_THRESHOLD = 15;
